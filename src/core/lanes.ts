export const DEFAULT_LANE_WIDTH_M = 3.5;

export type TrafficDirection = 'two-way' | 'one-way';

export type LaneBoundary = {
    offsetM: number;
    kind: 'lane' | 'center';
};

export type RoadLaneLayout = {
    trafficDirection: TrafficDirection;
    widthM: number;
    laneWidthM: number;
    directionWidthM: number;
    lanesPerDirection: number;
    totalLanes: number;
    laneWidthsM: number[];
    boundaryOffsets: LaneBoundary[];
};

export function normalizeTrafficDirection(value: unknown): TrafficDirection {
    return value === 'one-way' ? 'one-way' : 'two-way';
}

export function calculateRoadLaneLayout(width: unknown, laneWidth: unknown, trafficDirection: unknown = 'two-way'): RoadLaneLayout {
    const widthM = Math.max(0.5, Number(width) || 0);
    const laneWidthM = Math.max(0.5, Number(laneWidth) || DEFAULT_LANE_WIDTH_M);
    const normalizedDirection = normalizeTrafficDirection(trafficDirection);
    const directionWidthM = normalizedDirection === 'two-way' ? widthM / 2 : widthM;
    const laneWidthsM = calculateDirectionLaneWidths(directionWidthM, laneWidthM);
    const lanesPerDirection = laneWidthsM.length;
    const totalLanes = normalizedDirection === 'two-way' ? lanesPerDirection * 2 : lanesPerDirection;
    const boundaryOffsets = normalizedDirection === 'two-way'
        ? calculateTwoWayBoundaries(laneWidthsM)
        : calculateOneWayBoundaries(widthM, laneWidthsM);

    return {
        trafficDirection: normalizedDirection,
        widthM,
        laneWidthM,
        directionWidthM,
        lanesPerDirection,
        totalLanes,
        laneWidthsM,
        boundaryOffsets,
    };
}

function calculateDirectionLaneWidths(directionWidthM: number, laneWidthM: number) {
    const laneCount = Math.max(1, Math.floor(directionWidthM / laneWidthM));
    if (laneCount === 1) return [directionWidthM];

    const widths = Array(laneCount).fill(laneWidthM);
    widths[widths.length - 1] += directionWidthM - laneWidthM * laneCount;
    return widths;
}

function calculateTwoWayBoundaries(laneWidthsM: number[]): LaneBoundary[] {
    const boundaries: LaneBoundary[] = [{ offsetM: 0, kind: 'center' }];
    let cursor = 0;

    for (let i = 0; i < laneWidthsM.length - 1; i += 1) {
        cursor += laneWidthsM[i];
        boundaries.push({ offsetM: cursor, kind: 'lane' }, { offsetM: -cursor, kind: 'lane' });
    }

    return boundaries.sort((a, b) => a.offsetM - b.offsetM);
}

function calculateOneWayBoundaries(widthM: number, laneWidthsM: number[]): LaneBoundary[] {
    const boundaries: LaneBoundary[] = [];
    let cursor = -widthM / 2;

    for (let i = 0; i < laneWidthsM.length - 1; i += 1) {
        cursor += laneWidthsM[i];
        boundaries.push({ offsetM: cursor, kind: 'lane' });
    }

    return boundaries;
}
