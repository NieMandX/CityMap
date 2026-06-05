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
