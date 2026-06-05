import {
    distance2,
    EPS,
    nearestPointOnSegment,
    pointAtDistance,
    sampleRoadAxis,
    type Point2D,
    type RoadAxisSource,
} from './geometry';
import { calculateRoadLaneLayout, type TrafficDirection } from './lanes';

const DEFAULT_MERGE_RADIUS_M = 18;
const DEFAULT_ENDPOINT_SNAP_RADIUS_M = 10;
const DEFAULT_MIN_CROSSING_ANGLE_DEG = 8;
const DEFAULT_SEGMENT_GRID_SIZE_M = 64;

export type RoadTopologySource = RoadAxisSource & {
    id: string;
    name?: string;
    width?: number;
    lanes?: number;
    laneWidth?: number;
    trafficDirection?: TrafficDirection;
    sidewalkWidth?: number;
    sidewalkLeft?: boolean;
    sidewalkRight?: boolean;
    built?: boolean;
    builtAxisPoints?: Point2D[];
};

export type RoundaboutTopologySource = {
    id: string;
    name?: string;
    center: Point2D;
    radius: number;
    width: number;
    lanes?: number;
};

export type JunctionApproach = {
    roadId: string;
    roadName: string;
    side: 'start' | 'end' | 'backward' | 'forward';
    widthM: number;
    lanes: number;
    laneWidthM: number;
    trafficDirection: TrafficDirection;
    sidewalkWidthM: number;
    angleRad: number;
    distanceM: number;
    nearestPoint: Point2D;
    direction: Point2D;
};

export type JunctionHub = {
    id: string;
    source: 'road-crossing' | 'roundabout';
    center: Point2D;
    radiusM: number;
    roadIds: string[];
    approaches: JunctionApproach[];
    approachCount: number;
    kind: 'junction' | 'connection';
};

export type RoadTopology = {
    hubs: JunctionHub[];
    junctionCount: number;
    connectionCount: number;
};

export type AnalyzeRoadTopologyOptions = {
    mergeRadiusM?: number;
    endpointSnapRadiusM?: number;
    minCrossingAngleDeg?: number;
    roundabouts?: RoundaboutTopologySource[];
    changedRoadIds?: string[];
    previousTopology?: RoadTopology;
    segmentGridSizeM?: number;
};

type SampledRoad = {
    road: RoadTopologySource;
    axis: Point2D[];
    totalM: number;
    segments: AxisSegment[];
};

type AxisSegment = {
    road: SampledRoad;
    index: number;
    a: Point2D;
    b: Point2D;
    startM: number;
    lengthM: number;
};

type JunctionCandidate = {
    point: Point2D;
    roadIds: string[];
};

type CandidateCluster = {
    center: Point2D;
    candidates: JunctionCandidate[];
    roadIds: Set<string>;
};

export function analyzeRoadTopology(roads: RoadTopologySource[] = [], options: AnalyzeRoadTopologyOptions = {}): RoadTopology {
    const mergeRadiusM = options.mergeRadiusM ?? DEFAULT_MERGE_RADIUS_M;
    const endpointSnapRadiusM = options.endpointSnapRadiusM ?? DEFAULT_ENDPOINT_SNAP_RADIUS_M;
    const minCrossingAngleRad = ((options.minCrossingAngleDeg ?? DEFAULT_MIN_CROSSING_ANGLE_DEG) * Math.PI) / 180;
    const sampledRoads = roads.map(sampleRoad).filter((sample) => sample.axis.length >= 2);
    const changedRoadIds = new Set((options.changedRoadIds || []).filter(Boolean));
    if (changedRoadIds.size > 0 && options.previousTopology) {
        return analyzeChangedRoadTopology(sampledRoads, {
            changedRoadIds,
            previousTopology: options.previousTopology,
            mergeRadiusM,
            endpointSnapRadiusM,
            minCrossingAngleRad,
            roundabouts: options.roundabouts || [],
            segmentGridSizeM: options.segmentGridSizeM ?? DEFAULT_SEGMENT_GRID_SIZE_M,
        });
    }
    const candidates = collectJunctionCandidates(sampledRoads, endpointSnapRadiusM, minCrossingAngleRad);
    const clusters = clusterCandidates(candidates, mergeRadiusM);
    const roadHubs = clusters
        .map((cluster, index) => buildJunctionHub(cluster, index, sampledRoads, mergeRadiusM, endpointSnapRadiusM))
        .filter((hub) => hub.roadIds.length >= 2 && hub.approachCount >= 2)
        .filter((hub) => !isInsideRoundaboutHub(hub.center, options.roundabouts || []));
    const roundaboutHubs = (options.roundabouts || [])
        .map((roundabout, index) => buildRoundaboutHub(roundabout, index, sampledRoads, endpointSnapRadiusM))
        .filter((hub) => hub.roadIds.length >= 2 && hub.approachCount >= 2);
    const hubs = [...roadHubs, ...roundaboutHubs]
        .sort((a, b) => b.approachCount - a.approachCount || a.id.localeCompare(b.id));

    return {
        hubs,
        junctionCount: hubs.filter((hub) => hub.kind === 'junction').length,
        connectionCount: hubs.filter((hub) => hub.kind === 'connection').length,
    };
}

function buildRoundaboutHub(
    roundabout: RoundaboutTopologySource,
    index: number,
    sampledRoads: SampledRoad[],
    endpointSnapRadiusM: number,
): JunctionHub {
    const outerR = roundabout.radius + roundabout.width / 2;
    const participatingRoads = sampledRoads.filter((sample) => {
        const nearest = nearestOnSampledRoad(sample, roundabout.center);
        return nearest.distance <= outerR + roadHalfWidth(sample.road) + endpointSnapRadiusM;
    });
    const approaches: JunctionApproach[] = [];
    participatingRoads.forEach((sample) => {
        approaches.push(...buildRoadApproaches(sample, roundabout.center, endpointSnapRadiusM));
    });
    approaches.sort((a, b) => a.angleRad - b.angleRad);

    return {
        id: `roundabout-${roundabout.id || index + 1}`,
        source: 'roundabout',
        center: { ...roundabout.center },
        radiusM: Math.max(outerR, 8),
        roadIds: [...new Set(approaches.map((approach) => approach.roadId))],
        approaches,
        approachCount: approaches.length,
        kind: approaches.length >= 3 ? 'junction' : 'connection',
    };
}

function isInsideRoundaboutHub(point: Point2D, roundabouts: RoundaboutTopologySource[]) {
    return roundabouts.some((roundabout) => {
        const outerR = roundabout.radius + roundabout.width / 2;
        return distance2(point, roundabout.center) <= outerR;
    });
}

function sampleRoad(road: RoadTopologySource): SampledRoad {
    const axis = road.built && Array.isArray(road.builtAxisPoints) && road.builtAxisPoints.length >= 2
        ? road.builtAxisPoints.map((point) => ({ x: point.x, z: point.z }))
        : sampleRoadAxis(road);
    const segments: AxisSegment[] = [];
    let totalM = 0;

    for (let i = 1; i < axis.length; i += 1) {
        const a = axis[i - 1];
        const b = axis[i];
        const lengthM = distance2(a, b);
        const startM = totalM;
        totalM += lengthM;
        if (lengthM <= EPS) continue;
        segments.push({
            road: null as unknown as SampledRoad,
            index: segments.length,
            a,
            b,
            startM,
            lengthM,
        });
    }

    const sampled = { road, axis, totalM, segments };
    segments.forEach((segment, index) => {
        segment.index = index;
        segment.road = sampled;
    });
    return sampled;
}

function analyzeChangedRoadTopology(
    sampledRoads: SampledRoad[],
    options: {
        changedRoadIds: Set<string>;
        previousTopology: RoadTopology;
        mergeRadiusM: number;
        endpointSnapRadiusM: number;
        minCrossingAngleRad: number;
        roundabouts: RoundaboutTopologySource[];
        segmentGridSizeM: number;
    },
): RoadTopology {
    const changedSamples = sampledRoads.filter((sample) => options.changedRoadIds.has(sample.road.id));
    if (changedSamples.length === 0) {
        return analyzeRoadTopology(sampledRoads.map((sample) => sample.road), {
            mergeRadiusM: options.mergeRadiusM,
            endpointSnapRadiusM: options.endpointSnapRadiusM,
            minCrossingAngleDeg: (options.minCrossingAngleRad * 180) / Math.PI,
            roundabouts: options.roundabouts,
        });
    }

    const segmentGrid = buildSegmentGrid(
        sampledRoads.filter((sample) => !options.changedRoadIds.has(sample.road.id)),
        options.segmentGridSizeM,
    );
    const candidates = collectChangedRoadCandidates(
        changedSamples,
        segmentGrid,
        options.mergeRadiusM,
        options.endpointSnapRadiusM,
        options.minCrossingAngleRad,
    );
    const candidateRoadIds = new Set(candidates.flatMap((candidate) => candidate.roadIds));
    options.changedRoadIds.forEach((roadId) => candidateRoadIds.add(roadId));
    const candidateSamples = sampledRoads.filter((sample) => candidateRoadIds.has(sample.road.id));
    const clusters = clusterCandidates(candidates, options.mergeRadiusM);
    const roadHubs = clusters
        .map((cluster, index) => buildJunctionHub(cluster, index, candidateSamples, options.mergeRadiusM, options.endpointSnapRadiusM))
        .filter((hub) => hub.roadIds.length >= 2 && hub.approachCount >= 2)
        .filter((hub) => !isInsideRoundaboutHub(hub.center, options.roundabouts));

    const preservedRoadHubs = options.previousTopology.hubs
        .filter((hub) => hub.source === 'road-crossing')
        .filter((hub) => !intersectsRoadSet(hub.roadIds, options.changedRoadIds))
        .filter((hub) => roadHubs.every((freshHub) => distance2(freshHub.center, hub.center) > options.mergeRadiusM));

    const roundaboutHubs = options.roundabouts
        .map((roundabout, index) => buildRoundaboutHub(roundabout, index, sampledRoads, options.endpointSnapRadiusM))
        .filter((hub) => hub.roadIds.length >= 2 && hub.approachCount >= 2);
    const hubs = normalizeTopologyHubIds([...preservedRoadHubs, ...roadHubs, ...roundaboutHubs]
        .sort((a, b) => b.approachCount - a.approachCount || a.id.localeCompare(b.id)));

    return {
        hubs,
        junctionCount: hubs.filter((hub) => hub.kind === 'junction').length,
        connectionCount: hubs.filter((hub) => hub.kind === 'connection').length,
    };
}

function buildSegmentGrid(sampledRoads: SampledRoad[], cellSizeM: number) {
    const safeCellSizeM = Math.max(8, cellSizeM || DEFAULT_SEGMENT_GRID_SIZE_M);
    const cells = new Map<string, AxisSegment[]>();
    sampledRoads.forEach((sample) => {
        sample.segments.forEach((segment) => {
            getSegmentCellKeys(segment, safeCellSizeM, 0).forEach((key) => {
                const list = cells.get(key) || [];
                list.push(segment);
                cells.set(key, list);
            });
        });
    });
    return {
        cellSizeM: safeCellSizeM,
        cells,
    };
}

function collectChangedRoadCandidates(
    changedSamples: SampledRoad[],
    segmentGrid: ReturnType<typeof buildSegmentGrid>,
    mergeRadiusM: number,
    endpointSnapRadiusM: number,
    minCrossingAngleRad: number,
) {
    const candidates: JunctionCandidate[] = [];
    const changedSegmentPaddingM = Math.max(mergeRadiusM, endpointSnapRadiusM) + Math.max(...changedSamples.map((sample) => roadHalfWidth(sample.road)), 0) + 4;
    const changedTargetPairs = new Set<string>();
    const targetSegmentsByRoadId = new Map<string, Set<AxisSegment>>();

    changedSamples.forEach((changedSample) => {
        changedSample.segments.forEach((changedSegment) => {
            const nearbySegments = querySegmentGrid(segmentGrid, changedSegment, changedSegmentPaddingM);
            nearbySegments.forEach((targetSegment) => {
                if (targetSegment.road.road.id === changedSample.road.id) return;
                const segmentPairKey = `${changedSample.road.id}:${changedSegment.index}:${targetSegment.road.road.id}:${targetSegment.index}`;
                if (changedTargetPairs.has(segmentPairKey)) return;
                changedTargetPairs.add(segmentPairKey);
                addTargetSegment(targetSegmentsByRoadId, targetSegment);

                const intersection = segmentIntersection(changedSegment.a, changedSegment.b, targetSegment.a, targetSegment.b);
                if (!intersection || intersection.angleRad < minCrossingAngleRad) return;
                candidates.push({
                    point: intersection.point,
                    roadIds: [changedSample.road.id, targetSegment.road.road.id],
                });
            });
        });
    });

    changedSamples.forEach((changedSample) => {
        targetSegmentsByRoadId.forEach((targetSegments) => {
            const targetSample = [...targetSegments][0]?.road;
            if (!targetSample) return;
            collectEndpointCandidatesAgainstSegments(candidates, changedSample, targetSample, [...targetSegments], endpointSnapRadiusM);
            collectEndpointCandidatesAgainstSegments(candidates, targetSample, changedSample, changedSample.segments, endpointSnapRadiusM);
        });
    });

    return candidates;
}

function addTargetSegment(targetSegmentsByRoadId: Map<string, Set<AxisSegment>>, segment: AxisSegment) {
    const roadId = segment.road.road.id;
    const segments = targetSegmentsByRoadId.get(roadId) || new Set<AxisSegment>();
    segments.add(segment);
    targetSegmentsByRoadId.set(roadId, segments);
}

function querySegmentGrid(segmentGrid: ReturnType<typeof buildSegmentGrid>, segment: AxisSegment, paddingM: number) {
    const out = new Set<AxisSegment>();
    getSegmentCellKeys(segment, segmentGrid.cellSizeM, paddingM).forEach((key) => {
        (segmentGrid.cells.get(key) || []).forEach((candidate) => out.add(candidate));
    });
    return [...out];
}

function getSegmentCellKeys(segment: AxisSegment, cellSizeM: number, paddingM: number) {
    const minX = Math.min(segment.a.x, segment.b.x) - paddingM;
    const maxX = Math.max(segment.a.x, segment.b.x) + paddingM;
    const minZ = Math.min(segment.a.z, segment.b.z) - paddingM;
    const maxZ = Math.max(segment.a.z, segment.b.z) + paddingM;
    const minCellX = Math.floor(minX / cellSizeM);
    const maxCellX = Math.floor(maxX / cellSizeM);
    const minCellZ = Math.floor(minZ / cellSizeM);
    const maxCellZ = Math.floor(maxZ / cellSizeM);
    const keys: string[] = [];
    for (let x = minCellX; x <= maxCellX; x += 1) {
        for (let z = minCellZ; z <= maxCellZ; z += 1) {
            keys.push(`${x}:${z}`);
        }
    }
    return keys;
}

function collectJunctionCandidates(sampledRoads: SampledRoad[], endpointSnapRadiusM: number, minCrossingAngleRad: number) {
    const candidates: JunctionCandidate[] = [];

    for (let i = 0; i < sampledRoads.length; i += 1) {
        for (let j = i + 1; j < sampledRoads.length; j += 1) {
            const a = sampledRoads[i];
            const b = sampledRoads[j];
            collectCrossingCandidates(candidates, a, b, minCrossingAngleRad);
            collectEndpointCandidates(candidates, a, b, endpointSnapRadiusM);
            collectEndpointCandidates(candidates, b, a, endpointSnapRadiusM);
        }
    }

    return candidates;
}

function collectCrossingCandidates(candidates: JunctionCandidate[], a: SampledRoad, b: SampledRoad, minCrossingAngleRad: number) {
    a.segments.forEach((segmentA) => {
        b.segments.forEach((segmentB) => {
            const intersection = segmentIntersection(segmentA.a, segmentA.b, segmentB.a, segmentB.b);
            if (!intersection) return;
            if (intersection.angleRad < minCrossingAngleRad) return;
            candidates.push({
                point: intersection.point,
                roadIds: [a.road.id, b.road.id],
            });
        });
    });
}

function collectEndpointCandidates(candidates: JunctionCandidate[], endpointRoad: SampledRoad, targetRoad: SampledRoad, endpointSnapRadiusM: number) {
    collectEndpointCandidatesAgainstSegments(candidates, endpointRoad, targetRoad, targetRoad.segments, endpointSnapRadiusM);
}

function collectEndpointCandidatesAgainstSegments(
    candidates: JunctionCandidate[],
    endpointRoad: SampledRoad,
    targetRoad: SampledRoad,
    targetSegments: AxisSegment[],
    endpointSnapRadiusM: number,
) {
    const endpoints = [endpointRoad.axis[0], endpointRoad.axis[endpointRoad.axis.length - 1]];
    endpoints.forEach((endpoint) => {
        let best = null;
        targetSegments.forEach((segment) => {
            const nearest = nearestPointOnSegment(endpoint, segment.a, segment.b);
            if (nearest.distance <= endpointSnapRadiusM && (!best || nearest.distance < best.distance)) {
                best = nearest;
            }
        });
        if (!best) return;
        candidates.push({
            point: {
                x: (endpoint.x + best.point.x) * 0.5,
                z: (endpoint.z + best.point.z) * 0.5,
            },
            roadIds: [endpointRoad.road.id, targetRoad.road.id],
        });
    });
}

function clusterCandidates(candidates: JunctionCandidate[], mergeRadiusM: number) {
    const clusters: CandidateCluster[] = [];

    candidates.forEach((candidate) => {
        let cluster = clusters.find((item) => distance2(item.center, candidate.point) <= mergeRadiusM);
        if (!cluster) {
            cluster = {
                center: { ...candidate.point },
                candidates: [],
                roadIds: new Set(),
            };
            clusters.push(cluster);
        }

        cluster.candidates.push(candidate);
        candidate.roadIds.forEach((roadId) => cluster.roadIds.add(roadId));
        const weight = cluster.candidates.length;
        cluster.center = {
            x: cluster.center.x + (candidate.point.x - cluster.center.x) / weight,
            z: cluster.center.z + (candidate.point.z - cluster.center.z) / weight,
        };
    });

    return clusters;
}

function buildJunctionHub(
    cluster: CandidateCluster,
    index: number,
    sampledRoads: SampledRoad[],
    mergeRadiusM: number,
    endpointSnapRadiusM: number,
): JunctionHub {
    const approaches: JunctionApproach[] = [];
    const participatingRoads = sampledRoads.filter((sample) => {
        const nearest = nearestOnSampledRoad(sample, cluster.center);
        const captureRadius = Math.max(mergeRadiusM, roadHalfWidth(sample.road) + endpointSnapRadiusM);
        return nearest.distance <= captureRadius;
    });

    participatingRoads.forEach((sample) => {
        approaches.push(...buildRoadApproaches(sample, cluster.center, endpointSnapRadiusM));
    });
    approaches.sort((a, b) => a.angleRad - b.angleRad);

    const roadIds = [...new Set(approaches.map((approach) => approach.roadId))];
    const widestRoadM = Math.max(0, ...participatingRoads.map((sample) => Number(sample.road.width) || 0));
    const radiusM = Math.max(8, Math.min(34, widestRoadM * 0.75 + endpointSnapRadiusM * 0.45));

    return {
        id: `junction-${index + 1}`,
        source: 'road-crossing',
        center: cluster.center,
        radiusM,
        roadIds,
        approaches,
        approachCount: approaches.length,
        kind: approaches.length >= 3 ? 'junction' : 'connection',
    };
}

function buildRoadApproaches(sample: SampledRoad, center: Point2D, endpointSnapRadiusM: number): JunctionApproach[] {
    const nearest = nearestOnSampledRoad(sample, center);
    const roadName = sample.road.name || sample.road.id;
    const widthM = Math.max(1, Number(sample.road.width) || 0);
    const layout = calculateRoadLaneLayout(widthM, sample.road.laneWidth, sample.road.trafficDirection);
    const lanes = layout.totalLanes;
    const laneWidthM = layout.laneWidthM;
    const sidewalkEnabled = sample.road.sidewalkLeft !== false || sample.road.sidewalkRight !== false;
    const sidewalkWidthM = sidewalkEnabled ? Math.max(0, Number(sample.road.sidewalkWidth) || 0) : 0;
    const lookahead = Math.max(8, Math.min(22, sample.totalM * 0.2));

    if (nearest.distanceM <= endpointSnapRadiusM) {
        const target = pointAtDistance(sample.axis, Math.min(sample.totalM, nearest.distanceM + lookahead));
        return [makeApproach(sample.road.id, roadName, 'start', widthM, lanes, laneWidthM, layout.trafficDirection, sidewalkWidthM, nearest, directionBetween(nearest.point, target))];
    }

    if (sample.totalM - nearest.distanceM <= endpointSnapRadiusM) {
        const target = pointAtDistance(sample.axis, Math.max(0, nearest.distanceM - lookahead));
        return [makeApproach(sample.road.id, roadName, 'end', widthM, lanes, laneWidthM, layout.trafficDirection, sidewalkWidthM, nearest, directionBetween(nearest.point, target))];
    }

    const backwardTarget = pointAtDistance(sample.axis, Math.max(0, nearest.distanceM - lookahead));
    const forwardTarget = pointAtDistance(sample.axis, Math.min(sample.totalM, nearest.distanceM + lookahead));
    return [
        makeApproach(sample.road.id, roadName, 'backward', widthM, lanes, laneWidthM, layout.trafficDirection, sidewalkWidthM, nearest, directionBetween(nearest.point, backwardTarget)),
        makeApproach(sample.road.id, roadName, 'forward', widthM, lanes, laneWidthM, layout.trafficDirection, sidewalkWidthM, nearest, directionBetween(nearest.point, forwardTarget)),
    ];
}

function makeApproach(
    roadId: string,
    roadName: string,
    side: JunctionApproach['side'],
    widthM: number,
    lanes: number,
    laneWidthM: number,
    trafficDirection: TrafficDirection,
    sidewalkWidthM: number,
    nearest,
    direction: Point2D,
): JunctionApproach {
    return {
        roadId,
        roadName,
        side,
        widthM,
        lanes,
        laneWidthM,
        trafficDirection,
        sidewalkWidthM,
        angleRad: Math.atan2(direction.z, direction.x),
        distanceM: nearest.distanceM,
        nearestPoint: nearest.point,
        direction,
    };
}

function nearestOnSampledRoad(sample: SampledRoad, point: Point2D) {
    let best = {
        point: sample.axis[0],
        distance: Number.POSITIVE_INFINITY,
        distanceM: 0,
    };

    sample.segments.forEach((segment) => {
        const nearest = nearestPointOnSegment(point, segment.a, segment.b);
        if (nearest.distance < best.distance) {
            best = {
                point: nearest.point,
                distance: nearest.distance,
                distanceM: segment.startM + nearest.t * segment.lengthM,
            };
        }
    });

    return best;
}

function segmentIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
    const r = { x: b.x - a.x, z: b.z - a.z };
    const s = { x: d.x - c.x, z: d.z - c.z };
    const denominator = cross(r, s);
    if (Math.abs(denominator) <= EPS) return null;

    const cToA = { x: c.x - a.x, z: c.z - a.z };
    const t = cross(cToA, s) / denominator;
    const u = cross(cToA, r) / denominator;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

    const rLen = Math.hypot(r.x, r.z);
    const sLen = Math.hypot(s.x, s.z);
    const sin = Math.abs(denominator) / Math.max(EPS, rLen * sLen);
    const angleRad = Math.asin(Math.min(1, sin));

    return {
        point: {
            x: a.x + r.x * t,
            z: a.z + r.z * t,
        },
        angleRad,
    };
}

function directionBetween(from: Point2D, to: Point2D) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    return {
        x: dx / length,
        z: dz / length,
    };
}

function roadHalfWidth(road: RoadTopologySource) {
    return Math.max(1, Number(road.width) || 0) * 0.5;
}

function intersectsRoadSet(roadIds: string[], roadSet: Set<string>) {
    return roadIds.some((roadId) => roadSet.has(roadId));
}

function normalizeTopologyHubIds(hubs: JunctionHub[]) {
    let roadCrossingIndex = 0;
    return hubs.map((hub) => {
        if (hub.source !== 'road-crossing') return hub;
        roadCrossingIndex += 1;
        return {
            ...hub,
            id: `junction-${roadCrossingIndex}`,
        };
    });
}

function cross(a: Point2D, b: Point2D) {
    return a.x * b.z - a.z * b.x;
}
