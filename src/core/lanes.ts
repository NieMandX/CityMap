export const DEFAULT_LANE_WIDTH_M = 3.5;

export type TrafficDirection = 'two-way' | 'one-way';
export type DividerType = 'line' | 'painted' | 'raised' | 'none';

export type LaneBoundary = {
    offsetM: number;
    kind: 'lane' | 'center';
    side: 'left' | 'right' | 'center' | 'one-way';
    index: number;
};

export type RoadLaneLayout = {
    trafficDirection: TrafficDirection;
    widthM: number;
    laneWidthM: number;
    directionWidthM: number;
    lanesPerDirection: number;
    forwardWidthM: number;
    backwardWidthM: number;
    dividerCenterOffsetM: number;
    forwardLanes: number;
    backwardLanes: number;
    totalLanes: number;
    laneWidthsM: number[];
    forwardLaneWidthsM: number[];
    backwardLaneWidthsM: number[];
    dividerWidthM: number;
    dividerType: DividerType;
    boundaryOffsets: LaneBoundary[];
};

export type RoadLaneLayoutOptions = {
    forwardLanes?: unknown;
    backwardLanes?: unknown;
    forwardWidth?: unknown;
    backwardWidth?: unknown;
    dividerWidth?: unknown;
    dividerType?: unknown;
};

export function normalizeTrafficDirection(value: unknown): TrafficDirection {
    return value === 'one-way' ? 'one-way' : 'two-way';
}

export function normalizeDividerType(value: unknown): DividerType {
    return value === 'painted' || value === 'raised' || value === 'none' ? value : 'line';
}

export function calculateRoadLaneLayout(
    width: unknown,
    laneWidth: unknown,
    trafficDirection: unknown = 'two-way',
    options: RoadLaneLayoutOptions = {},
): RoadLaneLayout {
    let widthM = Math.max(0.5, Number(width) || 0);
    const laneWidthM = Math.max(0.5, Number(laneWidth) || DEFAULT_LANE_WIDTH_M);
    const normalizedDirection = normalizeTrafficDirection(trafficDirection);
    const dividerType = normalizeDividerType(options.dividerType);
    let dividerWidthM = normalizedDirection === 'two-way' && dividerType !== 'none'
        ? Math.min(Math.max(0, Number(options.dividerWidth) || 0), Math.max(0, widthM - 1))
        : 0;

    if (normalizedDirection === 'one-way') {
        const laneCount = normalizeLaneCount(options.forwardLanes)
            || calculateAutoLaneCount(widthM, laneWidthM);
        const laneWidthsM = calculateDirectionLaneWidths(widthM, laneWidthM, laneCount);
        return {
            trafficDirection: normalizedDirection,
            widthM,
            laneWidthM,
            directionWidthM: widthM,
            lanesPerDirection: laneCount,
            forwardWidthM: widthM,
            backwardWidthM: 0,
            dividerCenterOffsetM: 0,
            forwardLanes: laneCount,
            backwardLanes: 0,
            totalLanes: laneCount,
            laneWidthsM,
            forwardLaneWidthsM: laneWidthsM,
            backwardLaneWidthsM: [],
            dividerWidthM,
            dividerType,
            boundaryOffsets: calculateOneWayBoundaries(widthM, laneWidthsM),
        };
    }

    const fallbackDrivableWidthM = Math.max(1, widthM - dividerWidthM);
    let forwardWidthM = normalizeDirectionWidth(options.forwardWidth) ?? fallbackDrivableWidthM / 2;
    let backwardWidthM = normalizeDirectionWidth(options.backwardWidth) ?? fallbackDrivableWidthM / 2;
    const totalDrivableWidthM = Math.max(1, forwardWidthM + backwardWidthM);
    dividerWidthM = dividerType !== 'none'
        ? Math.min(dividerWidthM, Math.max(0, totalDrivableWidthM - 0.5))
        : 0;
    widthM = forwardWidthM + backwardWidthM + dividerWidthM;
    const dividerCenterOffsetM = 0;
    const forwardLanes = normalizeLaneCount(options.forwardLanes)
        || calculateAutoLaneCount(forwardWidthM, laneWidthM);
    const backwardLanes = normalizeLaneCount(options.backwardLanes)
        || calculateAutoLaneCount(backwardWidthM, laneWidthM);
    const forwardLaneWidthsM = calculateDirectionLaneWidths(forwardWidthM, laneWidthM, forwardLanes);
    const backwardLaneWidthsM = calculateDirectionLaneWidths(backwardWidthM, laneWidthM, backwardLanes);
    const laneWidthsM = mergeLaneWidths(backwardLaneWidthsM, forwardLaneWidthsM);
    const boundaryOffsets = calculateTwoWayBoundaries(
        backwardLaneWidthsM,
        forwardLaneWidthsM,
        dividerWidthM,
        dividerType,
        dividerCenterOffsetM,
    );

    return {
        trafficDirection: normalizedDirection,
        widthM,
        laneWidthM,
        directionWidthM: Math.max(forwardWidthM, backwardWidthM),
        lanesPerDirection: Math.max(forwardLanes, backwardLanes),
        forwardWidthM,
        backwardWidthM,
        dividerCenterOffsetM,
        forwardLanes,
        backwardLanes,
        totalLanes: forwardLanes + backwardLanes,
        laneWidthsM,
        forwardLaneWidthsM,
        backwardLaneWidthsM,
        dividerWidthM,
        dividerType,
        boundaryOffsets,
    };
}

function calculateDirectionLaneWidths(directionWidthM: number, laneWidthM: number, laneCount: number) {
    const safeLaneCount = Math.max(1, Math.round(laneCount) || 1);
    const safeDirectionWidthM = Math.max(0.5, directionWidthM);
    if (safeLaneCount === 1) return [safeDirectionWidthM];

    if (safeDirectionWidthM <= laneWidthM * safeLaneCount) {
        return Array(safeLaneCount).fill(Math.max(0.5, safeDirectionWidthM / safeLaneCount));
    }

    const widths = Array(safeLaneCount).fill(laneWidthM);
    widths[widths.length - 1] = safeDirectionWidthM - laneWidthM * (safeLaneCount - 1);
    return widths;
}

function calculateAutoLaneCount(directionWidthM: number, laneWidthM: number) {
    return Math.max(1, Math.floor(Math.max(0.5, directionWidthM) / laneWidthM));
}

function normalizeLaneCount(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1) return null;
    return Math.min(16, Math.max(1, Math.round(number)));
}

function normalizeDirectionWidth(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.max(0.5, number);
}

function mergeLaneWidths(backwardLaneWidthsM: number[], forwardLaneWidthsM: number[]) {
    if (backwardLaneWidthsM.length === forwardLaneWidthsM.length
        && backwardLaneWidthsM.every((width, index) => Math.abs(width - forwardLaneWidthsM[index]) < 0.001)) {
        return [...forwardLaneWidthsM];
    }
    return [...backwardLaneWidthsM, ...forwardLaneWidthsM];
}

function calculateTwoWayBoundaries(
    backwardLaneWidthsM: number[],
    forwardLaneWidthsM: number[],
    dividerWidthM: number,
    dividerType: DividerType,
    dividerCenterOffsetM: number,
): LaneBoundary[] {
    const boundaries: LaneBoundary[] = [];
    if (dividerType === 'line' && dividerWidthM <= 0.01) {
        boundaries.push({ offsetM: dividerCenterOffsetM, kind: 'center', side: 'center', index: 0 });
    }

    let leftCursor = dividerCenterOffsetM + dividerWidthM / 2;
    for (let i = 0; i < backwardLaneWidthsM.length - 1; i += 1) {
        leftCursor += backwardLaneWidthsM[i];
        boundaries.push({ offsetM: leftCursor, kind: 'lane', side: 'left', index: i + 1 });
    }

    let rightCursor = dividerCenterOffsetM - dividerWidthM / 2;
    for (let i = 0; i < forwardLaneWidthsM.length - 1; i += 1) {
        rightCursor -= forwardLaneWidthsM[i];
        boundaries.push({ offsetM: rightCursor, kind: 'lane', side: 'right', index: i + 1 });
    }

    return boundaries.sort((a, b) => a.offsetM - b.offsetM);
}

function calculateOneWayBoundaries(widthM: number, laneWidthsM: number[]): LaneBoundary[] {
    const boundaries: LaneBoundary[] = [];
    let cursor = -widthM / 2;

    for (let i = 0; i < laneWidthsM.length - 1; i += 1) {
        cursor += laneWidthsM[i];
        boundaries.push({ offsetM: cursor, kind: 'lane', side: 'one-way', index: i + 1 });
    }

    return boundaries;
}
