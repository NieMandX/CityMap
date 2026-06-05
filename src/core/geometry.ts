export const EPS = 1e-6;

export type SmoothMode = 'corner' | 'smooth' | 'auto';

export type Point2D = {
    x: number;
    z: number;
    smooth?: SmoothMode;
};

export type RoadAxisSource = {
    points: Point2D[];
};

export type ClipDisc = {
    center: Point2D;
    radiusM: number;
};

export function normalizeRoadPoints(points: Point2D[] = []) {
    return points.map((point, index, list) => ({
        x: Number(point.x) || 0,
        z: Number(point.z) || 0,
        smooth: point.smooth || (index > 0 && index < list.length - 1 ? 'smooth' : 'corner'),
    }));
}

export function sampleRoadAxis(road: RoadAxisSource) {
    const points = normalizeRoadPoints(road.points);
    if (points.length < 2) return points;
    const out = [];

    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const segmentLength = distance2(a, b);
        const shouldCurve = a.smooth !== 'corner' || b.smooth !== 'corner';
        const steps = shouldCurve ? Math.max(6, Math.ceil(segmentLength / 8)) : 1;

        for (let step = 0; step <= steps; step += 1) {
            if (i > 0 && step === 0) continue;
            const t = step / steps;
            const point = shouldCurve
                ? hermitePoint(points, i, t)
                : { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
            out.push(point);
        }
    }

    return out;
}

export function sampleRoadSegment(points: Point2D[], index: number) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) return [];
    const segmentLength = distance2(a, b);
    const shouldCurve = a.smooth !== 'corner' || b.smooth !== 'corner';
    const steps = shouldCurve ? Math.max(6, Math.ceil(segmentLength / 8)) : 1;
    const out = [];

    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const point = shouldCurve
            ? hermitePoint(points, index, t)
            : { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
        out.push(point);
    }

    return out;
}

export function hermitePoint(points: Point2D[], index: number, t: number) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const m1 = tangentForPoint(p0, p1, p2);
    const m2 = tangentForPoint(p1, p2, p3);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
        x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
        z: h00 * p1.z + h10 * m1.z + h01 * p2.z + h11 * m2.z,
    };
}

export function tangentForPoint(prev: Point2D, point: Point2D, next: Point2D) {
    if (point.smooth === 'corner') {
        return { x: 0, z: 0 };
    }
    const factor = point.smooth === 'auto' ? 0.32 : 0.5;
    return {
        x: (next.x - prev.x) * factor,
        z: (next.z - prev.z) * factor,
    };
}

export function getPointNormal(points: Point2D[], index: number) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    return { x: -tz / len, z: tx / len };
}

export function offsetPolyline(points: Point2D[], offset: number) {
    return points.map((point, index) => {
        const normal = getPointNormal(points, index);
        return {
            x: point.x + normal.x * offset,
            z: point.z + normal.z * offset,
        };
    });
}

export function polylineLength(points: Point2D[]) {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) length += distance2(points[i - 1], points[i]);
    return length;
}

export function samplePolylineRange(points: Point2D[], startM: number, endM: number, stepM: number) {
    const out = [];
    if (points.length < 2 || endM <= startM) return out;
    for (let d = startM; d <= endM + EPS; d += stepM) {
        out.push(pointAtDistance(points, Math.min(d, endM)));
    }
    if (out.length === 0 || distance2(out[out.length - 1], pointAtDistance(points, endM)) > EPS) {
        out.push(pointAtDistance(points, endM));
    }
    return out;
}

export function splitPolylineOutsideDiscs(points: Point2D[], discs: ClipDisc[] = []) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const clips = discs
        .map((disc) => ({
            center: disc.center,
            radiusM: Math.max(0, Number(disc.radiusM) || 0),
        }))
        .filter((disc) => disc.radiusM > EPS);
    if (clips.length === 0) return [points.map((point) => ({ ...point }))];

    const segments: Point2D[][] = [];
    let current: Point2D[] = [];

    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        if (distance2(a, b) <= EPS) continue;

        const outsideRanges = subtractInsideDiscRanges(clips, a, b);
        outsideRanges.forEach(([startT, endT]) => {
            if (endT - startT <= EPS) return;
            const start = interpolatePoint(a, b, startT);
            const end = interpolatePoint(a, b, endT);

            if (current.length === 0) {
                current.push(start);
            } else if (distance2(current[current.length - 1], start) > EPS) {
                pushFinishedPolyline(segments, current);
                current = [start];
            }
            current.push(end);

            if (endT < 1 - EPS) {
                pushFinishedPolyline(segments, current);
                current = [];
            }
        });

        if (outsideRanges.length === 0) {
            pushFinishedPolyline(segments, current);
            current = [];
        }
    }

    pushFinishedPolyline(segments, current);
    return segments;
}

export function pointAtDistance(points: Point2D[], targetM: number) {
    let traveled = 0;
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const seg = distance2(a, b);
        if (traveled + seg >= targetM) {
            const t = seg <= EPS ? 0 : (targetM - traveled) / seg;
            return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
        }
        traveled += seg;
    }
    return { ...points[points.length - 1] };
}

export function distance2(a: Point2D, b: Point2D) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distancePointToSegment(point: Point2D, a: Point2D, b: Point2D) {
    return nearestPointOnSegment(point, a, b).distance;
}

export function convexHull(points: Point2D[] = []) {
    const sorted = points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
        .map((point) => ({ x: point.x, z: point.z }))
        .sort((a, b) => a.x - b.x || a.z - b.z);

    if (sorted.length <= 1) return sorted;

    const lower = [];
    sorted.forEach((point) => {
        while (lower.length >= 2 && crossPoints(lower[lower.length - 2], lower[lower.length - 1], point) <= EPS) {
            lower.pop();
        }
        lower.push(point);
    });

    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const point = sorted[i];
        while (upper.length >= 2 && crossPoints(upper[upper.length - 2], upper[upper.length - 1], point) <= EPS) {
            upper.pop();
        }
        upper.push(point);
    }

    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

export function nearestPointOnSegment(point: Point2D, a: Point2D, b: Point2D) {
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const wx = point.x - a.x;
    const wz = point.z - a.z;
    const len2 = vx * vx + vz * vz;
    const t = len2 <= EPS ? 0 : clamp((wx * vx + wz * vz) / len2, 0, 1);
    const nearest = {
        x: a.x + vx * t,
        z: a.z + vz * t,
    };
    return {
        point: nearest,
        t,
        distance: Math.hypot(point.x - nearest.x, point.z - nearest.z),
    };
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function subtractInsideDiscRanges(discs: ClipDisc[], a: Point2D, b: Point2D) {
    const insideRanges = discs
        .flatMap((disc) => segmentDiscRange(a, b, disc))
        .sort((left, right) => left[0] - right[0]);
    if (insideRanges.length === 0) return [[0, 1]];

    const merged = [];
    insideRanges.forEach((range) => {
        const start = clamp(range[0], 0, 1);
        const end = clamp(range[1], 0, 1);
        if (end - start <= EPS) return;
        const previous = merged[merged.length - 1];
        if (previous && start <= previous[1] + EPS) {
            previous[1] = Math.max(previous[1], end);
            return;
        }
        merged.push([start, end]);
    });

    const outside = [];
    let cursor = 0;
    merged.forEach(([start, end]) => {
        if (start > cursor + EPS) outside.push([cursor, start]);
        cursor = Math.max(cursor, end);
    });
    if (cursor < 1 - EPS) outside.push([cursor, 1]);
    return outside;
}

function segmentDiscRange(a: Point2D, b: Point2D, disc: ClipDisc) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const fx = a.x - disc.center.x;
    const fz = a.z - disc.center.z;
    const aa = dx * dx + dz * dz;
    const bb = 2 * (fx * dx + fz * dz);
    const cc = fx * fx + fz * fz - disc.radiusM * disc.radiusM;

    if (aa <= EPS) return [];
    const discriminant = bb * bb - 4 * aa * cc;
    const aInside = cc <= EPS;
    const bInside = distance2(b, disc.center) <= disc.radiusM + EPS;

    if (discriminant < -EPS) return aInside && bInside ? [[0, 1]] : [];

    const sqrt = Math.sqrt(Math.max(0, discriminant));
    const t1 = (-bb - sqrt) / (2 * aa);
    const t2 = (-bb + sqrt) / (2 * aa);
    const start = clamp(Math.min(t1, t2), 0, 1);
    const end = clamp(Math.max(t1, t2), 0, 1);

    if (aInside && bInside) return [[0, 1]];
    if (aInside) return [[0, end]];
    if (bInside) return [[start, 1]];
    if (end <= 0 || start >= 1 || end - start <= EPS) return [];
    return [[start, end]];
}

function interpolatePoint(a: Point2D, b: Point2D, t: number) {
    return {
        x: lerp(a.x, b.x, clamp(t, 0, 1)),
        z: lerp(a.z, b.z, clamp(t, 0, 1)),
    };
}

function pushFinishedPolyline(segments: Point2D[][], points: Point2D[]) {
    if (points.length < 2) return;
    if (polylineLength(points) <= EPS) return;
    segments.push(points);
}

function crossPoints(origin: Point2D, a: Point2D, b: Point2D) {
    return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}
