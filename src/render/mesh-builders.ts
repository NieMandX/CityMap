import * as THREE from 'three/webgpu';
import {
    distance2,
    EPS,
    getPointNormal,
    polylineLength,
    samplePolylineRange,
    type Point2D,
} from '../core/geometry';

const MESH_WIREFRAME_Y_BIAS = 0.012;
const NORMAL_LINE_LENGTH_M = 2.4;
const NORMAL_LINE_BIAS_M = 0.08;
const MAX_NORMAL_LINES_PER_MESH = 260;

export function buildRibbonMesh(points: Point2D[], width: number, y: number, material: any) {
    if (!points || points.length < 2) {
        return new THREE.Mesh(new THREE.BufferGeometry(), material);
    }

    const vertices = [];
    const uvs = [];
    const indices = [];
    let distance = 0;

    for (let i = 0; i < points.length; i += 1) {
        if (i > 0) distance += distance2(points[i - 1], points[i]);
        const normal = getPointNormal(points, i);
        const left = {
            x: points[i].x + normal.x * width * 0.5,
            z: points[i].z + normal.z * width * 0.5,
        };
        const right = {
            x: points[i].x - normal.x * width * 0.5,
            z: points[i].z - normal.z * width * 0.5,
        };
        vertices.push(left.x, y, left.z, right.x, y, right.z);
        uvs.push(distance / Math.max(width, 1), 0, distance / Math.max(width, 1), 1);
    }

    for (let i = 0; i < points.length - 1; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildRibbonVolumeMesh(points: Point2D[], width: number, topY: number, baseY: number, material: any) {
    if (!points || points.length < 2) {
        return new THREE.Mesh(new THREE.BufferGeometry(), material);
    }

    const vertices = [];
    const uvs = [];
    const indices = [];
    const topLeft = [];
    const topRight = [];
    const bottomLeft = [];
    const bottomRight = [];
    const leftSideTop = [];
    const leftSideBottom = [];
    const rightSideTop = [];
    const rightSideBottom = [];
    let distance = 0;

    for (let i = 0; i < points.length; i += 1) {
        if (i > 0) distance += distance2(points[i - 1], points[i]);
        const normal = getPointNormal(points, i);
        const left = {
            x: points[i].x + normal.x * width * 0.5,
            z: points[i].z + normal.z * width * 0.5,
        };
        const right = {
            x: points[i].x - normal.x * width * 0.5,
            z: points[i].z - normal.z * width * 0.5,
        };
        const u = distance / Math.max(width, 1);
        topLeft.push(addGeometryVertex(vertices, uvs, left.x, topY, left.z, u, 0));
        topRight.push(addGeometryVertex(vertices, uvs, right.x, topY, right.z, u, 1));
        bottomLeft.push(addGeometryVertex(vertices, uvs, left.x, baseY, left.z, u, 0));
        bottomRight.push(addGeometryVertex(vertices, uvs, right.x, baseY, right.z, u, 1));
        leftSideTop.push(addGeometryVertex(vertices, uvs, left.x, topY, left.z, u, 0));
        leftSideBottom.push(addGeometryVertex(vertices, uvs, left.x, baseY, left.z, u, 1));
        rightSideTop.push(addGeometryVertex(vertices, uvs, right.x, topY, right.z, u, 0));
        rightSideBottom.push(addGeometryVertex(vertices, uvs, right.x, baseY, right.z, u, 1));
    }

    for (let i = 0; i < points.length - 1; i += 1) {
        const next = i + 1;
        pushQuad(indices, topLeft[i], topLeft[next], topRight[i], topRight[next]);
        pushQuad(indices, bottomLeft[i], bottomRight[i], bottomLeft[next], bottomRight[next]);
        pushQuad(indices, leftSideTop[i], leftSideBottom[i], leftSideTop[next], leftSideBottom[next]);
        pushQuad(indices, rightSideTop[i], rightSideTop[next], rightSideBottom[i], rightSideBottom[next]);
    }

    pushRibbonCap(indices, vertices, uvs, points, width, 0, topY, baseY, false);
    pushRibbonCap(indices, vertices, uvs, points, width, points.length - 1, topY, baseY, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildMeshWireframe(mesh: any, material: any) {
    if (!mesh?.geometry) return null;
    const geometry = new THREE.WireframeGeometry(mesh.geometry);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
        position.setY(i, position.getY(i) + MESH_WIREFRAME_Y_BIAS);
    }
    position.needsUpdate = true;
    const line = new THREE.LineSegments(geometry, material);
    line.name = `${mesh.name || 'mesh'} wireframe`;
    line.renderOrder = 5;
    line.userData = { helper: true, exportable: false };
    return line;
}

export function buildMeshNormals(mesh: any, material: any) {
    const sourceGeometry = mesh?.geometry;
    const position = sourceGeometry?.getAttribute('position');
    if (!position || position.count < 3) return null;

    const index = sourceGeometry.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    if (triangleCount <= 0) return null;

    const stride = Math.max(1, Math.ceil(triangleCount / MAX_NORMAL_LINES_PER_MESH));
    const vertices = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const center = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const triangle = new THREE.Triangle();

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += stride) {
        const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
        const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1;
        const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2;
        a.fromBufferAttribute(position, ia);
        b.fromBufferAttribute(position, ib);
        c.fromBufferAttribute(position, ic);
        triangle.set(a, b, c).getNormal(normal);
        if (normal.lengthSq() <= EPS) continue;

        center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        const start = center.clone().addScaledVector(normal, NORMAL_LINE_BIAS_M);
        const end = start.clone().addScaledVector(normal, NORMAL_LINE_LENGTH_M);
        vertices.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    if (vertices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const line = new THREE.LineSegments(geometry, material);
    line.name = `${mesh.name || 'mesh'} normals`;
    line.renderOrder = 6;
    line.userData = { helper: true, exportable: false, kind: 'normal-debug' };
    return line;
}

export function buildRingVolumeMesh(center: Point2D, innerR: number, outerR: number, topY: number, baseY: number, material: any, segments = 96) {
    const vertices = [];
    const uvs = [];
    const indices = [];
    const topOuter = [];
    const topInner = [];
    const bottomOuter = [];
    const bottomInner = [];
    const outerSideTop = [];
    const outerSideBottom = [];
    const innerSideTop = [];
    const innerSideBottom = [];
    const safeInnerR = Math.max(0.01, innerR);
    const safeOuterR = Math.max(safeInnerR + 0.01, outerR);

    for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const u = i / segments;
        const outerX = center.x + c * safeOuterR;
        const outerZ = center.z + s * safeOuterR;
        const innerX = center.x + c * safeInnerR;
        const innerZ = center.z + s * safeInnerR;
        topOuter.push(addGeometryVertex(vertices, uvs, outerX, topY, outerZ, u, 1));
        topInner.push(addGeometryVertex(vertices, uvs, innerX, topY, innerZ, u, 0));
        bottomOuter.push(addGeometryVertex(vertices, uvs, outerX, baseY, outerZ, u, 1));
        bottomInner.push(addGeometryVertex(vertices, uvs, innerX, baseY, innerZ, u, 0));
        outerSideTop.push(addGeometryVertex(vertices, uvs, outerX, topY, outerZ, u, 0));
        outerSideBottom.push(addGeometryVertex(vertices, uvs, outerX, baseY, outerZ, u, 1));
        innerSideTop.push(addGeometryVertex(vertices, uvs, innerX, topY, innerZ, u, 0));
        innerSideBottom.push(addGeometryVertex(vertices, uvs, innerX, baseY, innerZ, u, 1));
    }

    for (let i = 0; i < segments; i += 1) {
        const next = i + 1;
        pushQuad(indices, topOuter[i], topInner[i], topOuter[next], topInner[next]);
        pushQuad(indices, bottomOuter[i], bottomOuter[next], bottomInner[i], bottomInner[next]);
        pushQuad(indices, outerSideTop[i], outerSideTop[next], outerSideBottom[i], outerSideBottom[next]);
        pushQuad(indices, innerSideTop[i], innerSideBottom[i], innerSideTop[next], innerSideBottom[next]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildDiscVolumeMesh(center: Point2D, radius: number, topY: number, baseY: number, material: any, segments = 72) {
    const vertices = [];
    const uvs = [];
    const indices = [];
    const topCenter = addGeometryVertex(vertices, uvs, center.x, topY, center.z, 0.5, 0.5);
    const bottomCenter = addGeometryVertex(vertices, uvs, center.x, baseY, center.z, 0.5, 0.5);
    const topRing = [];
    const bottomRing = [];
    const sideTop = [];
    const sideBottom = [];
    const safeRadius = Math.max(0.01, radius);

    for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        const x = center.x + Math.cos(t) * safeRadius;
        const z = center.z + Math.sin(t) * safeRadius;
        const u = (Math.cos(t) + 1) / 2;
        const v = (Math.sin(t) + 1) / 2;
        topRing.push(addGeometryVertex(vertices, uvs, x, topY, z, u, v));
        bottomRing.push(addGeometryVertex(vertices, uvs, x, baseY, z, u, v));
        sideTop.push(addGeometryVertex(vertices, uvs, x, topY, z, i / segments, 0));
        sideBottom.push(addGeometryVertex(vertices, uvs, x, baseY, z, i / segments, 1));
    }

    for (let i = 0; i < segments; i += 1) {
        const next = i + 1;
        indices.push(topCenter, topRing[next], topRing[i]);
        indices.push(bottomCenter, bottomRing[i], bottomRing[next]);
        pushQuad(indices, sideTop[i], sideTop[next], sideBottom[i], sideBottom[next]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildPolygonVolumeMesh(points: Point2D[], topY: number, baseY: number, material: any) {
    if (!points || points.length < 3) {
        return new THREE.Mesh(new THREE.BufferGeometry(), material);
    }

    const vertices = [];
    const uvs = [];
    const indices = [];
    const center = points.reduce(
        (acc, point) => ({ x: acc.x + point.x / points.length, z: acc.z + point.z / points.length }),
        { x: 0, z: 0 },
    );
    const topCenter = addGeometryVertex(vertices, uvs, center.x, topY, center.z, 0.5, 0.5);
    const bottomCenter = addGeometryVertex(vertices, uvs, center.x, baseY, center.z, 0.5, 0.5);
    const topRing = [];
    const bottomRing = [];
    const sideTop = [];
    const sideBottom = [];
    const span = Math.max(1, ...points.map((point) => Math.max(Math.abs(point.x - center.x), Math.abs(point.z - center.z))));

    points.forEach((point) => {
        const u = 0.5 + (point.x - center.x) / (span * 2);
        const v = 0.5 + (point.z - center.z) / (span * 2);
        topRing.push(addGeometryVertex(vertices, uvs, point.x, topY, point.z, u, v));
        bottomRing.push(addGeometryVertex(vertices, uvs, point.x, baseY, point.z, u, v));
        sideTop.push(addGeometryVertex(vertices, uvs, point.x, topY, point.z, u, 0));
        sideBottom.push(addGeometryVertex(vertices, uvs, point.x, baseY, point.z, u, 1));
    });

    for (let i = 0; i < points.length; i += 1) {
        const next = (i + 1) % points.length;
        indices.push(topCenter, topRing[next], topRing[i]);
        indices.push(bottomCenter, bottomRing[i], bottomRing[next]);
        pushQuad(indices, sideTop[i], sideTop[next], sideBottom[i], sideBottom[next]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildPolygonBandVolumeMesh(innerPoints: Point2D[], outerPoints: Point2D[], topY: number, baseY: number, material: any) {
    const count = Math.min(innerPoints?.length || 0, outerPoints?.length || 0);
    if (count < 3) {
        return new THREE.Mesh(new THREE.BufferGeometry(), material);
    }

    const vertices = [];
    const uvs = [];
    const indices = [];
    const innerTop = [];
    const outerTop = [];
    const innerBottom = [];
    const outerBottom = [];
    const innerSideTop = [];
    const innerSideBottom = [];
    const outerSideTop = [];
    const outerSideBottom = [];

    for (let i = 0; i < count; i += 1) {
        const u = i / count;
        const inner = innerPoints[i];
        const outer = outerPoints[i];
        innerTop.push(addGeometryVertex(vertices, uvs, inner.x, topY, inner.z, u, 0));
        outerTop.push(addGeometryVertex(vertices, uvs, outer.x, topY, outer.z, u, 1));
        innerBottom.push(addGeometryVertex(vertices, uvs, inner.x, baseY, inner.z, u, 0));
        outerBottom.push(addGeometryVertex(vertices, uvs, outer.x, baseY, outer.z, u, 1));
        innerSideTop.push(addGeometryVertex(vertices, uvs, inner.x, topY, inner.z, u, 0));
        innerSideBottom.push(addGeometryVertex(vertices, uvs, inner.x, baseY, inner.z, u, 1));
        outerSideTop.push(addGeometryVertex(vertices, uvs, outer.x, topY, outer.z, u, 0));
        outerSideBottom.push(addGeometryVertex(vertices, uvs, outer.x, baseY, outer.z, u, 1));
    }

    for (let i = 0; i < count; i += 1) {
        const next = (i + 1) % count;
        pushQuad(indices, outerTop[i], innerTop[i], outerTop[next], innerTop[next]);
        pushQuad(indices, outerBottom[i], outerBottom[next], innerBottom[i], innerBottom[next]);
        pushQuad(indices, outerSideTop[i], outerSideTop[next], outerSideBottom[i], outerSideBottom[next]);
        pushQuad(indices, innerSideTop[i], innerSideBottom[i], innerSideTop[next], innerSideBottom[next]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

export function buildCircleStrip(center: Point2D, radius: number, width: number, y: number, material: any, segments = 96) {
    return buildRingMesh(center, radius - width / 2, radius + width / 2, y, material, segments);
}

export function buildDashedCircle(center: Point2D, radius: number, width: number, y: number, material: any, segments = 96) {
    const objects = [];
    const dashCount = 24;
    const dashAngle = (Math.PI * 2) / dashCount;
    for (let i = 0; i < dashCount; i += 1) {
        const start = i * dashAngle;
        const end = start + dashAngle * 0.46;
        const points = [];
        const steps = Math.max(3, Math.round(segments / dashCount));
        for (let j = 0; j <= steps; j += 1) {
            const t = start + (end - start) * (j / steps);
            points.push({ x: center.x + Math.cos(t) * radius, z: center.z + Math.sin(t) * radius });
        }
        objects.push(buildRibbonMesh(points, width, y, material));
    }
    return objects;
}

export function buildDashedLineMeshes(points: Point2D[], width: number, dashM: number, gapM: number, y: number, material: any) {
    const objects = [];
    const length = polylineLength(points);
    const cycle = dashM + gapM;
    for (let cursor = 0; cursor < length; cursor += cycle) {
        const segment = samplePolylineRange(points, cursor, Math.min(cursor + dashM, length), 1.4);
        if (segment.length >= 2) objects.push(buildRibbonMesh(segment, width, y, material));
    }
    return objects;
}

export function buildLine(points: Point2D[], color: number, y = 1.1) {
    const positions = [];
    points.forEach((point) => positions.push(point.x, y, point.z));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
}

function pushRibbonCap(indices, vertices, uvs, points: Point2D[], width: number, pointIndex: number, topY: number, baseY: number, endCap: boolean) {
    const point = points[pointIndex];
    const normal = getPointNormal(points, pointIndex);
    const left = {
        x: point.x + normal.x * width * 0.5,
        z: point.z + normal.z * width * 0.5,
    };
    const right = {
        x: point.x - normal.x * width * 0.5,
        z: point.z - normal.z * width * 0.5,
    };
    const topLeft = addGeometryVertex(vertices, uvs, left.x, topY, left.z, 0, 0);
    const topRight = addGeometryVertex(vertices, uvs, right.x, topY, right.z, 1, 0);
    const bottomLeft = addGeometryVertex(vertices, uvs, left.x, baseY, left.z, 0, 1);
    const bottomRight = addGeometryVertex(vertices, uvs, right.x, baseY, right.z, 1, 1);
    if (endCap) {
        pushQuad(indices, topLeft, bottomLeft, topRight, bottomRight);
        return;
    }
    pushQuad(indices, topLeft, topRight, bottomLeft, bottomRight);
}

function addGeometryVertex(vertices, uvs, x: number, y: number, z: number, u: number, v: number) {
    const index = vertices.length / 3;
    vertices.push(x, y, z);
    uvs.push(u, v);
    return index;
}

function pushQuad(indices, a, b, c, d) {
    indices.push(a, b, c, b, d, c);
}

function buildRingMesh(center: Point2D, innerR: number, outerR: number, y: number, material: any, segments = 96) {
    const vertices = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        vertices.push(center.x + c * outerR, y, center.z + s * outerR);
        vertices.push(center.x + c * innerR, y, center.z + s * innerR);
        uvs.push(i / segments, 1, i / segments, 0);
    }
    for (let i = 0; i < segments; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}
