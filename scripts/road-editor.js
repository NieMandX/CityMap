import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const DEFAULT_CENTER = { lat: 54.750676, lon: 55.996645 };
const DEFAULT_SIZE_M = 600;
const EPS = 1e-6;

const materials = {};
const dom = {};
const state = {
    mode: 'select',
    center: { ...DEFAULT_CENTER },
    sizeM: DEFAULT_SIZE_M,
    snapEnabled: true,
    snapM: 2,
    selectedRoadId: 'road-1',
    selectedRoundaboutId: null,
    selectedPointIndex: null,
    activeDrawRoadId: null,
    drag: null,
    underlayMode: 'satellite',
    roadSeq: 3,
    roundaboutSeq: 2,
    profiles: [
        {
            id: 'urban-asphalt',
            name: 'Urban asphalt',
            asphalt: '#25282b',
            marking: '#f5f7f8',
            curb: '#c7c7c2',
            sidewalk: '#858b8e',
            textureSet: 'procedural-default',
        },
    ],
    roads: [
        {
            id: 'road-1',
            name: 'Main road',
            profileId: 'urban-asphalt',
            points: [
                { x: -270, z: -42 },
                { x: -145, z: -30 },
                { x: -55, z: -18 },
                { x: 42, z: -6 },
                { x: 168, z: 20 },
                { x: 288, z: 34 },
            ],
            width: 18,
            lanes: 4,
            laneWidth: 3.5,
            sidewalkWidth: 2,
            sidewalkLeft: true,
            sidewalkRight: true,
            built: true,
            buildDirty: false,
        },
        {
            id: 'road-2',
            name: 'North approach',
            profileId: 'urban-asphalt',
            points: [
                { x: 28, z: 270 },
                { x: 22, z: 156 },
                { x: 16, z: 72 },
                { x: 11, z: 12 },
            ],
            width: 14,
            lanes: 2,
            laneWidth: 3.5,
            sidewalkWidth: 2,
            sidewalkLeft: true,
            sidewalkRight: true,
            built: true,
            buildDirty: false,
        },
        {
            id: 'road-3',
            name: 'Ramp',
            profileId: 'urban-asphalt',
            points: [
                { x: -6, z: -24 },
                { x: 28, z: -78 },
                { x: 82, z: -118 },
                { x: 182, z: -166 },
                { x: 292, z: -208 },
            ],
            width: 9,
            lanes: 1,
            laneWidth: 3.5,
            sidewalkWidth: 1.5,
            sidewalkLeft: false,
            sidewalkRight: true,
            built: true,
            buildDirty: false,
        },
    ],
    roundabouts: [
        {
            id: 'roundabout-1',
            name: 'Roundabout 1',
            center: { x: 10, z: -22 },
            radius: 42,
            width: 16,
            lanes: 2,
        },
    ],
};

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let pointer;
let groundPlane;
let gridHelper;
let underlayMesh;
let roadGroup;
let helperGroup;
let exportGroup;
let resizeObserver;

init();

function init() {
    collectDom();
    normalizeProjectState();
    initThree();
    initMaterials();
    bindUi();
    applyUnderlayMode('satellite');
    rebuildScene();
    setPerspectiveView();
    animate();
    setStatus('Ready. Draw mode adds spline points on the ground plane.');
}

function collectDom() {
    Object.assign(dom, {
        editor: document.querySelector('.road-editor'),
        canvas: document.getElementById('roadCanvas'),
        toolButtons: Array.from(document.querySelectorAll('[data-tool]')),
        topViewBtn: document.getElementById('topViewBtn'),
        perspectiveViewBtn: document.getElementById('perspectiveViewBtn'),
        resetViewBtn: document.getElementById('resetViewBtn'),
        mode3dChip: document.getElementById('mode3dChip'),
        modeTopChip: document.getElementById('modeTopChip'),
        snapBtn: document.getElementById('snapBtn'),
        gridBtn: document.getElementById('gridBtn'),
        buildRoadBtn: document.getElementById('buildRoadBtn'),
        buildSelectedRoadBtn: document.getElementById('buildSelectedRoadBtn'),
        exportJsonBtn: document.getElementById('exportJsonBtn'),
        exportGlbBtn: document.getElementById('exportGlbBtn'),
        clearBtn: document.getElementById('clearBtn'),
        deleteSelectedBtn: document.getElementById('deleteSelectedBtn'),
        centerLatInput: document.getElementById('centerLatInput'),
        centerLonInput: document.getElementById('centerLonInput'),
        sceneSizeInput: document.getElementById('sceneSizeInput'),
        snapSizeInput: document.getElementById('snapSizeInput'),
        applyBoundsBtn: document.getElementById('applyBoundsBtn'),
        uploadUnderlayBtn: document.getElementById('uploadUnderlayBtn'),
        underlayFileInput: document.getElementById('underlayFileInput'),
        underlaySelect: document.getElementById('underlaySelect'),
        underlayState: document.getElementById('underlayState'),
        yandexKeyInput: document.getElementById('yandexKeyInput'),
        yandexMaptypeInput: document.getElementById('yandexMaptypeInput'),
        loadYandexBtn: document.getElementById('loadYandexBtn'),
        roadNameInput: document.getElementById('roadNameInput'),
        roadFields: document.getElementById('roadFields'),
        roadWidthInput: document.getElementById('roadWidthInput'),
        roadLanesInput: document.getElementById('roadLanesInput'),
        laneWidthInput: document.getElementById('laneWidthInput'),
        sidewalkWidthInput: document.getElementById('sidewalkWidthInput'),
        sidewalkLeftInput: document.getElementById('sidewalkLeftInput'),
        sidewalkRightInput: document.getElementById('sidewalkRightInput'),
        nodeFields: document.getElementById('nodeFields'),
        pointSelectInput: document.getElementById('pointSelectInput'),
        pointSmoothInput: document.getElementById('pointSmoothInput'),
        pointIndexInput: document.getElementById('pointIndexInput'),
        roundaboutFields: document.getElementById('roundaboutFields'),
        roundaboutNameInput: document.getElementById('roundaboutNameInput'),
        roundaboutRadiusInput: document.getElementById('roundaboutRadiusInput'),
        roundaboutWidthInput: document.getElementById('roundaboutWidthInput'),
        roundaboutLanesInput: document.getElementById('roundaboutLanesInput'),
        statusText: document.getElementById('statusText'),
        coordText: document.getElementById('coordText'),
        objectCount: document.getElementById('objectCount'),
        selectionState: document.getElementById('selectionState'),
    });
}

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101316);
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 5000);

    renderer = new THREE.WebGLRenderer({
        canvas: dom.canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 60;
    controls.maxDistance = 1400;

    const ambient = new THREE.HemisphereLight(0xf5fbff, 0x1f2328, 2.3);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-180, 260, 160);
    scene.add(sun);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    roadGroup = new THREE.Group();
    roadGroup.name = 'CityMap generated roads';
    helperGroup = new THREE.Group();
    helperGroup.name = 'CityMap spline handles';
    exportGroup = new THREE.Group();
    exportGroup.name = 'CityMap export root';
    scene.add(roadGroup, helperGroup);

    gridHelper = new THREE.GridHelper(state.sizeM, Math.max(12, Math.round(state.sizeM / 25)), 0x6f7a83, 0x32383d);
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(dom.canvas.parentElement);
    resizeRenderer();

    dom.canvas.addEventListener('pointerdown', onPointerDown);
    dom.canvas.addEventListener('pointermove', onPointerMove);
    dom.canvas.addEventListener('pointerup', onPointerUp);
    dom.canvas.addEventListener('pointerleave', onPointerUp);
    dom.canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKeyDown);
}

function initMaterials() {
    materials.asphalt = new THREE.MeshStandardMaterial({
        color: 0x25282b,
        roughness: 0.86,
        metalness: 0.02,
    });
    materials.marking = new THREE.MeshBasicMaterial({ color: 0xf5f7f8 });
    materials.yellowMarking = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    materials.sidewalk = new THREE.MeshStandardMaterial({
        color: 0x858b8e,
        roughness: 0.92,
    });
    materials.curb = new THREE.MeshStandardMaterial({
        color: 0xc7c7c2,
        roughness: 0.86,
    });
    materials.island = new THREE.MeshStandardMaterial({
        color: 0x506644,
        roughness: 0.94,
    });
    materials.selectionLine = new THREE.LineBasicMaterial({
        color: 0x2d8cff,
        linewidth: 2,
    });
    materials.selectionRing = new THREE.MeshBasicMaterial({
        color: 0x2d8cff,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
    });
    materials.builtRoadPreview = new THREE.MeshBasicMaterial({
        color: 0x2d8cff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.dirtyRoadPreview = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.control = new THREE.MeshStandardMaterial({
        color: 0xffd23f,
        emissive: 0x332400,
        roughness: 0.55,
    });
    materials.controlSelected = new THREE.MeshStandardMaterial({
        color: 0x21a8ff,
        emissive: 0x08354f,
        roughness: 0.42,
    });
}

function bindUi() {
    dom.toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.tool));
    });

    dom.topViewBtn.addEventListener('click', setTopView);
    dom.modeTopChip.addEventListener('click', setTopView);
    dom.perspectiveViewBtn.addEventListener('click', setPerspectiveView);
    dom.mode3dChip.addEventListener('click', setPerspectiveView);
    dom.resetViewBtn.addEventListener('click', setPerspectiveView);

    dom.snapBtn.addEventListener('click', () => {
        state.snapEnabled = !state.snapEnabled;
        dom.snapBtn.classList.toggle('is-active', state.snapEnabled);
        setStatus(state.snapEnabled ? 'Snap enabled.' : 'Snap disabled.');
    });

    dom.gridBtn.addEventListener('click', () => {
        gridHelper.visible = !gridHelper.visible;
        dom.gridBtn.classList.toggle('is-active', gridHelper.visible);
    });

    dom.applyBoundsBtn.addEventListener('click', applyBoundsFromInputs);
    dom.uploadUnderlayBtn.addEventListener('click', () => dom.underlayFileInput.click());
    dom.underlayFileInput.addEventListener('change', onUnderlayFileChange);
    dom.underlaySelect.addEventListener('change', () => applyUnderlayMode(dom.underlaySelect.value));
    dom.loadYandexBtn.addEventListener('click', loadYandexUnderlay);

    dom.exportJsonBtn.addEventListener('click', exportProjectJson);
    dom.exportGlbBtn.addEventListener('click', exportGlb);
    dom.buildRoadBtn.addEventListener('click', buildSelectedRoad);
    dom.buildSelectedRoadBtn.addEventListener('click', buildSelectedRoad);
    dom.clearBtn.addEventListener('click', clearProject);
    dom.deleteSelectedBtn.addEventListener('click', deleteSelected);

    [
        dom.roadNameInput,
        dom.roadWidthInput,
        dom.roadLanesInput,
        dom.laneWidthInput,
        dom.sidewalkWidthInput,
        dom.sidewalkLeftInput,
        dom.sidewalkRightInput,
    ].forEach((input) => input.addEventListener('input', updateSelectedRoadFromInspector));

    dom.pointSelectInput.addEventListener('change', updateSelectedPointSelectionFromInspector);
    dom.pointSmoothInput.addEventListener('change', updateSelectedPointFromInspector);

    [
        dom.roundaboutNameInput,
        dom.roundaboutRadiusInput,
        dom.roundaboutWidthInput,
        dom.roundaboutLanesInput,
    ].forEach((input) => input.addEventListener('input', updateSelectedRoundaboutFromInspector));
}

function normalizeProjectState() {
    state.roads.forEach((road) => {
        road.profileId ||= state.profiles[0]?.id || 'urban-asphalt';
        road.points = normalizeRoadPoints(road.points);
        road.built = road.built !== false;
        road.buildDirty = !!road.buildDirty;
        if (road.built && (!Array.isArray(road.builtAxisPoints) || road.builtAxisPoints.length < 2)) {
            road.builtAxisPoints = sampleRoadAxis(road);
        }
    });
}

function normalizeRoadPoints(points) {
    return (points || []).map((point, index, list) => ({
        x: Number(point.x) || 0,
        z: Number(point.z) || 0,
        smooth: point.smooth || (index > 0 && index < list.length - 1 ? 'smooth' : 'corner'),
    }));
}

function setMode(mode) {
    state.mode = mode;
    state.activeDrawRoadId = mode === 'draw' ? state.activeDrawRoadId : null;
    dom.editor.dataset.mode = mode;
    dom.toolButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tool === mode));
    if (mode === 'draw') setStatus('Draw mode: click to add road spline points. Press Enter to start a new road.');
    if (mode === 'select') setStatus('Select mode: drag yellow control points to reshape roads.');
    if (mode === 'roundabout') setStatus('Roundabout mode: click the ground plane to place a procedural roundabout.');
}

function setTopView() {
    const distance = state.sizeM * 1.05;
    camera.position.set(0, distance, 0.01);
    controls.target.set(0, 0, 0);
    controls.enableRotate = false;
    controls.update();
    dom.modeTopChip.classList.add('is-active');
    dom.mode3dChip.classList.remove('is-active');
}

function setPerspectiveView() {
    camera.position.set(state.sizeM * 0.36, state.sizeM * 0.58, state.sizeM * 0.48);
    controls.target.set(0, 0, 0);
    controls.enableRotate = true;
    controls.update();
    dom.mode3dChip.classList.add('is-active');
    dom.modeTopChip.classList.remove('is-active');
}

function resizeRenderer() {
    const rect = dom.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function rebuildScene() {
    clearGroup(roadGroup);
    clearGroup(helperGroup);
    clearGroup(exportGroup);

    state.roundabouts.forEach((roundabout) => {
        const generated = createRoundaboutObjects(roundabout);
        generated.forEach((obj) => roadGroup.add(obj));
    });

    state.roads.forEach((road) => {
        const generated = createRoadObjects(road);
        generated.forEach((obj) => roadGroup.add(obj));
        createRoadHelpers(road).forEach((obj) => helperGroup.add(obj));
    });

    roadGroup.updateMatrixWorld(true);
    syncInspector();
    syncStats();
}

function createRoadObjects(road) {
    const objects = [];
    if (!road.built || !road.builtAxisPoints || road.builtAxisPoints.length < 2) return objects;

    const axisPoints = road.builtAxisPoints;
    const isSelected = state.selectedRoadId === road.id;

    const asphalt = buildRibbonMesh(axisPoints, road.width, 0.05, materials.asphalt);
    asphalt.name = `${road.name} asphalt`;
    asphalt.userData = { roadId: road.id, selectable: true, kind: 'road' };
    objects.push(asphalt);

    const curbHalf = road.width / 2 + 0.14;
    const leftCurb = buildRibbonMesh(offsetPolyline(axisPoints, curbHalf), 0.28, 0.09, materials.curb);
    const rightCurb = buildRibbonMesh(offsetPolyline(axisPoints, -curbHalf), 0.28, 0.09, materials.curb);
    leftCurb.name = `${road.name} left curb`;
    rightCurb.name = `${road.name} right curb`;
    leftCurb.userData = { roadId: road.id, selectable: true, kind: 'road' };
    rightCurb.userData = { roadId: road.id, selectable: true, kind: 'road' };
    objects.push(leftCurb, rightCurb);

    if (road.sidewalkLeft && road.sidewalkWidth > 0) {
        const sidewalk = buildRibbonMesh(
            offsetPolyline(axisPoints, road.width / 2 + road.sidewalkWidth / 2 + 0.42),
            road.sidewalkWidth,
            0.04,
            materials.sidewalk,
        );
        sidewalk.name = `${road.name} left sidewalk`;
        sidewalk.userData = { roadId: road.id, selectable: true, kind: 'road' };
        objects.push(sidewalk);
    }
    if (road.sidewalkRight && road.sidewalkWidth > 0) {
        const sidewalk = buildRibbonMesh(
            offsetPolyline(axisPoints, -road.width / 2 - road.sidewalkWidth / 2 - 0.42),
            road.sidewalkWidth,
            0.04,
            materials.sidewalk,
        );
        sidewalk.name = `${road.name} right sidewalk`;
        sidewalk.userData = { roadId: road.id, selectable: true, kind: 'road' };
        objects.push(sidewalk);
    }

    const edgeLeft = buildRibbonMesh(offsetPolyline(axisPoints, road.width / 2 - 0.45), 0.16, 0.12, materials.marking);
    const edgeRight = buildRibbonMesh(offsetPolyline(axisPoints, -road.width / 2 + 0.45), 0.16, 0.12, materials.marking);
    edgeLeft.name = `${road.name} left edge line`;
    edgeRight.name = `${road.name} right edge line`;
    objects.push(edgeLeft, edgeRight);

    const laneCount = Math.max(1, Math.round(road.lanes || 1));
    if (laneCount > 1) {
        const laneStep = road.width / laneCount;
        for (let i = 1; i < laneCount; i += 1) {
            const offset = -road.width / 2 + laneStep * i;
            const dashes = buildDashedLineMeshes(offsetPolyline(axisPoints, offset), 0.13, 4.2, 5.8, 0.14, materials.marking);
            dashes.forEach((dash, index) => {
                dash.name = `${road.name} lane dash ${i}.${index + 1}`;
                objects.push(dash);
            });
        }
    }

    const centerLine = buildLine(axisPoints, isSelected ? 0x2d8cff : 0x60717e, 1.16);
    centerLine.name = `${road.name} centerline`;
    objects.push(centerLine);

    return objects;
}

function createRoadHelpers(road) {
    const objects = [];
    const isSelectedRoad = road.id === state.selectedRoadId;
    if (isSelectedRoad && road.built && road.builtAxisPoints?.length >= 2) {
        const previewMaterial = road.buildDirty ? materials.dirtyRoadPreview : materials.builtRoadPreview;
        const footprint = buildRibbonMesh(road.builtAxisPoints, road.width + 1.2, 0.24, previewMaterial);
        footprint.name = `${road.name} generated 3D road footprint`;
        footprint.userData = { roadId: road.id, helper: true, kind: 'built-road-preview' };
        footprint.renderOrder = 2;
        objects.push(footprint);
    }

    const splineAxis = sampleRoadAxis(road);
    if (splineAxis.length >= 2) {
        const color = isSelectedRoad
            ? (road.buildDirty ? 0xffd23f : 0x2d8cff)
            : (road.built ? 0x60717e : 0x17c3b2);
        const splineLine = buildLine(splineAxis, color, 1.42);
        splineLine.name = `${road.name} editable spline`;
        splineLine.userData = { roadId: road.id, helper: true, kind: 'editable-spline' };
        splineLine.renderOrder = 3;
        objects.push(splineLine);
    }
    road.points.forEach((point, index) => {
        const selected = isSelectedRoad && index === state.selectedPointIndex;
        const handle = new THREE.Mesh(
            new THREE.SphereGeometry(selected ? 2.8 : 2.1, 18, 12),
            selected ? materials.controlSelected : materials.control,
        );
        handle.position.set(point.x, 1.8, point.z);
        handle.name = `${road.name} point ${index + 1}`;
        handle.userData = { roadId: road.id, pointIndex: index, helper: true };
        handle.renderOrder = 4;
        objects.push(handle);
    });
    return objects;
}

function createRoundaboutObjects(roundabout) {
    const objects = [];
    const outerR = roundabout.radius + roundabout.width / 2;
    const innerR = Math.max(4, roundabout.radius - roundabout.width / 2);
    const ring = buildRingMesh(roundabout.center, innerR, outerR, 0.07, materials.asphalt, 128);
    ring.name = `${roundabout.name} asphalt`;
    ring.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    objects.push(ring);

    const island = buildDiscMesh(roundabout.center, Math.max(2, innerR - 2.2), 0.08, materials.island, 96);
    island.name = `${roundabout.name} island`;
    island.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    objects.push(island);

    const innerCurb = buildCircleStrip(roundabout.center, innerR, 0.32, 0.13, materials.curb, 128);
    const outerCurb = buildCircleStrip(roundabout.center, outerR, 0.32, 0.13, materials.curb, 128);
    innerCurb.name = `${roundabout.name} inner curb`;
    outerCurb.name = `${roundabout.name} outer curb`;
    innerCurb.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    outerCurb.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    objects.push(innerCurb, outerCurb);

    const laneCount = Math.max(1, Math.round(roundabout.lanes || 1));
    if (laneCount > 1) {
        const laneStep = roundabout.width / laneCount;
        for (let i = 1; i < laneCount; i += 1) {
            const radius = innerR + laneStep * i;
            const dashed = buildDashedCircle(roundabout.center, radius, 0.12, 0.16, materials.marking, 96);
            dashed.forEach((obj, index) => {
                obj.name = `${roundabout.name} circular dash ${index + 1}`;
                objects.push(obj);
            });
        }
    }

    if (state.selectedRoundaboutId === roundabout.id) {
        const selection = buildCircleStrip(roundabout.center, outerR + 1.8, 0.36, 0.18, materials.selectionRing, 128);
        selection.name = `${roundabout.name} selection ring`;
        objects.push(selection);
    }

    return objects;
}

function buildRibbonMesh(points, width, y, material) {
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

function buildRingMesh(center, innerR, outerR, y, material, segments = 96) {
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

function buildDiscMesh(center, radius, y, material, segments = 72) {
    const vertices = [center.x, y, center.z];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        vertices.push(center.x + Math.cos(t) * radius, y, center.z + Math.sin(t) * radius);
    }
    for (let i = 1; i <= segments; i += 1) {
        indices.push(0, i, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}

function buildCircleStrip(center, radius, width, y, material, segments = 96) {
    return buildRingMesh(center, radius - width / 2, radius + width / 2, y, material, segments);
}

function buildDashedCircle(center, radius, width, y, material, segments = 96) {
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

function buildDashedLineMeshes(points, width, dashM, gapM, y, material) {
    const objects = [];
    const length = polylineLength(points);
    const cycle = dashM + gapM;
    for (let cursor = 0; cursor < length; cursor += cycle) {
        const segment = samplePolylineRange(points, cursor, Math.min(cursor + dashM, length), 1.4);
        if (segment.length >= 2) objects.push(buildRibbonMesh(segment, width, y, material));
    }
    return objects;
}

function buildLine(points, color, y = 1.1) {
    const positions = [];
    points.forEach((point) => positions.push(point.x, y, point.z));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
}

function sampleRoadAxis(road) {
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
                : { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) };
            out.push(point);
        }
    }

    return out;
}

function sampleRoadSegment(points, index) {
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
            : { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) };
        out.push(point);
    }

    return out;
}

function hermitePoint(points, index, t) {
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

function tangentForPoint(prev, point, next) {
    if (point.smooth === 'corner') {
        return { x: 0, z: 0 };
    }
    const factor = point.smooth === 'auto' ? 0.32 : 0.5;
    return {
        x: (next.x - prev.x) * factor,
        z: (next.z - prev.z) * factor,
    };
}

function getPointNormal(points, index) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    return { x: -tz / len, z: tx / len };
}

function offsetPolyline(points, offset) {
    return points.map((point, index) => {
        const normal = getPointNormal(points, index);
        return {
            x: point.x + normal.x * offset,
            z: point.z + normal.z * offset,
        };
    });
}

function polylineLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) length += distance2(points[i - 1], points[i]);
    return length;
}

function samplePolylineRange(points, startM, endM, stepM) {
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

function pointAtDistance(points, targetM) {
    let traveled = 0;
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const seg = distance2(a, b);
        if (traveled + seg >= targetM) {
            const t = seg <= EPS ? 0 : (targetM - traveled) / seg;
            return { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) };
        }
        traveled += seg;
    }
    return { ...points[points.length - 1] };
}

function distance2(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function clearGroup(group) {
    while (group.children.length) {
        const obj = group.children.pop();
        disposeObject(obj);
    }
}

function disposeObject(obj) {
    obj.traverse?.((child) => {
        child.geometry?.dispose?.();
    });
}

function onPointerDown(event) {
    const ground = getGroundPoint(event);
    if (!ground) return;

    if (state.mode === 'draw') {
        addDrawPoint(ground);
        return;
    }

    if (state.mode === 'roundabout') {
        addRoundabout(ground);
        return;
    }

    const hit = findNearestControlPoint(ground, 9);
    if (hit) {
        selectRoad(hit.road.id, hit.index);
        state.drag = { roadId: hit.road.id, pointIndex: hit.index };
        controls.enabled = false;
        rebuildScene();
        setStatus(`Dragging ${hit.road.name} node ${hit.index + 1}.`);
        return;
    }

    const roundaboutHit = findNearestRoundabout(ground);
    if (roundaboutHit) {
        selectRoundabout(roundaboutHit.roundabout.id);
        rebuildScene();
        setStatus(`Selected ${roundaboutHit.roundabout.name}.`);
        return;
    }

    const roadHit = findNearestRoad(ground);
    if (roadHit) {
        selectRoad(roadHit.road.id, null);
        rebuildScene();
        setStatus(`Selected ${roadHit.road.name}.`);
    }
}

function onPointerMove(event) {
    const ground = getGroundPoint(event);
    if (!ground) return;

    const geo = localToGeo(ground);
    dom.coordText.textContent = `${geo.lat.toFixed(6)} N, ${geo.lon.toFixed(6)} E`;

    if (!state.drag) return;
    const road = getSelectedRoad();
    if (!road) return;
    const point = road.points[state.drag.pointIndex];
    if (!point) return;
    point.x = ground.x;
    point.z = ground.z;
    markRoadDirty(road);
    rebuildScene();
}

function onPointerUp() {
    if (state.drag) {
        state.drag = null;
        controls.enabled = true;
        setStatus('Node updated. Press Build 3D to update the generated road.');
    }
}

function onDoubleClick(event) {
    if (state.mode !== 'select' || isEditableTarget(event.target)) return;
    event.preventDefault();
    const ground = getGroundPoint(event);
    if (!ground) return;

    const hit = findNearestRoadSegment(ground, 12);
    if (!hit) return;

    insertRoadPoint(hit.road, hit.segmentIndex, ground);
}

function onKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    if (event.key === 'Escape') {
        state.selectedPointIndex = null;
        state.activeDrawRoadId = null;
        state.selectedRoundaboutId = null;
        setMode('select');
        rebuildScene();
    }
    if (event.key === 'Enter' && state.mode === 'draw') {
        state.activeDrawRoadId = null;
        setStatus('Started a new draw road chain.');
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection()) {
        event.preventDefault();
        deleteSelected();
    }
}

function isEditableTarget(target) {
    const tagName = String(target?.tagName || '').toLowerCase();
    return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || target?.isContentEditable;
}

function getGroundPoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const out = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, out)) return null;
    const half = state.sizeM / 2;
    let x = THREE.MathUtils.clamp(out.x, -half, half);
    let z = THREE.MathUtils.clamp(out.z, -half, half);
    if (state.snapEnabled) {
        const snap = Math.max(0.01, state.snapM);
        x = Math.round(x / snap) * snap;
        z = Math.round(z / snap) * snap;
    }
    return { x, z };
}

function addDrawPoint(point) {
    let road = state.roads.find((item) => item.id === state.activeDrawRoadId);
    if (!road) {
        road = createDefaultRoad(point);
        state.roads.push(road);
        state.activeDrawRoadId = road.id;
        selectRoad(road.id, 0);
        setStatus('First spline node placed. Add one more point, then Build 3D.');
    } else {
        road.points.push({
            ...point,
            smooth: road.points.length > 0 ? 'smooth' : 'corner',
        });
        markRoadDirty(road);
        selectRoad(road.id, road.points.length - 1);
        setStatus(`${road.name}: ${road.points.length} spline nodes. Press Build 3D to generate the road.`);
    }
    rebuildScene();
}

function insertRoadPoint(road, segmentIndex, point) {
    if (!road || segmentIndex < 0 || segmentIndex >= road.points.length - 1) return;
    const insertIndex = segmentIndex + 1;
    road.points.splice(insertIndex, 0, {
        x: point.x,
        z: point.z,
        smooth: 'smooth',
    });
    rebuildGeneratedRoadAfterTopologyChange(road);
    selectRoad(road.id, insertIndex);
    rebuildScene();
    setStatus(`${road.name}: inserted node ${insertIndex + 1}. ${road.built ? '3D road rebuilt.' : 'Press Build 3D to generate the road.'}`);
}

function createDefaultRoad(point) {
    state.roadSeq += 1;
    const selected = getSelectedRoad();
    return {
        id: `road-${state.roadSeq}`,
        name: `Road ${state.roadSeq}`,
        profileId: selected?.profileId || state.profiles[0]?.id || 'urban-asphalt',
        points: [{ ...point, smooth: 'corner' }],
        width: selected?.width || 10,
        lanes: selected?.lanes || 2,
        laneWidth: selected?.laneWidth || 3.5,
        sidewalkWidth: selected?.sidewalkWidth || 2,
        sidewalkLeft: selected?.sidewalkLeft ?? true,
        sidewalkRight: selected?.sidewalkRight ?? true,
        built: false,
        buildDirty: true,
        builtAxisPoints: [],
    };
}

function addRoundabout(point) {
    state.roundaboutSeq += 1;
    const roundabout = {
        id: `roundabout-${state.roundaboutSeq}`,
        name: `Roundabout ${state.roundaboutSeq}`,
        center: point,
        radius: 36,
        width: 14,
        lanes: 2,
    };
    state.roundabouts.push(roundabout);
    selectRoundabout(roundabout.id);
    rebuildScene();
    setStatus('Roundabout placed.');
}

function findNearestControlPoint(point, thresholdM) {
    let best = null;
    state.roads.forEach((road) => {
        road.points.forEach((candidate, index) => {
            const distance = distance2(point, candidate);
            if (distance <= thresholdM && (!best || distance < best.distance)) {
                best = { road, index, distance };
            }
        });
    });
    return best;
}

function findNearestRoad(point) {
    let best = null;
    state.roads.forEach((road) => {
        const axis = road.built && road.builtAxisPoints?.length >= 2 ? road.builtAxisPoints : sampleRoadAxis(road);
        if (axis.length < 2) return;
        for (let i = 1; i < axis.length; i += 1) {
            const distance = distancePointToSegment(point, axis[i - 1], axis[i]);
            const threshold = Math.max(5, road.width / 2 + 3);
            if (distance <= threshold && (!best || distance < best.distance)) {
                best = { road, distance };
            }
        }
    });
    return best;
}

function findNearestRoadSegment(point, thresholdM) {
    let best = null;
    state.roads.forEach((road) => {
        const points = normalizeRoadPoints(road.points);
        if (points.length < 2) return;
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
            const segment = sampleRoadSegment(points, segmentIndex);
            for (let i = 1; i < segment.length; i += 1) {
                const candidate = nearestPointOnSegment(point, segment[i - 1], segment[i]);
                if (candidate.distance <= thresholdM && (!best || candidate.distance < best.distance)) {
                    best = {
                        road,
                        segmentIndex,
                        distance: candidate.distance,
                        point: candidate.point,
                    };
                }
            }
        }
    });
    return best;
}

function findNearestRoundabout(point) {
    let best = null;
    state.roundabouts.forEach((roundabout) => {
        const distanceFromCenter = distance2(point, roundabout.center);
        const outerR = roundabout.radius + roundabout.width / 2;
        const innerR = Math.max(4, roundabout.radius - roundabout.width / 2);
        const bandDistance = distanceFromCenter < innerR
            ? innerR - distanceFromCenter
            : Math.max(0, distanceFromCenter - outerR);
        const insideInteractiveDisc = distanceFromCenter <= outerR + 5;
        if (insideInteractiveDisc && (!best || bandDistance < best.distance)) {
            best = { roundabout, distance: bandDistance };
        }
    });
    return best;
}

function distancePointToSegment(point, a, b) {
    return nearestPointOnSegment(point, a, b).distance;
}

function nearestPointOnSegment(point, a, b) {
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const wx = point.x - a.x;
    const wz = point.z - a.z;
    const len2 = vx * vx + vz * vz;
    const t = len2 <= EPS ? 0 : THREE.MathUtils.clamp((wx * vx + wz * vz) / len2, 0, 1);
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

function syncInspector() {
    const road = getSelectedRoad();
    const roundabout = getSelectedRoundabout();
    const selectedPoint = road && Number.isInteger(state.selectedPointIndex)
        ? road.points[state.selectedPointIndex]
        : null;

    dom.roadFields.hidden = !road;
    dom.roundaboutFields.hidden = !roundabout;
    dom.nodeFields.hidden = !road || road.points.length === 0;
    dom.deleteSelectedBtn.disabled = !road && !roundabout;
    dom.buildRoadBtn.disabled = !road || road.points.length < 2;
    dom.buildSelectedRoadBtn.disabled = !road || road.points.length < 2;
    dom.pointSmoothInput.disabled = !selectedPoint;

    if (roundabout) {
        dom.selectionState.textContent = roundabout.name;
        dom.deleteSelectedBtn.textContent = 'Delete selected roundabout';
        dom.roundaboutNameInput.value = roundabout.name;
        dom.roundaboutRadiusInput.value = formatNumber(roundabout.radius);
        dom.roundaboutWidthInput.value = formatNumber(roundabout.width);
        dom.roundaboutLanesInput.value = String(roundabout.lanes);
        return;
    }

    if (!road) {
        dom.selectionState.textContent = 'none';
        dom.deleteSelectedBtn.textContent = 'Delete selected';
        return;
    }

    dom.selectionState.textContent = selectedPoint ? `${road.name} node ${state.selectedPointIndex + 1}` : road.name;
    dom.deleteSelectedBtn.textContent = selectedPoint ? 'Delete selected node' : 'Delete selected road';
    dom.roadNameInput.value = road.name;
    dom.roadWidthInput.value = formatNumber(road.width);
    dom.roadLanesInput.value = String(road.lanes);
    dom.laneWidthInput.value = formatNumber(road.laneWidth);
    dom.sidewalkWidthInput.value = formatNumber(road.sidewalkWidth);
    dom.sidewalkLeftInput.checked = !!road.sidewalkLeft;
    dom.sidewalkRightInput.checked = !!road.sidewalkRight;
    syncPointSelect(road);
    if (selectedPoint) {
        dom.pointSmoothInput.value = selectedPoint.smooth || 'corner';
        dom.pointIndexInput.value = `${state.selectedPointIndex + 1} / ${road.points.length}`;
    } else {
        dom.pointSmoothInput.value = 'corner';
        dom.pointIndexInput.value = '-';
    }
}

function syncPointSelect(road) {
    const currentValue = Number.isInteger(state.selectedPointIndex) ? String(state.selectedPointIndex) : '';
    dom.pointSelectInput.replaceChildren();

    const roadLevel = document.createElement('option');
    roadLevel.value = '';
    roadLevel.textContent = 'Road level';
    dom.pointSelectInput.append(roadLevel);

    road.points.forEach((point, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Node ${index + 1} (${formatSmoothMode(point.smooth)})`;
        dom.pointSelectInput.append(option);
    });

    dom.pointSelectInput.value = currentValue;
}

function updateSelectedRoadFromInspector() {
    const road = getSelectedRoad();
    if (!road) return;
    road.name = dom.roadNameInput.value.trim() || road.name;
    road.width = clampNumber(dom.roadWidthInput.value, 2, 80, road.width);
    road.lanes = Math.round(clampNumber(dom.roadLanesInput.value, 1, 8, road.lanes));
    road.laneWidth = clampNumber(dom.laneWidthInput.value, 2, 5, road.laneWidth);
    road.sidewalkWidth = clampNumber(dom.sidewalkWidthInput.value, 0, 8, road.sidewalkWidth);
    road.sidewalkLeft = dom.sidewalkLeftInput.checked;
    road.sidewalkRight = dom.sidewalkRightInput.checked;
    markRoadDirty(road);
    rebuildScene();
}

function updateSelectedPointFromInspector() {
    const road = getSelectedRoad();
    const point = road?.points[state.selectedPointIndex];
    if (!point) return;
    point.smooth = dom.pointSmoothInput.value;
    markRoadDirty(road);
    rebuildScene();
    setStatus(`${road.name} node ${state.selectedPointIndex + 1}: ${formatSmoothMode(point.smooth)}. Press Build 3D to update geometry.`);
}

function updateSelectedPointSelectionFromInspector() {
    const road = getSelectedRoad();
    if (!road) return;
    const nextIndex = dom.pointSelectInput.value === '' ? null : Number(dom.pointSelectInput.value);
    selectRoad(road.id, Number.isInteger(nextIndex) ? nextIndex : null);
    rebuildScene();
    setStatus(Number.isInteger(nextIndex) ? `Selected ${road.name} node ${nextIndex + 1}.` : `Selected ${road.name}.`);
}

function updateSelectedRoundaboutFromInspector() {
    const roundabout = getSelectedRoundabout();
    if (!roundabout) return;
    roundabout.name = dom.roundaboutNameInput.value.trim() || roundabout.name;
    roundabout.radius = clampNumber(dom.roundaboutRadiusInput.value, 6, 180, roundabout.radius);
    roundabout.width = clampNumber(dom.roundaboutWidthInput.value, 4, 60, roundabout.width);
    roundabout.lanes = Math.round(clampNumber(dom.roundaboutLanesInput.value, 1, 6, roundabout.lanes));
    rebuildScene();
}

function getSelectedRoad() {
    return state.roads.find((road) => road.id === state.selectedRoadId) || null;
}

function getSelectedRoundabout() {
    return state.roundabouts.find((roundabout) => roundabout.id === state.selectedRoundaboutId) || null;
}

function selectRoad(roadId, pointIndex = null) {
    state.selectedRoadId = roadId;
    state.selectedRoundaboutId = null;
    state.selectedPointIndex = pointIndex;
}

function selectRoundabout(roundaboutId) {
    state.selectedRoundaboutId = roundaboutId;
    state.selectedRoadId = null;
    state.selectedPointIndex = null;
    state.activeDrawRoadId = null;
}

function hasSelection() {
    return !!state.selectedRoadId || !!state.selectedRoundaboutId;
}

function hasSelectedPoint() {
    const road = getSelectedRoad();
    return !!road && Number.isInteger(state.selectedPointIndex) && !!road.points[state.selectedPointIndex];
}

function markRoadDirty(road) {
    if (!road) return;
    road.buildDirty = true;
}

function rebuildGeneratedRoadAfterTopologyChange(road) {
    if (!road) return;
    const wasBuilt = !!road.built;
    road.points = normalizeRoadPoints(road.points);
    if (road.points.length < 2) {
        road.built = false;
        road.builtAxisPoints = [];
        road.buildDirty = road.points.length > 0;
        return;
    }

    if (wasBuilt) {
        road.builtAxisPoints = sampleRoadAxis(road);
        road.built = true;
        road.buildDirty = false;
        return;
    }

    road.buildDirty = true;
}

function buildSelectedRoad() {
    const road = getSelectedRoad();
    if (!road) {
        setStatus('Select a road spline before building 3D geometry.');
        return;
    }
    if (road.points.length < 2) {
        setStatus(`${road.name} needs at least 2 spline nodes before Build 3D.`);
        return;
    }
    road.points = normalizeRoadPoints(road.points);
    road.builtAxisPoints = sampleRoadAxis(road);
    road.built = true;
    road.buildDirty = false;
    rebuildScene();
    setStatus(`${road.name} built as 3D road from ${road.points.length} spline nodes.`);
}

function deleteSelected() {
    if (hasSelectedPoint()) {
        deleteSelectedPoint();
        return;
    }
    if (state.selectedRoundaboutId) {
        deleteSelectedRoundabout();
        return;
    }
    deleteSelectedRoad();
}

function deleteSelectedPoint() {
    const road = getSelectedRoad();
    if (!road || !Number.isInteger(state.selectedPointIndex)) return;
    const removedIndex = state.selectedPointIndex;
    road.points.splice(removedIndex, 1);

    if (road.points.length === 0) {
        deleteSelectedRoad();
        return;
    }

    state.selectedPointIndex = Math.min(removedIndex, road.points.length - 1);
    rebuildGeneratedRoadAfterTopologyChange(road);
    rebuildScene();

    const nodeText = road.points.length === 1
        ? 'The road needs one more node before Build 3D.'
        : (road.built ? '3D road rebuilt as one continuous spline.' : 'Spline rebuilt as one continuous chain.');
    setStatus(`${road.name}: deleted node ${removedIndex + 1}. ${nodeText}`);
}

function deleteSelectedRoad() {
    if (!state.selectedRoadId) return;
    const index = state.roads.findIndex((road) => road.id === state.selectedRoadId);
    if (index < 0) return;
    const [removed] = state.roads.splice(index, 1);
    selectRoad(state.roads[Math.max(0, index - 1)]?.id || null, null);
    state.activeDrawRoadId = null;
    rebuildScene();
    setStatus(`Deleted ${removed.name}.`);
}

function deleteSelectedRoundabout() {
    if (!state.selectedRoundaboutId) return;
    const index = state.roundabouts.findIndex((roundabout) => roundabout.id === state.selectedRoundaboutId);
    if (index < 0) return;
    const [removed] = state.roundabouts.splice(index, 1);
    state.selectedRoundaboutId = state.roundabouts[Math.max(0, index - 1)]?.id || null;
    rebuildScene();
    setStatus(`Deleted ${removed.name}.`);
}

function clearProject() {
    state.roads = [];
    state.roundabouts = [];
    state.selectedRoadId = null;
    state.selectedRoundaboutId = null;
    state.selectedPointIndex = null;
    state.activeDrawRoadId = null;
    rebuildScene();
    setStatus('Project cleared.');
}

function syncStats() {
    const roadCount = state.roads.length;
    const pointCount = state.roads.reduce((sum, road) => sum + road.points.length, 0);
    const builtCount = state.roads.filter((road) => road.built).length;
    dom.objectCount.textContent = `${builtCount}/${roadCount} built`;
    if (roadCount === 1) {
        setPassiveStatus(`1 road, ${pointCount} nodes, ${state.roundabouts.length} roundabouts.`);
    }
}

function applyBoundsFromInputs() {
    state.center.lat = clampNumber(dom.centerLatInput.value, -85, 85, state.center.lat);
    state.center.lon = clampNumber(dom.centerLonInput.value, -180, 180, state.center.lon);
    state.sizeM = clampNumber(dom.sceneSizeInput.value, 50, 5000, state.sizeM);
    state.snapM = clampNumber(dom.snapSizeInput.value, 0.25, 20, state.snapM);
    gridHelper.geometry.dispose();
    gridHelper.geometry = new THREE.GridHelper(
        state.sizeM,
        Math.max(10, Math.round(state.sizeM / 25)),
        0x6f7a83,
        0x32383d,
    ).geometry;
    applyUnderlayMode(state.underlayMode);
    setPerspectiveView();
    setStatus('Project bounds updated.');
}

function applyUnderlayMode(mode) {
    state.underlayMode = mode;
    const texture = makeProceduralUnderlayTexture(mode);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    setUnderlayTexture(texture, mode);
}

function setUnderlayTexture(texture, label) {
    if (underlayMesh) {
        scene.remove(underlayMesh);
        underlayMesh.geometry.dispose();
        underlayMesh.material.map?.dispose?.();
        underlayMesh.material.dispose();
    }

    const geometry = new THREE.PlaneGeometry(state.sizeM, state.sizeM, 1, 1);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
    });
    underlayMesh = new THREE.Mesh(geometry, material);
    underlayMesh.name = `CityMap ${label} underlay`;
    underlayMesh.rotation.x = -Math.PI / 2;
    underlayMesh.position.y = -0.03;
    scene.add(underlayMesh);
    dom.underlayState.textContent = label;
}

function makeProceduralUnderlayTexture(mode) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = mode === 'scheme' ? '#d9dde0' : '#263029';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (mode === 'mask') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#000000';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        drawDemoUnderlayRoads(ctx, 54, false);
        drawDemoUnderlayRoads(ctx, 28, false);
        return new THREE.CanvasTexture(canvas);
    }

    if (mode === 'satellite') {
        const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
        gradient.addColorStop(0, '#303c32');
        gradient.addColorStop(0.5, '#1d2a27');
        gradient.addColorStop(1, '#384035');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 1024);
        drawNoiseBlocks(ctx);
        ctx.strokeStyle = 'rgba(220, 224, 220, 0.24)';
        drawDemoUnderlayRoads(ctx, 60, true);
        ctx.strokeStyle = 'rgba(45, 48, 50, 0.94)';
        drawDemoUnderlayRoads(ctx, 46, true);
    } else {
        ctx.fillStyle = '#d6dadc';
        ctx.fillRect(0, 0, 1024, 1024);
        ctx.fillStyle = '#c7d3c7';
        ctx.fillRect(0, 0, 350, 340);
        ctx.fillRect(690, 0, 334, 280);
        ctx.fillRect(100, 730, 240, 294);
        ctx.strokeStyle = '#ffffff';
        drawDemoUnderlayRoads(ctx, 56, true);
        ctx.strokeStyle = '#7d8588';
        drawDemoUnderlayRoads(ctx, 38, true);
    }

    return new THREE.CanvasTexture(canvas);
}

function drawNoiseBlocks(ctx) {
    const rng = seededRandom(17);
    for (let i = 0; i < 120; i += 1) {
        const x = rng() * 1024;
        const y = rng() * 1024;
        const w = 18 + rng() * 90;
        const h = 18 + rng() * 90;
        const light = 44 + rng() * 40;
        ctx.fillStyle = `rgba(${light}, ${light + 4}, ${light + 2}, ${0.16 + rng() * 0.24})`;
        ctx.fillRect(x, y, w, h);
    }
}

function drawDemoUnderlayRoads(ctx, width, useRoundCaps) {
    ctx.lineWidth = width;
    ctx.lineCap = useRoundCaps ? 'round' : 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 565);
    ctx.bezierCurveTo(220, 548, 380, 530, 1024, 450);
    ctx.moveTo(540, 0);
    ctx.bezierCurveTo(530, 220, 525, 330, 520, 1024);
    ctx.moveTo(500, 555);
    ctx.bezierCurveTo(565, 710, 700, 820, 1024, 900);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(518, 552, 70, 0, Math.PI * 2);
    ctx.stroke();
}

function seededRandom(seed) {
    let value = seed;
    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
}

function onUnderlayFileChange() {
    const file = dom.underlayFileInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    loader.load(
        url,
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            setUnderlayTexture(texture, 'uploaded');
            URL.revokeObjectURL(url);
            setStatus('Uploaded image underlay applied.');
        },
        undefined,
        (error) => {
            URL.revokeObjectURL(url);
            setStatus(`Image load failed: ${error?.message || 'unknown error'}`);
        },
    );
}

function loadYandexUnderlay() {
    const key = dom.yandexKeyInput.value.trim();
    if (!key) {
        setStatus('Yandex Static requires an API key. Use Upload image for screenshots.');
        return;
    }

    applyBoundsFromInputs();
    const url = buildYandexStaticUrl({
        key,
        center: state.center,
        sizeM: state.sizeM,
        maptype: dom.yandexMaptypeInput.value || 'map',
    });

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
        url,
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            setUnderlayTexture(texture, `yandex:${dom.yandexMaptypeInput.value}`);
            setStatus('Yandex Static underlay applied.');
        },
        undefined,
        (error) => {
            setStatus(`Yandex image failed to load. ${error?.message || 'Check key, CORS, and limits.'}`);
        },
    );
}

function buildYandexStaticUrl({ key, center, sizeM, maptype }) {
    const bbox = bboxFromCenterSize(center, sizeM);
    const params = new URLSearchParams();
    params.set('apikey', key);
    params.set('ll', `${center.lon.toFixed(7)},${center.lat.toFixed(7)}`);
    params.set('bbox', `${bbox.minLon.toFixed(7)},${bbox.minLat.toFixed(7)}~${bbox.maxLon.toFixed(7)},${bbox.maxLat.toFixed(7)}`);
    params.set('size', '450,450');
    params.set('scale', '2');
    params.set('lang', 'ru_RU');
    params.set('maptype', maptype);
    return `https://static-maps.yandex.ru/v1?${params.toString()}`;
}

function bboxFromCenterSize(center, sizeM) {
    const half = sizeM / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(1, 111320 * Math.cos(THREE.MathUtils.degToRad(center.lat)));
    const dLat = half / metersPerDegLat;
    const dLon = half / metersPerDegLon;
    return {
        minLat: center.lat - dLat,
        maxLat: center.lat + dLat,
        minLon: center.lon - dLon,
        maxLon: center.lon + dLon,
    };
}

function localToGeo(point) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = Math.max(1, 111320 * Math.cos(THREE.MathUtils.degToRad(state.center.lat)));
    return {
        lat: state.center.lat + point.z / metersPerDegLat,
        lon: state.center.lon + point.x / metersPerDegLon,
    };
}

function exportProjectJson() {
    const payload = {
        version: 1,
        source: 'CityMap MVP',
        center: state.center,
        sizeM: state.sizeM,
        roads: state.roads,
        roundabouts: state.roundabouts,
        exportedAt: new Date().toISOString(),
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'citymap-project.json');
    setStatus('Project JSON exported.');
}

async function exportGlb() {
    setStatus('Preparing GLB export...');
    clearGroup(exportGroup);
    roadGroup.children.forEach((child) => {
        if (child.isLine) return;
        const clone = cloneForExport(child);
        exportGroup.add(clone);
    });
    exportGroup.updateMatrixWorld(true);

    const exporter = new GLTFExporter();
    try {
        const arrayBuffer = await exporter.parseAsync(exportGroup, { binary: true });
        downloadBlob(new Blob([arrayBuffer], { type: 'model/gltf-binary' }), 'citymap-roads.glb');
        setStatus('GLB exported.');
    } catch (error) {
        setStatus(`GLB export failed: ${error?.message || error}`);
    } finally {
        clearGroup(exportGroup);
    }
}

function cloneForExport(source) {
    const clone = source.clone(true);
    clone.traverse((obj) => {
        obj.userData = {};
        if (obj.geometry?.clone) obj.geometry = obj.geometry.clone();
        if (Array.isArray(obj.material)) {
            obj.material = obj.material.map((material) => material?.clone?.() || material);
        } else if (obj.material?.clone) {
            obj.material = obj.material.clone();
        }
    });
    return clone;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return THREE.MathUtils.clamp(number, min, max);
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
}

function formatSmoothMode(mode) {
    if (mode === 'auto') return 'auto curve';
    if (mode === 'smooth') return 'smooth';
    return 'corner';
}

function setStatus(text) {
    dom.statusText.textContent = text;
}

function setPassiveStatus(text) {
    if (state.mode !== 'select') return;
    if (!state.drag) dom.statusText.textContent = text;
}
