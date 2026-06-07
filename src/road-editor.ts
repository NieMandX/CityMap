import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
    convexHull,
    distance2,
    distancePointToSegment,
    EPS,
    getPointNormal,
    nearestPointOnSegment,
    normalizeRoadPoints,
    offsetConvexPolygon,
    offsetPolyline,
    polylineLength,
    sampleRoadAxis,
    sampleRoadSegment,
    splitPolylineOutsideDiscs,
} from './core/geometry';
import {
    DEFAULT_LANE_WIDTH_M,
    calculateRoadLaneLayout,
    normalizeDividerType,
    normalizeTrafficDirection,
} from './core/lanes';
import { analyzeRoadTopology } from './core/topology';
import {
    buildCircleStrip,
    buildDashedCircle,
    buildDashedLineMeshes,
    buildDiscVolumeMesh,
    buildLine,
    buildMeshNormals,
    buildMeshWireframe,
    buildPolygonBandVolumeMesh,
    buildPolygonVolumeMesh,
    buildRibbonMesh,
    buildRibbonVolumeMesh,
    buildVariableRibbonMesh,
    buildVariableRibbonVolumeMesh,
    buildRingVolumeMesh,
} from './render/mesh-builders';

const DEFAULT_CENTER = { lat: 54.750676, lon: 55.996645 };
const DEFAULT_SIZE_M = 600;
const DEFAULT_ROAD_WIDTH_M = 10;
const DEFAULT_SIDEWALK_WIDTH_M = 2;
const DEFAULT_SEGMENT_TRANSITION = 'linear';
const DEFAULT_DIVIDER_WIDTH_M = 0;
const DEFAULT_DIVIDER_TYPE = 'line';
const ROAD_BASE_Y = 0;
const ROAD_SURFACE_Y = 0.18;
const SIDEWALK_BASE_Y = 0;
const SIDEWALK_SURFACE_Y = 0.28;
const CURB_BASE_Y = 0;
const CURB_SURFACE_Y = 0.42;
const ROAD_SELECTION_Y = CURB_SURFACE_Y + 0.045;
const MARKING_SURFACE_Y = ROAD_SURFACE_Y + 0.018;
const JUNCTION_MARKING_SURFACE_Y = ROAD_SURFACE_Y + 0.09;
const DIVIDER_MARKING_SURFACE_Y = ROAD_SURFACE_Y + 0.028;
const RAISED_DIVIDER_SURFACE_Y = ROAD_SURFACE_Y + 0.18;
const CURB_WIDTH_M = 0.32;
const EDGE_MARKING_INSET_M = 0.45;
const LANE_MARKING_WIDTH_M = 0.13;
const LANE_DASH_M = 4.2;
const LANE_GAP_M = 5.8;
const CROSSWALK_DEPTH_M = 4.2;
const CROSSWALK_STRIPE_WIDTH_M = 0.58;
const CROSSWALK_STRIPE_GAP_M = 0.78;
const STOP_BAR_WIDTH_M = 0.52;
const CONFLICT_GUIDE_WIDTH_M = 0.16;
const materials: Record<string, any> = {};
const dom: Record<string, any> = {};
const state: Record<string, any> = {
    mode: 'select',
    center: { ...DEFAULT_CENTER },
    sizeM: DEFAULT_SIZE_M,
    snapEnabled: true,
    snapM: 2,
    selectedRoadId: 'road-1',
    selectedRoundaboutId: null,
    selectedPointIndex: null,
    selectedSegmentIndex: null,
    editingRoadId: null,
    activeDrawRoadId: null,
    activeDrawInsertSide: null,
    drag: null,
    move: null,
    lastGroundPoint: null,
    underlayMode: 'satellite',
    showWireframe: true,
    showNormals: false,
    showTopology: true,
    topology: { hubs: [], junctionCount: 0, connectionCount: 0 },
    topologyDirty: false,
    clipRoadsForCurrentRebuild: true,
    renderTopologyForCurrentRebuild: null,
    unclippedRoadIdsForCurrentRebuild: new Set(),
    dragRebuildFrame: null,
    pendingDragRoadId: null,
    rendererBackend: 'pending',
    rendererForcedWebGL: false,
    rendererFallbackReason: '',
    roadSeq: 4,
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
            laneWidth: DEFAULT_LANE_WIDTH_M,
            trafficDirection: 'two-way',
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
            laneWidth: DEFAULT_LANE_WIDTH_M,
            trafficDirection: 'two-way',
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
            lanes: 2,
            laneWidth: DEFAULT_LANE_WIDTH_M,
            trafficDirection: 'one-way',
            sidewalkWidth: 1.5,
            sidewalkLeft: false,
            sidewalkRight: true,
            built: true,
            buildDirty: false,
        },
        {
            id: 'road-4',
            name: 'West connector',
            profileId: 'urban-asphalt',
            points: [
                { x: -226, z: 112, smooth: 'corner' },
                { x: -191, z: -36, smooth: 'corner' },
                { x: -156, z: -184, smooth: 'corner' },
            ],
            width: 10,
            lanes: 2,
            laneWidth: DEFAULT_LANE_WIDTH_M,
            trafficDirection: 'two-way',
            sidewalkWidth: 1.5,
            sidewalkLeft: true,
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

init().catch((error) => {
    console.error('CityMap failed to initialize.', error);
    if (!dom.statusText) collectDom();
    setStatus('Renderer initialization failed. Check console for details.');
    if (dom.rendererState) {
        dom.rendererState.textContent = 'Renderer failed';
        dom.rendererState.title = error?.message || 'Renderer initialization failed';
    }
});

async function init() {
    collectDom();
    normalizeProjectState();
    await initThree();
    initMaterials();
    bindUi();
    applyUnderlayMode('satellite');
    rebuildScene();
    setPerspectiveView();
    startRenderLoop();
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
        wireframeBtn: document.getElementById('wireframeBtn'),
        normalsBtn: document.getElementById('normalsBtn'),
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
        trafficDirectionInput: document.getElementById('trafficDirectionInput'),
        laneSummary: document.getElementById('laneSummary'),
        sidewalkWidthInput: document.getElementById('sidewalkWidthInput'),
        sidewalkLeftInput: document.getElementById('sidewalkLeftInput'),
        sidewalkRightInput: document.getElementById('sidewalkRightInput'),
        nodeFields: document.getElementById('nodeFields'),
        pointSelectInput: document.getElementById('pointSelectInput'),
        pointSmoothInput: document.getElementById('pointSmoothInput'),
        pointIndexInput: document.getElementById('pointIndexInput'),
        segmentFields: document.getElementById('segmentFields'),
        segmentSelectInput: document.getElementById('segmentSelectInput'),
        segmentTransitionInput: document.getElementById('segmentTransitionInput'),
        segmentRoadWidthInput: document.getElementById('segmentRoadWidthInput'),
        segmentTrafficDirectionInput: document.getElementById('segmentTrafficDirectionInput'),
        segmentLaneWidthInput: document.getElementById('segmentLaneWidthInput'),
        segmentLanesInput: document.getElementById('segmentLanesInput'),
        segmentForwardWidthInput: document.getElementById('segmentForwardWidthInput'),
        segmentBackwardWidthInput: document.getElementById('segmentBackwardWidthInput'),
        segmentForwardLanesInput: document.getElementById('segmentForwardLanesInput'),
        segmentBackwardLanesInput: document.getElementById('segmentBackwardLanesInput'),
        segmentDividerTypeInput: document.getElementById('segmentDividerTypeInput'),
        segmentDividerWidthInput: document.getElementById('segmentDividerWidthInput'),
        segmentLaneSummary: document.getElementById('segmentLaneSummary'),
        segmentSidewalkLeftWidthInput: document.getElementById('segmentSidewalkLeftWidthInput'),
        segmentSidewalkRightWidthInput: document.getElementById('segmentSidewalkRightWidthInput'),
        segmentSidewalkLeftInput: document.getElementById('segmentSidewalkLeftInput'),
        segmentSidewalkRightInput: document.getElementById('segmentSidewalkRightInput'),
        resetSegmentProfileBtn: document.getElementById('resetSegmentProfileBtn'),
        roundaboutFields: document.getElementById('roundaboutFields'),
        roundaboutNameInput: document.getElementById('roundaboutNameInput'),
        roundaboutRadiusInput: document.getElementById('roundaboutRadiusInput'),
        roundaboutWidthInput: document.getElementById('roundaboutWidthInput'),
        roundaboutLanesInput: document.getElementById('roundaboutLanesInput'),
        statusText: document.getElementById('statusText'),
        rendererState: document.getElementById('rendererState'),
        coordText: document.getElementById('coordText'),
        objectCount: document.getElementById('objectCount'),
        junctionCount: document.getElementById('junctionCount'),
        selectionState: document.getElementById('selectionState'),
    });
}

async function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101316);
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 5000);

    renderer = await createRenderer();
    syncRendererState();

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

async function createRenderer() {
    const params = new URLSearchParams(window.location.search);
    const forceWebGL = params.get('renderer') === 'webgl' || params.get('forceWebGL') === '1';
    state.rendererForcedWebGL = forceWebGL;

    try {
        const webgpuRenderer = new THREE.WebGPURenderer({
            canvas: dom.canvas,
            antialias: true,
            alpha: false,
            forceWebGL,
        });
        configureRenderer(webgpuRenderer);
        if (typeof webgpuRenderer.init === 'function') {
            await webgpuRenderer.init();
        }
        state.rendererBackend = getRendererBackendName(webgpuRenderer);
        state.rendererFallbackReason = forceWebGL ? 'Forced with ?renderer=webgl.' : '';
        return webgpuRenderer;
    } catch (error) {
        console.warn('WebGPURenderer initialization failed. Falling back to WebGL2 backend.', error);
        const webglRenderer = new THREE.WebGPURenderer({
            canvas: dom.canvas,
            antialias: true,
            alpha: false,
            forceWebGL: true,
        });
        configureRenderer(webglRenderer);
        if (typeof webglRenderer.init === 'function') {
            await webglRenderer.init();
        }
        state.rendererBackend = 'WebGL2';
        state.rendererFallbackReason = error?.message || 'WebGPURenderer initialization failed.';
        return webglRenderer;
    }
}

function configureRenderer(rendererInstance) {
    rendererInstance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererInstance.outputColorSpace = THREE.SRGBColorSpace;
    rendererInstance.toneMapping = THREE.ACESFilmicToneMapping;
    rendererInstance.toneMappingExposure = 1;
}

function getRendererBackendName(rendererInstance) {
    if (rendererInstance.backend?.isWebGPUBackend) return 'WebGPU';
    if (rendererInstance.backend?.isWebGLBackend) return 'WebGL2';
    if (rendererInstance.isWebGLRenderer) return 'WebGL2';
    if (rendererInstance.isWebGPURenderer) return 'WebGPU renderer';
    return 'GPU';
}

function syncRendererState() {
    if (!dom.rendererState) return;
    const forced = state.rendererForcedWebGL ? ' forced' : '';
    dom.rendererState.textContent = `${state.rendererBackend}${forced}`;
    dom.rendererState.title = state.rendererFallbackReason
        ? `Renderer: ${state.rendererBackend}. ${state.rendererFallbackReason}`
        : `Renderer: ${state.rendererBackend}`;
    dom.editor.dataset.renderer = state.rendererBackend.toLowerCase().replaceAll(' ', '-');
}

function initMaterials() {
    materials.asphalt = new THREE.MeshStandardMaterial({
        color: 0x25282b,
        roughness: 0.86,
        metalness: 0.02,
    });
    materials.marking = new THREE.MeshBasicMaterial({ color: 0xf5f7f8 });
    materials.yellowMarking = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    materials.junctionMarking = new THREE.MeshBasicMaterial({
        color: 0xf9fbff,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.junctionYellowMarking = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
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
    materials.segmentSelection = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.roadFootprint = new THREE.MeshBasicMaterial({
        color: 0xc6d1da,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.selectedRoadFootprint = new THREE.MeshBasicMaterial({
        color: 0x2d8cff,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    materials.draftRoadFootprint = new THREE.MeshBasicMaterial({
        color: 0x17c3b2,
        transparent: true,
        opacity: 0.12,
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
    materials.meshWireframe = new THREE.LineBasicMaterial({
        color: 0xe7f0f8,
        transparent: true,
        opacity: 0.32,
        depthTest: false,
        depthWrite: false,
    });
    materials.meshNormals = new THREE.LineBasicMaterial({
        color: 0x4dff88,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    });
    materials.junctionHub = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0.34,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    materials.junctionCore = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
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
    dom.wireframeBtn.addEventListener('click', () => {
        state.showWireframe = !state.showWireframe;
        syncDebugDisplayButtons();
        rebuildScene();
        setStatus(state.showWireframe ? 'Mesh wireframe visible.' : 'Mesh wireframe hidden.');
    });
    dom.normalsBtn.addEventListener('click', () => {
        state.showNormals = !state.showNormals;
        syncDebugDisplayButtons();
        rebuildScene();
        setStatus(state.showNormals ? 'Surface normals visible.' : 'Surface normals hidden.');
    });
    syncDebugDisplayButtons();

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
        dom.laneWidthInput,
        dom.trafficDirectionInput,
        dom.sidewalkWidthInput,
    ].forEach((input) => input.addEventListener('input', updateSelectedRoadFromInspector));
    [
        dom.sidewalkLeftInput,
        dom.sidewalkRightInput,
    ].forEach((input) => input.addEventListener('change', updateSelectedRoadFromInspector));

    dom.pointSelectInput.addEventListener('change', updateSelectedPointSelectionFromInspector);
    dom.pointSmoothInput.addEventListener('change', updateSelectedPointFromInspector);
    dom.segmentSelectInput.addEventListener('change', updateSelectedSegmentSelectionFromInspector);
    [
        dom.segmentTransitionInput,
        dom.segmentTrafficDirectionInput,
        dom.segmentDividerTypeInput,
    ].forEach((input) => input.addEventListener('change', updateSelectedSegmentFromInspector));
    [
        dom.segmentTransitionInput,
        dom.segmentRoadWidthInput,
        dom.segmentTrafficDirectionInput,
        dom.segmentLaneWidthInput,
        dom.segmentForwardWidthInput,
        dom.segmentBackwardWidthInput,
        dom.segmentForwardLanesInput,
        dom.segmentBackwardLanesInput,
        dom.segmentDividerWidthInput,
        dom.segmentSidewalkLeftWidthInput,
        dom.segmentSidewalkRightWidthInput,
    ].forEach((input) => input.addEventListener('input', updateSelectedSegmentFromInspector));
    [
        dom.segmentSidewalkLeftInput,
        dom.segmentSidewalkRightInput,
    ].forEach((input) => input.addEventListener('change', updateSelectedSegmentFromInspector));
    dom.resetSegmentProfileBtn.addEventListener('click', resetSelectedSegmentProfile);

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
        road.trafficDirection = normalizeTrafficDirection(road.trafficDirection);
        road.width = clampNumber(road.width ?? DEFAULT_ROAD_WIDTH_M, 2, 80, DEFAULT_ROAD_WIDTH_M);
        road.laneWidth = clampNumber(road.laneWidth ?? DEFAULT_LANE_WIDTH_M, 2, 5, DEFAULT_LANE_WIDTH_M);
        road.sidewalkWidth = clampNumber(road.sidewalkWidth ?? DEFAULT_SIDEWALK_WIDTH_M, 0, 8, DEFAULT_SIDEWALK_WIDTH_M);
        road.sidewalkLeft = road.sidewalkLeft !== false;
        road.sidewalkRight = road.sidewalkRight !== false;
        road.lanes = calculateRoadLaneLayout(road.width, road.laneWidth, road.trafficDirection).totalLanes;
        normalizeRoadSegmentProfileList(road);
        road.built = road.built !== false;
        road.buildDirty = !!road.buildDirty;
        if (road.built && (!Array.isArray(road.builtAxisPoints) || road.builtAxisPoints.length < 2)) {
            road.builtAxisPoints = sampleRoadAxis(road);
        }
    });
}

function normalizeRoadSegmentProfileList(road) {
    const segmentCount = getRoadSegmentCount(road);
    const source = Array.isArray(road.segmentProfiles) ? road.segmentProfiles : [];
    road.segmentProfiles = Array.from({ length: segmentCount }, (_, index) => {
        const profile = source[index];
        return profile ? normalizeRoadSegmentProfile(profile, road) : null;
    });
    return road.segmentProfiles;
}

function getRoadSegmentCount(road) {
    return Math.max(0, (road?.points?.length || 0) - 1);
}

function getEffectiveRoadProfile(road, segmentIndex = null) {
    if (!road) return normalizeRoadSegmentProfile({}, {});
    const profiles = normalizeRoadSegmentProfileList(road);
    const override = Number.isInteger(segmentIndex) ? profiles[segmentIndex] : null;
    return normalizeRoadSegmentProfile(override || {}, road);
}

function normalizeRoadSegmentProfile(profile, road) {
    const laneWidth = clampNumber(profile?.laneWidth ?? road?.laneWidth ?? DEFAULT_LANE_WIDTH_M, 2, 5, road?.laneWidth || DEFAULT_LANE_WIDTH_M);
    const trafficDirection = normalizeTrafficDirection(profile?.trafficDirection ?? road?.trafficDirection);
    const baseWidth = clampNumber(profile?.width ?? road?.width ?? DEFAULT_ROAD_WIDTH_M, 2, 80, road?.width || DEFAULT_ROAD_WIDTH_M);
    const sidewalkLeft = profile?.sidewalkLeft ?? road?.sidewalkLeft ?? true;
    const sidewalkRight = profile?.sidewalkRight ?? road?.sidewalkRight ?? true;
    const legacySidewalkWidth = profile?.sidewalkWidth ?? road?.sidewalkWidth ?? DEFAULT_SIDEWALK_WIDTH_M;
    const sidewalkLeftWidth = sidewalkLeft !== false
        ? clampNumber(profile?.sidewalkLeftWidth ?? legacySidewalkWidth, 0, 8, Number(legacySidewalkWidth) || DEFAULT_SIDEWALK_WIDTH_M)
        : 0;
    const sidewalkRightWidth = sidewalkRight !== false
        ? clampNumber(profile?.sidewalkRightWidth ?? legacySidewalkWidth, 0, 8, Number(legacySidewalkWidth) || DEFAULT_SIDEWALK_WIDTH_M)
        : 0;
    const sidewalkWidth = Math.max(sidewalkLeftWidth, sidewalkRightWidth);
    const dividerType = normalizeDividerType(profile?.dividerType ?? road?.dividerType ?? DEFAULT_DIVIDER_TYPE);
    const dividerWidth = clampNumber(profile?.dividerWidth ?? road?.dividerWidth ?? DEFAULT_DIVIDER_WIDTH_M, 0, 24, DEFAULT_DIVIDER_WIDTH_M);
    const directionWidths = normalizeDirectionalRoadWidths(profile, trafficDirection, baseWidth, dividerWidth);
    const width = trafficDirection === 'two-way'
        ? directionWidths.forwardWidth + directionWidths.backwardWidth + dividerWidth
        : baseWidth;
    const laneLayout = calculateRoadLaneLayout(width, laneWidth, trafficDirection, {
        forwardLanes: profile?.forwardLanes ?? getLegacyForwardLaneCount(profile, trafficDirection),
        backwardLanes: profile?.backwardLanes ?? getLegacyBackwardLaneCount(profile, trafficDirection),
        forwardWidth: directionWidths.forwardWidth,
        backwardWidth: directionWidths.backwardWidth,
        dividerWidth,
        dividerType,
    });
    return {
        width,
        lanes: laneLayout.totalLanes,
        laneWidth,
        trafficDirection: laneLayout.trafficDirection,
        forwardWidth: laneLayout.forwardWidthM,
        backwardWidth: laneLayout.backwardWidthM,
        forwardLanes: laneLayout.forwardLanes,
        backwardLanes: laneLayout.backwardLanes,
        dividerWidth: laneLayout.dividerWidthM,
        dividerType: laneLayout.dividerType,
        sidewalkWidth,
        sidewalkLeftWidth,
        sidewalkRightWidth,
        sidewalkLeft: sidewalkLeft !== false,
        sidewalkRight: sidewalkRight !== false,
        transition: normalizeSegmentTransition(profile?.transition),
    };
}

function normalizeDirectionalRoadWidths(profile, trafficDirection, width, dividerWidth = 0) {
    if (trafficDirection !== 'two-way') {
        return {
            forwardWidth: Math.max(0.5, Number(width) || DEFAULT_ROAD_WIDTH_M),
            backwardWidth: 0,
        };
    }

    const drivableWidth = Math.max(1, (Number(width) || DEFAULT_ROAD_WIDTH_M) - (Number(dividerWidth) || 0));
    const rawForward = Number(profile?.forwardWidth);
    const rawBackward = Number(profile?.backwardWidth);
    const hasForward = Number.isFinite(rawForward) && rawForward > 0;
    const hasBackward = Number.isFinite(rawBackward) && rawBackward > 0;
    let forwardWidth = hasForward ? rawForward : Math.max(0.5, hasBackward ? drivableWidth - rawBackward : drivableWidth / 2);
    let backwardWidth = hasBackward ? rawBackward : Math.max(0.5, hasForward ? drivableWidth - rawForward : drivableWidth / 2);
    const maxDrivableWidth = Math.max(1, 80 - (Number(dividerWidth) || 0));
    const currentDrivableWidth = forwardWidth + backwardWidth;

    if (currentDrivableWidth > maxDrivableWidth) {
        const scale = maxDrivableWidth / currentDrivableWidth;
        forwardWidth = Math.max(0.5, forwardWidth * scale);
        backwardWidth = Math.max(0.5, backwardWidth * scale);
    }

    return { forwardWidth, backwardWidth };
}

function getLegacyForwardLaneCount(profile, trafficDirection) {
    const lanes = Number(profile?.lanes);
    if (!Number.isFinite(lanes) || lanes < 1) return undefined;
    if (trafficDirection === 'one-way') return lanes;
    return Math.max(1, Math.ceil(lanes / 2));
}

function getLegacyBackwardLaneCount(profile, trafficDirection) {
    const lanes = Number(profile?.lanes);
    if (!Number.isFinite(lanes) || lanes < 1 || trafficDirection === 'one-way') return undefined;
    return Math.max(1, Math.floor(lanes / 2));
}

function normalizeSegmentTransition(value) {
    return value === 'step' || value === 'smooth' || value === 'linear'
        ? value
        : DEFAULT_SEGMENT_TRANSITION;
}

function setRoadSegmentProfile(road, segmentIndex, profile) {
    if (!road || !Number.isInteger(segmentIndex)) return null;
    const profiles = normalizeRoadSegmentProfileList(road);
    if (segmentIndex < 0 || segmentIndex >= profiles.length) return null;
    profiles[segmentIndex] = normalizeRoadSegmentProfile(profile, road);
    return profiles[segmentIndex];
}

function resetRoadSegmentProfile(road, segmentIndex) {
    if (!road || !Number.isInteger(segmentIndex)) return false;
    const profiles = normalizeRoadSegmentProfileList(road);
    if (segmentIndex < 0 || segmentIndex >= profiles.length) return false;
    profiles[segmentIndex] = null;
    return true;
}

function cloneSegmentProfile(profile) {
    return profile ? { ...profile } : null;
}

function createTransitionedProfileSamples(road, segmentIndex, axisPoints, fullAxisPoints = axisPoints) {
    const current = getEffectiveRoadProfile(road, segmentIndex);
    const previous = segmentIndex > 0 ? getEffectiveRoadProfile(road, segmentIndex - 1) : current;
    const fullLength = polylineLength(fullAxisPoints);
    const transitionLength = getSegmentTransitionLength(previous, current, fullLength);
    const startOffset = distanceAlongPolylineToNearestPoint(fullAxisPoints, axisPoints[0]);
    let traveled = 0;

    return axisPoints.map((point, index) => {
        if (index > 0) traveled += distance2(axisPoints[index - 1], point);
        const localDistance = startOffset + traveled;
        const blend = getSegmentTransitionBlend(current.transition, localDistance, transitionLength);
        return blendRoadProfiles(previous, current, blend);
    });
}

function getSegmentTransitionLength(previous, current, fullLength) {
    if (!previous || !current || current.transition === 'step' || fullLength <= EPS) return 0;
    const delta = Math.max(
        Math.abs((Number(current.width) || 0) - (Number(previous.width) || 0)),
        Math.abs(getProfileDirectionWidth(current, 'forward') - getProfileDirectionWidth(previous, 'forward')),
        Math.abs(getProfileDirectionWidth(current, 'backward') - getProfileDirectionWidth(previous, 'backward')),
        Math.abs(getProfileSidewalkWidth(current, 'left') - getProfileSidewalkWidth(previous, 'left')),
        Math.abs(getProfileSidewalkWidth(current, 'right') - getProfileSidewalkWidth(previous, 'right')),
        Math.abs(getProfileDividerWidth(current) - getProfileDividerWidth(previous)),
    );
    if (delta <= 0.01) return 0;
    const desired = Math.max(10, delta * 1.6, fullLength * 0.28);
    return Math.min(fullLength, 45, desired);
}

function getSegmentTransitionBlend(mode, localDistance, transitionLength) {
    if (mode === 'step' || transitionLength <= EPS) return 1;
    const t = THREE.MathUtils.clamp(localDistance / transitionLength, 0, 1);
    if (mode === 'smooth') return t * t * (3 - 2 * t);
    return t;
}

function blendRoadProfiles(previous, current, t) {
    const blend = THREE.MathUtils.clamp(Number(t) || 0, 0, 1);
    const leftSidewalkWidth = lerpNumber(getProfileSidewalkWidth(previous, 'left'), getProfileSidewalkWidth(current, 'left'), blend);
    const rightSidewalkWidth = lerpNumber(getProfileSidewalkWidth(previous, 'right'), getProfileSidewalkWidth(current, 'right'), blend);
    const forwardWidth = lerpNumber(getProfileDirectionWidth(previous, 'forward'), getProfileDirectionWidth(current, 'forward'), blend);
    const backwardWidth = lerpNumber(getProfileDirectionWidth(previous, 'backward'), getProfileDirectionWidth(current, 'backward'), blend);
    const dividerWidth = lerpNumber(getProfileDividerWidth(previous), getProfileDividerWidth(current), blend);
    return {
        ...current,
        width: current.trafficDirection === 'two-way'
            ? forwardWidth + backwardWidth + dividerWidth
            : lerpNumber(previous.width, current.width, blend),
        laneWidth: lerpNumber(previous.laneWidth, current.laneWidth, blend),
        sidewalkWidth: lerpNumber(previous.sidewalkWidth, current.sidewalkWidth, blend),
        forwardWidth,
        backwardWidth,
        dividerWidth,
        sidewalkLeftWidth: leftSidewalkWidth,
        sidewalkRightWidth: rightSidewalkWidth,
    };
}

function getProfileDirectionWidth(profile, direction) {
    if (!profile) return 0;
    if (profile.trafficDirection !== 'two-way') {
        return direction === 'forward' ? Math.max(0, Number(profile.width) || 0) : 0;
    }
    const key = direction === 'forward' ? 'forwardWidth' : 'backwardWidth';
    return Math.max(0, Number(profile[key]) || 0);
}

function getProfileSidewalkWidth(profile, side) {
    if (!profile) return 0;
    const enabled = side === 'left' ? profile.sidewalkLeft !== false : profile.sidewalkRight !== false;
    if (!enabled) return 0;
    const widthKey = side === 'left' ? 'sidewalkLeftWidth' : 'sidewalkRightWidth';
    return Math.max(0, Number(profile[widthKey] ?? profile.sidewalkWidth) || 0);
}

function getProfileDividerWidth(profile) {
    if (!profile || profile.trafficDirection !== 'two-way' || profile.dividerType === 'none') return 0;
    return Math.max(0, Number(profile.dividerWidth) || 0);
}

function lerpNumber(a, b, t) {
    return THREE.MathUtils.lerp(Number(a) || 0, Number(b) || 0, t);
}

function distanceAlongPolylineToNearestPoint(points, target) {
    if (!points || points.length < 2 || !target) return 0;
    let bestDistance = Infinity;
    let bestAlong = 0;
    let traveled = 0;

    for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        const segmentLength = distance2(a, b);
        if (segmentLength <= EPS) continue;
        const candidate = nearestPointOnSegment(target, a, b);
        if (candidate.distance < bestDistance) {
            bestDistance = candidate.distance;
            bestAlong = traveled + candidate.t * segmentLength;
        }
        traveled += segmentLength;
    }

    return bestAlong;
}

function setMode(mode) {
    if (state.move && mode !== 'move') {
        cancelRoadMove({ restoreMode: false, silent: true });
    }
    state.mode = mode;
    state.activeDrawRoadId = mode === 'draw' ? state.activeDrawRoadId : null;
    state.activeDrawInsertSide = mode === 'draw' ? state.activeDrawInsertSide : null;
    if (mode !== 'select') {
        state.editingRoadId = null;
        state.selectedPointIndex = null;
        state.selectedSegmentIndex = null;
    }
    dom.editor.dataset.mode = mode;
    dom.toolButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tool === mode));
    if (mode === 'draw') setStatus('Draw mode: click to add road spline points. Press Enter to start a new road.');
    if (mode === 'move') {
        beginSelectedRoadMove();
        return;
    }
    if (mode === 'select') setStatus('Select mode: click a road to select it. Use Move or G to move it.');
    if (mode === 'roundabout') setStatus('Roundabout mode: click the ground plane to place a procedural roundabout.');
}

function syncDebugDisplayButtons() {
    dom.wireframeBtn.classList.toggle('is-active', state.showWireframe);
    dom.wireframeBtn.setAttribute('aria-pressed', String(state.showWireframe));
    dom.normalsBtn.classList.toggle('is-active', state.showNormals);
    dom.normalsBtn.setAttribute('aria-pressed', String(state.showNormals));
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

function startRenderLoop() {
    renderer.setAnimationLoop(renderFrame);
}

function renderFrame() {
    controls.update();
    renderer.render(scene, camera);
}

function rebuildScene(options: Record<string, any> = {}) {
    const refreshTopology = options.refreshTopology !== false;
    const includeTopologyObjects = options.includeTopologyObjects !== false;
    const clipRoads = options.clipRoads !== false;
    const changedRoadIds = Array.isArray(options.changedRoadIds) ? options.changedRoadIds.filter(Boolean) : [];
    const excludedTopologyRoadIds = new Set(Array.isArray(options.excludeTopologyRoadIds) ? options.excludeTopologyRoadIds.filter(Boolean) : []);
    const unclippedRoadIds = new Set(Array.isArray(options.unclippedRoadIds) ? options.unclippedRoadIds.filter(Boolean) : []);
    const preserveUnrelatedTopologyObjects = options.preserveUnrelatedTopologyObjects === true && excludedTopologyRoadIds.size > 0;
    const syncUi = options.syncUi !== false;
    const preservedRoadTopologyObjects = preserveUnrelatedTopologyObjects
        ? detachPreservedTopologyObjects(roadGroup, excludedTopologyRoadIds)
        : [];
    const preservedHelperTopologyObjects = preserveUnrelatedTopologyObjects
        ? detachPreservedTopologyObjects(helperGroup, excludedTopologyRoadIds)
        : [];

    clearGroup(roadGroup);
    clearGroup(helperGroup);
    clearGroup(exportGroup);
    if (refreshTopology) {
        state.topology = analyzeRoadTopology(state.roads, {
            mergeRadiusM: 18,
            endpointSnapRadiusM: 10,
            roundabouts: state.roundabouts,
            changedRoadIds,
            previousTopology: changedRoadIds.length > 0 ? state.topology : undefined,
        });
        state.topologyDirty = false;
    } else {
        state.topologyDirty = true;
    }
    const renderTopology = filterTopologyForRender(state.topology, excludedTopologyRoadIds);
    state.clipRoadsForCurrentRebuild = clipRoads;
    state.renderTopologyForCurrentRebuild = renderTopology;
    state.unclippedRoadIdsForCurrentRebuild = unclippedRoadIds;

    state.roundabouts.forEach((roundabout) => {
        const generated = createRoundaboutObjects(roundabout);
        generated.forEach((obj) => roadGroup.add(obj));
    });

    if (preserveUnrelatedTopologyObjects) {
        preservedRoadTopologyObjects.forEach((obj) => roadGroup.add(obj));
    } else if (includeTopologyObjects) {
        createJunctionObjects(renderTopology).forEach((obj) => roadGroup.add(obj));
    }

    state.roads.forEach((road) => {
        const generated = createRoadObjects(road);
        generated.forEach((obj) => roadGroup.add(obj));
        createRoadHelpers(road).forEach((obj) => helperGroup.add(obj));
    });
    state.clipRoadsForCurrentRebuild = true;
    state.renderTopologyForCurrentRebuild = null;
    state.unclippedRoadIdsForCurrentRebuild = new Set();
    if (preserveUnrelatedTopologyObjects) {
        preservedHelperTopologyObjects.forEach((obj) => helperGroup.add(obj));
    } else if (includeTopologyObjects) {
        createTopologyHelpers(renderTopology).forEach((obj) => helperGroup.add(obj));
    }

    roadGroup.updateMatrixWorld(true);
    if (syncUi) {
        syncInspector();
        syncStats();
    }
}

function rebuildSceneForDrag(changedRoadId = null) {
    if (changedRoadId) {
        rebuildChangedRoadSceneForDrag(changedRoadId);
        return;
    }
    const changedRoadIds = changedRoadId ? [changedRoadId] : [];
    rebuildScene({
        refreshTopology: false,
        includeTopologyObjects: changedRoadIds.length > 0,
        clipRoads: true,
        excludeTopologyRoadIds: changedRoadIds,
        unclippedRoadIds: changedRoadIds,
        preserveUnrelatedTopologyObjects: changedRoadIds.length > 0,
        syncUi: false,
    });
}

function rebuildChangedRoadSceneForDrag(roadId) {
    const road = getRoadById(roadId);
    if (!road) return;

    const excludedRoadIds = new Set([roadId]);
    const renderTopology = filterTopologyForRender(state.topology, excludedRoadIds);
    state.topologyDirty = true;

    removeGroupObjects(roadGroup, (obj) => isRoadOwnedSceneObject(obj, roadId) || isTopologyObjectAffectedByRoad(obj, roadId));
    removeGroupObjects(helperGroup, (obj) => isRoadOwnedSceneObject(obj, roadId) || isTopologyObjectAffectedByRoad(obj, roadId));
    clearGroup(exportGroup);

    state.clipRoadsForCurrentRebuild = true;
    state.renderTopologyForCurrentRebuild = renderTopology;
    state.unclippedRoadIdsForCurrentRebuild = new Set([roadId]);

    try {
        createRoadObjects(road).forEach((obj) => roadGroup.add(obj));
        createRoadHelpers(road).forEach((obj) => helperGroup.add(obj));
    } finally {
        state.clipRoadsForCurrentRebuild = true;
        state.renderTopologyForCurrentRebuild = null;
        state.unclippedRoadIdsForCurrentRebuild = new Set();
    }
    roadGroup.updateMatrixWorld(true);
    helperGroup.updateMatrixWorld(true);
}

function beginSelectedRoadMove(anchorPoint = null) {
    const road = getSelectedRoad();
    if (!road) {
        state.move = null;
        setStatus('Move tool: select a road first.');
        return false;
    }

    state.selectedRoundaboutId = null;
    state.editingRoadId = null;
    state.selectedPointIndex = null;
    state.selectedSegmentIndex = null;
    state.activeDrawRoadId = null;
    state.activeDrawInsertSide = null;
    state.move = {
        type: 'road',
        roadId: road.id,
        start: anchorPoint ? { ...anchorPoint } : null,
        originalPoints: road.points.map((point) => ({ ...point })),
        originalBuiltAxisPoints: Array.isArray(road.builtAxisPoints)
            ? road.builtAxisPoints.map((point) => ({ ...point }))
            : [],
        currentDx: 0,
        currentDz: 0,
    };
    controls.enabled = false;
    prepareRoadMovePreview(road.id);
    syncInspector();
    setStatus(`${road.name}: move active. Move the mouse, then click to confirm.`);
    return true;
}

function prepareRoadMovePreview(roadId) {
    const road = getRoadById(roadId);
    if (!road) return;

    const excludedRoadIds = new Set([roadId]);
    const renderTopology = filterTopologyForRender(state.topology, excludedRoadIds);
    state.topologyDirty = true;

    removeGroupObjects(roadGroup, (obj) => isRoadOwnedSceneObject(obj, roadId) || isTopologyObjectAffectedByRoad(obj, roadId));
    removeGroupObjects(helperGroup, (obj) => isRoadOwnedSceneObject(obj, roadId) || isTopologyObjectAffectedByRoad(obj, roadId));
    clearGroup(exportGroup);

    state.clipRoadsForCurrentRebuild = true;
    state.renderTopologyForCurrentRebuild = renderTopology;
    state.unclippedRoadIdsForCurrentRebuild = new Set([roadId]);

    try {
        createRoadObjects(road).forEach((obj) => roadGroup.add(obj));
        createRoadHelpers(road).forEach((obj) => helperGroup.add(obj));
    } finally {
        state.clipRoadsForCurrentRebuild = true;
        state.renderTopologyForCurrentRebuild = null;
        state.unclippedRoadIdsForCurrentRebuild = new Set();
    }
    roadGroup.updateMatrixWorld(true);
    helperGroup.updateMatrixWorld(true);
}

function updateRoadMovePreview(ground) {
    if (!state.move || state.move.type !== 'road' || !ground) return;
    if (!state.move.start) {
        state.move.start = { ...ground };
        return;
    }
    const dx = ground.x - state.move.start.x;
    const dz = ground.z - state.move.start.z;
    state.move.currentDx = dx;
    state.move.currentDz = dz;
    moveRoadSceneObjects(state.move.roadId, dx, dz);
}

function moveRoadSceneObjects(roadId, dx, dz) {
    [roadGroup, helperGroup].forEach((group) => {
        group.children.forEach((obj) => {
            if (!isRoadOwnedSceneObject(obj, roadId)) return;
            obj.position.set(dx, 0, dz);
        });
    });
    roadGroup.updateMatrixWorld(true);
    helperGroup.updateMatrixWorld(true);
}

function confirmRoadMove() {
    const move = state.move;
    if (!move || move.type !== 'road') return;
    const road = getRoadById(move.roadId);
    const dx = Number(move.currentDx) || 0;
    const dz = Number(move.currentDz) || 0;
    state.move = null;
    controls.enabled = true;
    if (!road) {
        setMode('select');
        rebuildScene();
        return;
    }
    road.points = translateRoadPoints(move.originalPoints, dx, dz);
    if (road.built && move.originalBuiltAxisPoints.length >= 2) {
        road.builtAxisPoints = translateRoadPoints(move.originalBuiltAxisPoints, dx, dz);
        road.buildDirty = false;
    } else {
        rebuildGeneratedRoadAfterGeometryChange(road);
    }
    setMode('select');
    rebuildSceneForChangedRoad(road.id);
    setStatus(`${road.name} moved. Junctions recalculated.`);
}

function cancelRoadMove(options: { restoreMode?: boolean; silent?: boolean } = {}) {
    const move = state.move;
    if (!move || move.type !== 'road') return;
    const road = getRoadById(move.roadId);
    state.move = null;
    controls.enabled = true;
    if (road) {
        road.points = move.originalPoints.map((point) => ({ ...point }));
        if (move.originalBuiltAxisPoints.length >= 2) {
            road.builtAxisPoints = move.originalBuiltAxisPoints.map((point) => ({ ...point }));
        }
    }
    if (options.restoreMode !== false) setMode('select');
    rebuildScene();
    if (!options.silent) setStatus(road ? `${road.name} move canceled.` : 'Move canceled.');
}

function translateRoadPoints(points, dx, dz) {
    return points.map((point) => ({
        ...point,
        x: point.x + dx,
        z: point.z + dz,
    }));
}

function rebuildSceneForChangedRoad(roadId) {
    rebuildScene({
        changedRoadIds: roadId ? [roadId] : [],
    });
}

function scheduleRebuildSceneForDrag(changedRoadId = null) {
    if (changedRoadId) state.pendingDragRoadId = changedRoadId;
    if (state.dragRebuildFrame !== null) return;
    state.dragRebuildFrame = requestAnimationFrame(() => {
        const roadId = state.pendingDragRoadId;
        state.dragRebuildFrame = null;
        state.pendingDragRoadId = null;
        rebuildSceneForDrag(roadId);
    });
}

function cancelScheduledDragRebuild() {
    if (state.dragRebuildFrame === null) return;
    cancelAnimationFrame(state.dragRebuildFrame);
    state.dragRebuildFrame = null;
    state.pendingDragRoadId = null;
}

function filterTopologyForRender(topology, excludedRoadIds) {
    if (!excludedRoadIds?.size || !topology?.hubs?.length) return topology;
    const hubs = topology.hubs.filter((hub) => !hub.roadIds?.some((roadId) => excludedRoadIds.has(roadId)));
    return {
        hubs,
        junctionCount: hubs.filter((hub) => hub.kind === 'junction').length,
        connectionCount: hubs.filter((hub) => hub.kind === 'connection').length,
    };
}

function detachPreservedTopologyObjects(group, excludedRoadIds) {
    const preserved = [];
    for (let index = group.children.length - 1; index >= 0; index -= 1) {
        const child = group.children[index];
        if (!isUnaffectedTopologyObject(child, excludedRoadIds)) continue;
        group.remove(child);
        preserved.push(child);
    }
    return preserved;
}

function removeGroupObjects(group, predicate) {
    for (let index = group.children.length - 1; index >= 0; index -= 1) {
        const child = group.children[index];
        if (!predicate(child)) continue;
        group.remove(child);
        disposeObject(child);
    }
}

function isUnaffectedTopologyObject(obj, excludedRoadIds) {
    if (!isTopologySceneObject(obj)) return false;
    const roadIds = getSceneObjectRoadIds(obj);
    if (roadIds.length === 0) return false;
    return roadIds.every((roadId) => !excludedRoadIds.has(roadId));
}

function isRoadOwnedSceneObject(obj, roadId) {
    const data = obj?.userData || {};
    if (data.roadId !== roadId) return false;
    return data.kind === 'road' || data.helper === true || data.kind === 'normal-debug';
}

function isTopologyObjectAffectedByRoad(obj, roadId) {
    if (!isTopologySceneObject(obj)) return false;
    return getSceneObjectRoadIds(obj).includes(roadId);
}

function isTopologySceneObject(obj) {
    const data = obj?.userData || {};
    const kind = data.kind;
    return kind === 'junction'
        || kind === 'junction-hub'
        || kind === 'junction-center'
        || kind === 'junction-approach'
        || (kind === 'normal-debug' && !!data.junctionId);
}

function getSceneObjectRoadIds(obj) {
    const data = obj?.userData || {};
    if (Array.isArray(data.roadIds)) return data.roadIds;
    return data.roadId ? [data.roadId] : [];
}

function createRoadObjects(road) {
    const objects = [];
    if (!road.built || road.points.length < 2) return objects;

    normalizeRoadSegmentProfileList(road);
    const authoredSegments = getRoadAuthoredAxisSegments(road);
    const fullRoadAxis = sampleRoadAxis(road);
    authoredSegments.forEach(({ axisPoints, segmentIndex }) => {
        const renderSegments = getRoadRenderSegments(road, axisPoints);
        renderSegments.forEach((segment, clipIndex) => {
            objects.push(...createRoadSegmentObjects(
                road,
                segment,
                segmentIndex,
                getRoadSegmentCount(road),
                getEffectiveRoadProfile(road, segmentIndex),
                clipIndex,
                renderSegments.length,
                axisPoints,
                fullRoadAxis,
            ));
        });
    });

    return objects;
}

function getRoadAuthoredAxisSegments(road) {
    const points = normalizeRoadPoints(road.points);
    const segments = [];
    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        const axisPoints = sampleRoadSegment(points, segmentIndex);
        if (axisPoints.length >= 2) segments.push({ axisPoints, segmentIndex });
    }
    return segments;
}

function createRoadSegmentObjects(
    road,
    axisPoints,
    segmentIndex,
    segmentCount,
    profile,
    clipIndex = 0,
    clipCount = 1,
    fullAxisPoints = axisPoints,
    fullRoadAxis = fullAxisPoints,
) {
    const objects = [];
    const isSelected = state.selectedRoadId === road.id;
    const label = segmentCount > 1
        ? `${road.name} segment ${segmentIndex + 1}${clipCount > 1 ? ` part ${clipIndex + 1}` : ''}`
        : road.name;
    const profileSamples = createTransitionedProfileSamples(road, segmentIndex, axisPoints, fullAxisPoints);
    const roadWidths = getProfileSampleWidths(profileSamples, 'width');
    const normalHints = createRoadNormalHints(axisPoints, fullRoadAxis);

    const asphaltAxis = createVariableOffsetPolyline(
        axisPoints,
        profileSamples.map(getProfileSampleRoadCenterOffset),
        normalHints,
    );
    const asphalt = buildVariableRibbonVolumeMesh(asphaltAxis, roadWidths, ROAD_SURFACE_Y, ROAD_BASE_Y, materials.asphalt, normalHints);
    asphalt.name = `${label} asphalt`;
    asphalt.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    addGeneratedMesh(objects, asphalt);

    objects.push(...createRoadSideObjects(axisPoints, road, profileSamples, label, 1, 'left', segmentIndex, normalHints));
    objects.push(...createRoadSideObjects(axisPoints, road, profileSamples, label, -1, 'right', segmentIndex, normalHints));
    objects.push(...createRoadDividerObjects(axisPoints, road, profileSamples, label, segmentIndex, normalHints));

    const edgeLeft = buildRibbonMesh(
        createVariableOffsetPolyline(
            axisPoints,
            profileSamples.map((sample) => getProfileSampleRoadEdgeOffset(sample, 'left') - EDGE_MARKING_INSET_M),
            normalHints,
        ),
        0.16,
        MARKING_SURFACE_Y,
        materials.marking,
        normalHints,
    );
    const edgeRight = buildRibbonMesh(
        createVariableOffsetPolyline(
            axisPoints,
            profileSamples.map((sample) => getProfileSampleRoadEdgeOffset(sample, 'right') + EDGE_MARKING_INSET_M),
            normalHints,
        ),
        0.16,
        MARKING_SURFACE_Y,
        materials.marking,
        normalHints,
    );
    edgeLeft.name = `${label} left edge line`;
    edgeRight.name = `${label} right edge line`;
    edgeLeft.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    edgeRight.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    objects.push(edgeLeft, edgeRight);

    objects.push(...createRoadLaneMarkings(axisPoints, road, profile, label, segmentIndex, profileSamples, normalHints));

    const centerLine = buildLine(axisPoints, isSelected ? 0x2d8cff : 0x60717e, 1.16);
    centerLine.name = `${label} centerline`;
    centerLine.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    objects.push(centerLine);

    return objects;
}

function getRoadRenderSegments(road, axisPoints) {
    if (state.unclippedRoadIdsForCurrentRebuild?.has?.(road.id)) return [axisPoints];
    if (!state.clipRoadsForCurrentRebuild) return [axisPoints];
    const topology = state.renderTopologyForCurrentRebuild || state.topology;
    const clips = (topology?.hubs || [])
        .filter((hub) => hub.kind === 'junction' && hub.roadIds.includes(road.id))
        .map((hub) => ({
            center: hub.center,
            radiusM: Math.max(0, Number(hub.radiusM) || 0),
        }));
    if (clips.length === 0) return [axisPoints];
    return splitPolylineOutsideDiscs(axisPoints, clips)
        .filter((segment) => segment.length >= 2 && polylineLength(segment) > 0.75);
}

function createJunctionObjects(topology) {
    const objects = [];
    if (!topology?.hubs?.length) return objects;

    topology.hubs
        .filter((hub) => hub.kind === 'junction' && hub.source === 'road-crossing')
        .forEach((hub) => {
            const radius = Math.max(8, Number(hub.radiusM) || 0);
            const surfacePoints = createJunctionSurfacePoints(hub);
            const surface = surfacePoints.length >= 3
                ? buildPolygonVolumeMesh(surfacePoints, ROAD_SURFACE_Y + 0.006, ROAD_BASE_Y, materials.asphalt)
                : buildDiscVolumeMesh(
                    hub.center,
                    radius,
                    ROAD_SURFACE_Y + 0.006,
                    ROAD_BASE_Y,
                    materials.asphalt,
                    96,
                );
            surface.name = `${hub.id} asphalt surface`;
            surface.userData = {
                junctionId: hub.id,
                selectable: true,
                kind: 'junction',
                roadIds: hub.roadIds,
            };
            addGeneratedMesh(objects, surface);
            objects.push(...createJunctionBoundaryObjects(hub, surfacePoints));
            objects.push(...createJunctionLaneGuideObjects(hub, radius));
            objects.push(...createJunctionCrosswalkObjects(hub, radius));
            objects.push(...createJunctionConflictGuideObjects(hub, radius));
        });

    return objects;
}

function createJunctionSurfacePoints(hub) {
    const radius = Math.max(8, Number(hub.radiusM) || 0);
    const points = [];

    hub.approaches.forEach((approach) => {
        const { direction, normal, length, halfWidth } = getJunctionApproachShape(approach, radius);
        const shoulder = {
            x: hub.center.x + direction.x * length,
            z: hub.center.z + direction.z * length,
        };
        points.push(
            {
                x: shoulder.x + normal.x * halfWidth,
                z: shoulder.z + normal.z * halfWidth,
            },
            {
                x: shoulder.x - normal.x * halfWidth,
                z: shoulder.z - normal.z * halfWidth,
            },
            {
                x: hub.center.x + direction.x * (length + halfWidth * 0.45),
                z: hub.center.z + direction.z * (length + halfWidth * 0.45),
            },
        );
    });

    return convexHull(points);
}

function createJunctionBoundaryObjects(hub, asphaltPoints) {
    const objects = [];
    if (asphaltPoints.length < 3) return objects;

    const sidewalkWidth = getJunctionSidewalkWidth(hub);
    const innerCurbOuter = offsetConvexPolygon(asphaltPoints, CURB_WIDTH_M);
    const innerCurb = buildPolygonBandVolumeMesh(
        asphaltPoints,
        innerCurbOuter,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
    );
    innerCurb.name = `${hub.id} junction inner curb`;
    innerCurb.userData = { junctionId: hub.id, selectable: true, kind: 'junction', roadIds: hub.roadIds };
    addGeneratedMesh(objects, innerCurb);

    if (sidewalkWidth <= 0) return objects;

    const sidewalkOuter = offsetConvexPolygon(asphaltPoints, CURB_WIDTH_M + sidewalkWidth);
    const sidewalk = buildPolygonBandVolumeMesh(
        innerCurbOuter,
        sidewalkOuter,
        SIDEWALK_SURFACE_Y,
        SIDEWALK_BASE_Y,
        materials.sidewalk,
    );
    sidewalk.name = `${hub.id} junction sidewalk apron`;
    sidewalk.userData = { junctionId: hub.id, selectable: true, kind: 'junction', roadIds: hub.roadIds };
    addGeneratedMesh(objects, sidewalk);

    const outerCurbOuter = offsetConvexPolygon(asphaltPoints, CURB_WIDTH_M + sidewalkWidth + CURB_WIDTH_M);
    const outerCurb = buildPolygonBandVolumeMesh(
        sidewalkOuter,
        outerCurbOuter,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
    );
    outerCurb.name = `${hub.id} junction outer curb`;
    outerCurb.userData = { junctionId: hub.id, selectable: true, kind: 'junction', roadIds: hub.roadIds };
    addGeneratedMesh(objects, outerCurb);

    return objects;
}

function createJunctionLaneGuideObjects(hub, radius) {
    const objects = [];
    hub.approaches.forEach((approach, approachIndex) => {
        const { direction, normal, length } = getJunctionApproachShape(approach, radius);
        const layout = getApproachLaneLayout(approach);
        if (layout.boundaryOffsets.length === 0) return;

        const startDistance = Math.max(2.8, Math.min(7, radius * 0.22));
        const endDistance = Math.max(startDistance + 4, length + 1.2);

        layout.boundaryOffsets.forEach((boundary, boundaryIndex) => {
            const points = [
                {
                    x: hub.center.x + direction.x * startDistance + normal.x * boundary.offsetM,
                    z: hub.center.z + direction.z * startDistance + normal.z * boundary.offsetM,
                },
                {
                    x: hub.center.x + direction.x * endDistance + normal.x * boundary.offsetM,
                    z: hub.center.z + direction.z * endDistance + normal.z * boundary.offsetM,
                },
            ];
            const dashes = buildDashedLineMeshes(
                points,
                boundary.kind === 'center' ? LANE_MARKING_WIDTH_M + 0.03 : LANE_MARKING_WIDTH_M,
                Math.max(2.2, LANE_DASH_M * 0.55),
                Math.max(1.4, LANE_GAP_M * 0.45),
                JUNCTION_MARKING_SURFACE_Y,
                boundary.kind === 'center' ? materials.junctionYellowMarking : materials.junctionMarking,
            );
            dashes.forEach((dash, dashIndex) => {
                dash.name = `${hub.id} approach ${approachIndex + 1} ${boundary.kind} guide ${boundaryIndex + 1}.${dashIndex + 1}`;
                dash.renderOrder = 4;
                dash.userData = {
                    junctionId: hub.id,
                    roadId: approach.roadId,
                    selectable: true,
                    kind: 'junction',
                    roadIds: hub.roadIds,
                };
                objects.push(dash);
            });
        });
    });
    return objects;
}

function createJunctionCrosswalkObjects(hub, radius) {
    const objects = [];
    hub.approaches.forEach((approach, approachIndex) => {
        if (Math.max(0, Number(approach.sidewalkWidthM) || 0) <= 0) return;

        const { direction, normal, length, halfWidth } = getJunctionApproachShape(approach, radius);
        const laneAreaWidth = getApproachLaneLayout(approach).widthM;
        const stripeHalfLength = Math.max(3, Math.min(halfWidth - 0.55, laneAreaWidth / 2 + 0.9));
        const crosswalkStartDistance = length - CROSSWALK_DEPTH_M;
        const crosswalkEndDistance = length + 0.85;
        const firstStripeOffset = -stripeHalfLength + CROSSWALK_STRIPE_WIDTH_M / 2;
        const lastStripeOffset = stripeHalfLength - CROSSWALK_STRIPE_WIDTH_M / 2;
        let stripeIndex = 0;

        for (
            let offset = firstStripeOffset;
            offset <= lastStripeOffset + EPS;
            offset += CROSSWALK_STRIPE_WIDTH_M + CROSSWALK_STRIPE_GAP_M
        ) {
            stripeIndex += 1;
            const stripe = buildRibbonMesh(
                [
                    {
                        x: hub.center.x + direction.x * crosswalkStartDistance + normal.x * offset,
                        z: hub.center.z + direction.z * crosswalkStartDistance + normal.z * offset,
                    },
                    {
                        x: hub.center.x + direction.x * crosswalkEndDistance + normal.x * offset,
                        z: hub.center.z + direction.z * crosswalkEndDistance + normal.z * offset,
                    },
                ],
                CROSSWALK_STRIPE_WIDTH_M,
                JUNCTION_MARKING_SURFACE_Y + 0.004,
                materials.junctionMarking,
            );
            stripe.name = `${hub.id} approach ${approachIndex + 1} crosswalk stripe ${stripeIndex}`;
            stripe.renderOrder = 5;
            stripe.userData = {
                junctionId: hub.id,
                roadId: approach.roadId,
                selectable: true,
                kind: 'junction',
                roadIds: hub.roadIds,
            };
            addGeneratedMesh(objects, stripe);
        }

        const stopDistance = length + Math.min(2.4, Math.max(1.2, halfWidth * 0.32));
        const stopLine = buildRibbonMesh(
            [
                {
                    x: hub.center.x + direction.x * stopDistance + normal.x * (laneAreaWidth / 2),
                    z: hub.center.z + direction.z * stopDistance + normal.z * (laneAreaWidth / 2),
                },
                {
                    x: hub.center.x + direction.x * stopDistance - normal.x * (laneAreaWidth / 2),
                    z: hub.center.z + direction.z * stopDistance - normal.z * (laneAreaWidth / 2),
                },
            ],
            STOP_BAR_WIDTH_M,
            JUNCTION_MARKING_SURFACE_Y + 0.008,
            materials.junctionMarking,
        );
        stopLine.name = `${hub.id} approach ${approachIndex + 1} stop bar`;
        stopLine.renderOrder = 5;
        stopLine.userData = {
            junctionId: hub.id,
            roadId: approach.roadId,
            selectable: true,
            kind: 'junction',
            roadIds: hub.roadIds,
        };
        addGeneratedMesh(objects, stopLine);
    });
    return objects;
}

function createJunctionConflictGuideObjects(hub, radius) {
    const sorted = [...hub.approaches]
        .map((approach) => ({
            ...approach,
            normalizedAngleRad: normalizeAngleRad(approach.angleRad),
        }))
        .sort((a, b) => a.normalizedAngleRad - b.normalizedAngleRad);
    const objects = [];
    if (sorted.length < 3) return objects;

    const startDistance = Math.max(4.2, Math.min(8, radius * 0.32));
    sorted.forEach((approach, index) => {
        const next = sorted[(index + 1) % sorted.length];
        const gap = angleGapRad(approach.normalizedAngleRad, next.normalizedAngleRad);
        if (gap < Math.PI / 8) return;

        const aDirection = normalizeDirection(approach.direction || { x: Math.cos(approach.angleRad), z: Math.sin(approach.angleRad) });
        const bDirection = normalizeDirection(next.direction || { x: Math.cos(next.angleRad), z: Math.sin(next.angleRad) });
        const start = {
            x: hub.center.x + aDirection.x * startDistance,
            z: hub.center.z + aDirection.z * startDistance,
        };
        const end = {
            x: hub.center.x + bDirection.x * startDistance,
            z: hub.center.z + bDirection.z * startDistance,
        };
        const controlDistance = Math.max(1.2, startDistance * 0.22);
        const midDirection = normalizeDirection({
            x: aDirection.x + bDirection.x,
            z: aDirection.z + bDirection.z,
        });
        const control = {
            x: hub.center.x + midDirection.x * controlDistance,
            z: hub.center.z + midDirection.z * controlDistance,
        };
        const guidePoints = sampleQuadraticPoints(start, control, end, 10);
        const dashes = buildDashedLineMeshes(
            guidePoints,
            CONFLICT_GUIDE_WIDTH_M,
            1.8,
            1.2,
            JUNCTION_MARKING_SURFACE_Y + 0.012,
            materials.junctionYellowMarking,
        );
        dashes.forEach((dash, dashIndex) => {
            dash.name = `${hub.id} conflict guide ${index + 1}.${dashIndex + 1}`;
            dash.renderOrder = 5;
            dash.userData = {
                junctionId: hub.id,
                selectable: true,
                kind: 'junction',
                roadIds: hub.roadIds,
                fromRoadId: approach.roadId,
                toRoadId: next.roadId,
            };
            addGeneratedMesh(objects, dash);
        });
    });
    return objects;
}

function getJunctionApproachShape(approach, radius) {
    const direction = normalizeDirection(approach.direction || { x: Math.cos(approach.angleRad), z: Math.sin(approach.angleRad) });
    const widthM = Math.max(1, Number(approach.widthM) || 0);
    return {
        direction,
        normal: { x: -direction.z, z: direction.x },
        length: Math.max(radius, widthM * 0.95 + 8),
        halfWidth: Math.max(3.4, widthM * 0.5 + 1.4),
    };
}

function getApproachLaneLayout(approach) {
    return calculateRoadLaneLayout(approach.widthM, approach.laneWidthM, approach.trafficDirection, {
        forwardLanes: approach.forwardLanes,
        backwardLanes: approach.backwardLanes,
        forwardWidth: approach.forwardWidthM,
        backwardWidth: approach.backwardWidthM,
        dividerWidth: approach.dividerWidthM,
        dividerType: approach.dividerType,
    });
}

function getJunctionSidewalkWidth(hub) {
    const widths = hub.approaches
        .map((approach) => Math.max(0, Number(approach.sidewalkWidthM) || 0))
        .filter((width) => width > 0);
    return widths.length ? Math.max(...widths) : 0;
}

function normalizeDirection(direction) {
    const length = Math.hypot(direction.x, direction.z) || 1;
    return {
        x: direction.x / length,
        z: direction.z / length,
    };
}

function sampleQuadraticPoints(start, control, end, steps = 8) {
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const inv = 1 - t;
        points.push({
            x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
            z: inv * inv * start.z + 2 * inv * t * control.z + t * t * end.z,
        });
    }
    return points;
}

function normalizeAngleRad(angleRad) {
    const twoPi = Math.PI * 2;
    return ((angleRad % twoPi) + twoPi) % twoPi;
}

function angleGapRad(a, b) {
    const twoPi = Math.PI * 2;
    return ((b - a) + twoPi) % twoPi;
}

function createRoadSideObjects(axisPoints, road, profileSamples, label, sideSign, sideName, segmentIndex = null, normalHints = []) {
    const objects = [];
    const roadEdges = profileSamples.map((sample) => getProfileSampleRoadEdgeOffset(sample, sideName));
    const sidewalkWidths = profileSamples.map((sample) => getProfileSampleSidewalkWidth(sample, sideName));
    const innerCurbAxis = createVariableOffsetPolyline(
        axisPoints,
        roadEdges.map((roadEdge) => roadEdge + sideSign * CURB_WIDTH_M / 2),
        normalHints,
    );
    const innerCurb = buildRibbonVolumeMesh(
        innerCurbAxis,
        CURB_WIDTH_M,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
        normalHints,
    );
    innerCurb.name = `${label} ${sideName} inner curb`;
    innerCurb.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    addGeneratedMesh(objects, innerCurb);

    if (maxSampleValue(sidewalkWidths) <= EPS) return objects;

    const sidewalkAxis = createVariableOffsetPolyline(
        axisPoints,
        roadEdges.map((roadEdge, index) => (
            roadEdge + sideSign * (CURB_WIDTH_M + getPositiveRibbonWidth(sidewalkWidths[index]) / 2)
        )),
        normalHints,
    );
    const sidewalk = buildVariableRibbonVolumeMesh(
        sidewalkAxis,
        sidewalkWidths.map(getPositiveRibbonWidth),
        SIDEWALK_SURFACE_Y,
        SIDEWALK_BASE_Y,
        materials.sidewalk,
        normalHints,
    );
    sidewalk.name = `${label} ${sideName} sidewalk`;
    sidewalk.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    addGeneratedMesh(objects, sidewalk);

    const outerCurbAxis = createVariableOffsetPolyline(
        axisPoints,
        roadEdges.map((roadEdge, index) => (
            roadEdge + sideSign * (CURB_WIDTH_M + getPositiveRibbonWidth(sidewalkWidths[index]) + CURB_WIDTH_M / 2)
        )),
        normalHints,
    );
    const outerCurb = buildRibbonVolumeMesh(
        outerCurbAxis,
        CURB_WIDTH_M,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
        normalHints,
    );
    outerCurb.name = `${label} ${sideName} outer curb`;
    outerCurb.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    addGeneratedMesh(objects, outerCurb);

    return objects;
}

function addGeneratedMesh(objects, mesh) {
    objects.push(mesh);
    if (state.showWireframe) {
        const wireframe = buildMeshWireframe(mesh, materials.meshWireframe);
        if (wireframe) objects.push(wireframe);
    }
    if (state.showNormals) {
        const normals = buildMeshNormals(mesh, materials.meshNormals);
        if (normals) objects.push(normals);
    }
}

function createRoadDividerObjects(axisPoints, road, profileSamples, label, segmentIndex = null, normalHints = []) {
    const objects = [];
    const referenceProfile = profileSamples[profileSamples.length - 1] || profileSamples[0];
    if (referenceProfile?.trafficDirection !== 'two-way') return objects;
    const dividerType = normalizeDividerType(referenceProfile?.dividerType);
    const dividerWidths = profileSamples.map(getProfileDividerWidth);
    const dividerCenterOffsets = profileSamples.map((sample) => getLaneLayoutForProfile(sample).dividerCenterOffsetM);
    const maxDividerWidth = maxSampleValue(dividerWidths);
    if (dividerType === 'none' || maxDividerWidth <= EPS) return objects;

    const dividerAxis = createVariableOffsetPolyline(axisPoints, dividerCenterOffsets, normalHints);
    const renderWidths = dividerWidths.map((width) => {
        if (dividerType === 'line') return Math.max(LANE_MARKING_WIDTH_M + 0.03, width);
        return getPositiveRibbonWidth(width);
    });
    const material = dividerType === 'painted' || dividerType === 'line'
        ? materials.yellowMarking
        : materials.curb;
    const divider = dividerType === 'raised'
        ? buildVariableRibbonVolumeMesh(
            dividerAxis,
            renderWidths,
            RAISED_DIVIDER_SURFACE_Y,
            ROAD_SURFACE_Y + 0.02,
            material,
            normalHints,
        )
        : buildVariableRibbonMesh(
            dividerAxis,
            renderWidths,
            DIVIDER_MARKING_SURFACE_Y,
            material,
            normalHints,
        );
    divider.name = `${label} ${dividerType} divider`;
    divider.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
    addGeneratedMesh(objects, divider);
    return objects;
}

function createRoadLaneMarkings(axisPoints, road, profile, label = road.name, segmentIndex = null, profileSamples = null, normalHints = []) {
    const objects = [];
    const samples = profileSamples || createTransitionedProfileSamples(road, segmentIndex, axisPoints);
    const layout = getLaneLayoutForProfile(profile);
    if (layout.boundaryOffsets.length === 0) return objects;

    layout.boundaryOffsets.forEach((boundary, index) => {
        const boundaryPoints = createVariableOffsetPolyline(
            axisPoints,
            getLaneBoundarySampleOffsets(boundary, profile, samples),
            normalHints,
        );
        const dashes = buildDashedLineMeshes(
            boundaryPoints,
            boundary.kind === 'center' ? LANE_MARKING_WIDTH_M + 0.03 : LANE_MARKING_WIDTH_M,
            LANE_DASH_M,
            LANE_GAP_M,
            MARKING_SURFACE_Y,
            boundary.kind === 'center' ? materials.yellowMarking : materials.marking,
        );
        dashes.forEach((dash, dashIndex) => {
            dash.name = `${label} ${boundary.kind === 'center' ? 'center divider' : 'lane dash'} ${index + 1}.${dashIndex + 1}`;
            dash.userData = { roadId: road.id, segmentIndex, selectable: true, kind: 'road' };
            objects.push(dash);
        });
    });

    return objects;
}

function createRoadHelpers(road) {
    const objects = [];
    const isSelectedRoad = road.id === state.selectedRoadId;
    const isEditingRoad = isRoadEditing(road);
    const isActiveDrawRoad = road.id === state.activeDrawRoadId;
    const footprintSegments = getRoadHelperFootprintSegments(road);
    if (footprintSegments.length > 0) {
        footprintSegments.forEach(({ axisPoints, segmentIndex, clipIndex, clipCount, fullAxisPoints, fullRoadAxis }, index) => {
            const profile = getEffectiveRoadProfile(road, segmentIndex);
            const normalHints = createRoadNormalHints(axisPoints, fullRoadAxis || fullAxisPoints || axisPoints);
            if (road.built && isSelectedRoad) {
                objects.push(...createSelectedRoadOutline(
                    axisPoints,
                    road,
                    segmentIndex,
                    getRoadSegmentCount(road),
                    profile,
                    clipIndex,
                    clipCount,
                    fullAxisPoints,
                    fullRoadAxis,
                ));
                return;
            }
            const previewMaterial = isSelectedRoad
                ? materials.selectedRoadFootprint
                : (road.built ? materials.roadFootprint : materials.draftRoadFootprint);
            const profileSamples = Number.isInteger(segmentIndex)
                ? createTransitionedProfileSamples(road, segmentIndex, axisPoints, fullAxisPoints || axisPoints)
                : [profile, profile];
            const footprintWidths = axisPoints.map((_, sampleIndex) => {
                const sample = profileSamples[Math.min(sampleIndex, profileSamples.length - 1)] || profile;
                return getProfileSampleRoadWidth(sample) + (isSelectedRoad ? 1.2 : 0);
            });
            const footprintAxis = createVariableOffsetPolyline(
                axisPoints,
                axisPoints.map((_, sampleIndex) => {
                    const sample = profileSamples[Math.min(sampleIndex, profileSamples.length - 1)] || profile;
                    return getProfileSampleRoadCenterOffset(sample);
                }),
                normalHints,
            );
            const footprint = buildVariableRibbonMesh(footprintAxis, footprintWidths, 0.24, previewMaterial, normalHints);
            footprint.name = `${road.name} generated 3D road footprint${footprintSegments.length > 1 ? ` ${index + 1}` : ''}`;
            footprint.userData = { roadId: road.id, segmentIndex, helper: true, kind: road.built ? 'built-road-preview' : 'draft-road-preview' };
            footprint.renderOrder = 2;
            objects.push(footprint);
        });
    }

    const showEditControls = isEditingRoad || isActiveDrawRoad;
    const splineAxis = showEditControls ? sampleRoadAxis(road) : [];
    if (showEditControls && splineAxis.length >= 2) {
        const color = road.buildDirty ? 0xffd23f : 0x2d8cff;
        const splineLine = buildLine(splineAxis, color, 1.42);
        splineLine.name = `${road.name} editable spline`;
        splineLine.userData = { roadId: road.id, helper: true, kind: 'editable-spline' };
        splineLine.renderOrder = 3;
        objects.push(splineLine);
    }
    if (
        showEditControls
        && isSelectedRoad
        && isEditingRoad
        && Number.isInteger(state.selectedSegmentIndex)
        && state.selectedSegmentIndex >= 0
        && state.selectedSegmentIndex < getRoadSegmentCount(road)
    ) {
        const selectedAxis = sampleRoadSegment(normalizeRoadPoints(road.points), state.selectedSegmentIndex);
        if (selectedAxis.length >= 2) {
            const fullRoadAxis = sampleRoadAxis(road);
            const normalHints = createRoadNormalHints(selectedAxis, fullRoadAxis);
            const profileSamples = createTransitionedProfileSamples(
                road,
                state.selectedSegmentIndex,
                selectedAxis,
                selectedAxis,
            );
            const highlight = buildVariableRibbonMesh(
                createVariableOffsetPolyline(
                    selectedAxis,
                    profileSamples.map(getProfileSampleVisualCenterOffset),
                    normalHints,
                ),
                profileSamples.map((sample) => getProfileSampleVisualHalfWidth(sample) * 2 + 1.2),
                ROAD_SELECTION_Y + 0.035,
                materials.segmentSelection,
                normalHints,
            );
            highlight.name = `${road.name} selected segment ${state.selectedSegmentIndex + 1}`;
            highlight.userData = { roadId: road.id, segmentIndex: state.selectedSegmentIndex, helper: true, kind: 'selected-road-segment' };
            highlight.renderOrder = 7;
            objects.push(highlight);
        }
    }
    if (!showEditControls) return objects;

    road.points.forEach((point, index) => {
        const selected = isSelectedRoad && isEditingRoad && index === state.selectedPointIndex;
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

function getRoadHelperFootprintSegments(road) {
    if (road.built && road.points.length >= 2) {
        const fullRoadAxis = sampleRoadAxis(road);
        return getRoadAuthoredAxisSegments(road).flatMap(({ axisPoints, segmentIndex }) => {
            const renderSegments = getRoadRenderSegments(road, axisPoints);
            return renderSegments.map((segment, clipIndex) => ({
                axisPoints: segment,
                segmentIndex,
                clipIndex,
                clipCount: renderSegments.length,
                fullAxisPoints: axisPoints,
                fullRoadAxis,
            }));
        });
    }

    const axisPoints = sampleRoadAxis(road);
    return axisPoints.length >= 2
        ? [{ axisPoints, segmentIndex: null, clipIndex: 0, clipCount: 1, fullAxisPoints: axisPoints, fullRoadAxis: axisPoints }]
        : [];
}

function createSelectedRoadOutline(
    axisPoints,
    road,
    segmentIndex,
    segmentCount,
    profile,
    clipIndex = 0,
    clipCount = 1,
    fullAxisPoints = axisPoints,
    fullRoadAxis = fullAxisPoints,
) {
    const objects = [];
    const label = segmentCount > 1
        ? `${road.name} segment ${segmentIndex + 1}${clipCount > 1 ? ` part ${clipIndex + 1}` : ''}`
        : road.name;
    const profileSamples = Number.isInteger(segmentIndex)
        ? createTransitionedProfileSamples(road, segmentIndex, axisPoints, fullAxisPoints)
        : axisPoints.map(() => profile);
    const normalHints = createRoadNormalHints(axisPoints, fullRoadAxis);
    [
        { side: 'left' },
        { side: 'right' },
    ].forEach(({ side }) => {
        const outline = buildRibbonMesh(
            createVariableOffsetPolyline(
                axisPoints,
                profileSamples.map((sample) => getProfileSampleVisualEdgeOffset(sample, side)),
                normalHints,
            ),
            0.46,
            ROAD_SELECTION_Y,
            materials.selectionRing,
            normalHints,
        );
        outline.name = `${label} ${side} selection outline`;
        outline.userData = { roadId: road.id, segmentIndex, helper: true, kind: 'selected-road-outline' };
        outline.renderOrder = 6;
        objects.push(outline);
    });
    return objects;
}

function createTopologyHelpers(topology) {
    const objects = [];
    if (!state.showTopology || !topology?.hubs?.length) return objects;

    topology.hubs
        .filter((hub) => hub.kind === 'junction')
        .forEach((hub) => {
            const radius = Math.max(8, hub.radiusM);
            const ring = buildCircleStrip(hub.center, radius, 0.8, 1.08, materials.junctionHub, 72);
            ring.name = `${hub.approachCount}-way ${hub.id}`;
            ring.renderOrder = 7;
            ring.userData = {
                helper: true,
                exportable: false,
                kind: 'junction-hub',
                junctionId: hub.id,
                approachCount: hub.approachCount,
                roadIds: hub.roadIds,
            };
            objects.push(ring);

            const core = buildDiscVolumeMesh(
                hub.center,
                Math.max(1.8, radius * 0.14),
                1.16,
                1.1,
                materials.junctionCore,
                32,
            );
            core.name = `${hub.id} center`;
            core.renderOrder = 8;
            core.userData = {
                helper: true,
                exportable: false,
                kind: 'junction-center',
                junctionId: hub.id,
                roadIds: hub.roadIds,
            };
            objects.push(core);

            hub.approaches.forEach((approach, index) => {
                const arm = buildLine(
                    [
                        {
                            x: hub.center.x + approach.direction.x * Math.max(2, radius * 0.22),
                            z: hub.center.z + approach.direction.z * Math.max(2, radius * 0.22),
                        },
                        {
                            x: hub.center.x + approach.direction.x * (radius + 10),
                            z: hub.center.z + approach.direction.z * (radius + 10),
                        },
                    ],
                    0xffd23f,
                    1.28,
                );
                arm.name = `${hub.id} approach ${index + 1} ${approach.roadName}`;
                arm.renderOrder = 8;
                arm.userData = {
                    helper: true,
                    exportable: false,
                    kind: 'junction-approach',
                    junctionId: hub.id,
                    roadId: approach.roadId,
                    side: approach.side,
                };
                objects.push(arm);
            });
        });

    return objects;
}

function createRoundaboutObjects(roundabout) {
    const objects = [];
    const outerR = roundabout.radius + roundabout.width / 2;
    const innerR = Math.max(4, roundabout.radius - roundabout.width / 2);
    const ring = buildRingVolumeMesh(roundabout.center, innerR, outerR, ROAD_SURFACE_Y, ROAD_BASE_Y, materials.asphalt, 128);
    ring.name = `${roundabout.name} asphalt`;
    ring.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    addGeneratedMesh(objects, ring);

    const island = buildDiscVolumeMesh(roundabout.center, Math.max(2, innerR - 2.2), SIDEWALK_SURFACE_Y, SIDEWALK_BASE_Y, materials.island, 96);
    island.name = `${roundabout.name} island`;
    island.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    addGeneratedMesh(objects, island);

    const innerCurb = buildRingVolumeMesh(
        roundabout.center,
        innerR - CURB_WIDTH_M / 2,
        innerR + CURB_WIDTH_M / 2,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
        128,
    );
    const outerCurb = buildRingVolumeMesh(
        roundabout.center,
        outerR - CURB_WIDTH_M / 2,
        outerR + CURB_WIDTH_M / 2,
        CURB_SURFACE_Y,
        CURB_BASE_Y,
        materials.curb,
        128,
    );
    innerCurb.name = `${roundabout.name} inner curb`;
    outerCurb.name = `${roundabout.name} outer curb`;
    innerCurb.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    outerCurb.userData = { roundaboutId: roundabout.id, selectable: true, kind: 'roundabout' };
    addGeneratedMesh(objects, innerCurb);
    addGeneratedMesh(objects, outerCurb);

    const laneCount = Math.max(1, Math.round(roundabout.lanes || 1));
    if (laneCount > 1) {
        const laneStep = roundabout.width / laneCount;
        for (let i = 1; i < laneCount; i += 1) {
            const radius = innerR + laneStep * i;
            const dashed = buildDashedCircle(roundabout.center, radius, 0.12, MARKING_SURFACE_Y, materials.marking, 96);
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
    state.lastGroundPoint = { ...ground };

    if (state.move) {
        event.preventDefault();
        updateRoadMovePreview(ground);
        confirmRoadMove();
        return;
    }

    if (state.mode === 'draw') {
        addDrawPoint(ground);
        return;
    }

    if (state.mode === 'move') {
        const roadHit = findNearestRoad(ground);
        if (!roadHit) {
            setStatus('Move tool: click a road to select it for moving.');
            return;
        }
        selectRoad(roadHit.road.id, null);
        beginSelectedRoadMove(ground);
        return;
    }

    if (state.mode === 'roundabout') {
        addRoundabout(ground);
        return;
    }

    const hit = findNearestControlPoint(ground, 9);
    if (hit) {
        enterRoadEditMode(hit.road.id, hit.index);
        state.drag = { type: 'point', roadId: hit.road.id, pointIndex: hit.index };
        controls.enabled = false;
        rebuildScene();
        setStatus(`Dragging ${hit.road.name} node ${hit.index + 1}.`);
        return;
    }

    const roundaboutHit = findNearestRoundabout(ground);
    if (roundaboutHit) {
        if (state.selectedRoundaboutId === roundaboutHit.roundabout.id) {
            state.drag = {
                type: 'roundabout',
                roundaboutId: roundaboutHit.roundabout.id,
                start: ground,
                originalCenter: { ...roundaboutHit.roundabout.center },
            };
            controls.enabled = false;
            setStatus(`Moving ${roundaboutHit.roundabout.name}.`);
            return;
        }
        selectRoundabout(roundaboutHit.roundabout.id);
        rebuildScene();
        setStatus(`Selected ${roundaboutHit.roundabout.name}.`);
        return;
    }

    const roadHit = findNearestRoad(ground);
    if (roadHit) {
        if (state.selectedRoadId === roadHit.road.id && isRoadEditing(roadHit.road)) {
            const segmentHit = findNearestRoadSegment(
                ground,
                Math.max(10, getRoadVisualHalfWidth(roadHit.road) + 4),
                roadHit.road.id,
            );
            if (segmentHit) {
                selectRoadSegment(segmentHit.road.id, segmentHit.segmentIndex);
                rebuildScene();
                setStatus(`Selected ${segmentHit.road.name} segment ${segmentHit.segmentIndex + 1}.`);
                return;
            }
            state.selectedPointIndex = null;
            state.selectedSegmentIndex = null;
            rebuildScene();
            setStatus(`Editing ${roadHit.road.name}: double-click the road surface to insert a node.`);
            return;
        }
        if (state.selectedRoadId === roadHit.road.id && !isRoadEditing(roadHit.road)) {
            setStatus(`Selected ${roadHit.road.name}. Press G or Move to move it.`);
            return;
        }
        selectRoad(roadHit.road.id, null);
        rebuildScene();
        setStatus(`Selected ${roadHit.road.name}. Press G or Move to move it.`);
    }
}

function onPointerMove(event) {
    const ground = getGroundPoint(event);
    if (!ground) return;
    state.lastGroundPoint = { ...ground };

    const geo = localToGeo(ground);
    dom.coordText.textContent = `${geo.lat.toFixed(6)} N, ${geo.lon.toFixed(6)} E`;

    if (state.move) {
        updateRoadMovePreview(ground);
        return;
    }

    if (!state.drag) return;
    if (state.drag.type === 'point') {
        const road = getRoadById(state.drag.roadId);
        if (!road) return;
        const point = road.points[state.drag.pointIndex];
        if (!point) return;
        point.x = ground.x;
        point.z = ground.z;
        rebuildGeneratedRoadAfterGeometryChange(road);
        scheduleRebuildSceneForDrag(road.id);
        return;
    }
    if (state.drag.type === 'road') {
        const road = getRoadById(state.drag.roadId);
        if (!road) return;
        const dx = ground.x - state.drag.start.x;
        const dz = ground.z - state.drag.start.z;
        road.points = state.drag.originalPoints.map((point) => ({
            ...point,
            x: point.x + dx,
            z: point.z + dz,
        }));
        rebuildGeneratedRoadAfterGeometryChange(road);
        scheduleRebuildSceneForDrag(road.id);
        return;
    }
    if (state.drag.type === 'roundabout') {
        const roundabout = getRoundaboutById(state.drag.roundaboutId);
        if (!roundabout) return;
        roundabout.center = {
            x: state.drag.originalCenter.x + ground.x - state.drag.start.x,
            z: state.drag.originalCenter.z + ground.z - state.drag.start.z,
        };
        scheduleRebuildSceneForDrag();
        return;
    }
    scheduleRebuildSceneForDrag();
}

function onPointerUp() {
    if (state.move) return;
    if (state.drag) {
        const dragType = state.drag.type;
        const changedRoadId = dragType === 'point' || dragType === 'road' ? state.drag.roadId : null;
        cancelScheduledDragRebuild();
        state.drag = null;
        controls.enabled = true;
        if (changedRoadId) {
            rebuildSceneForChangedRoad(changedRoadId);
        } else {
            rebuildScene();
        }
        if (dragType === 'point') setStatus('Node updated. 3D road geometry is in sync.');
        if (dragType === 'road') setStatus('Road moved.');
        if (dragType === 'roundabout') setStatus('Roundabout moved.');
    }
}

function onDoubleClick(event) {
    if (state.mode !== 'select' || isEditableTarget(event.target)) return;
    event.preventDefault();
    if (state.move) return;
    state.drag = null;
    controls.enabled = true;
    const editingRoad = getSelectedRoad();
    if (editingRoad && isRoadEditing(editingRoad)) {
        const editHit = findRoadSegmentForInsertion(event, editingRoad);
        if (editHit) {
            insertRoadPoint(editHit.road, editHit.segmentIndex, editHit.point);
        } else {
            setStatus(`${editingRoad.name}: double-click closer to the road surface to insert a node.`);
        }
        return;
    }

    const hit = findNearestRoadSegmentOnScreen(event, 56);
    if (!hit) return;

    enterRoadEditMode(hit.road.id, null);
    rebuildScene();
    setStatus(`Editing ${hit.road.name}: drag nodes or double-click the road surface to insert a node.`);
}

function onKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    if (event.key === 'Escape') {
        if (state.move) {
            event.preventDefault();
            cancelRoadMove();
            return;
        }
        state.selectedPointIndex = null;
        state.selectedSegmentIndex = null;
        state.activeDrawRoadId = null;
        state.activeDrawInsertSide = null;
        state.selectedRoundaboutId = null;
        state.editingRoadId = null;
        setMode('select');
        rebuildScene();
    }
    if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setMode('move');
        return;
    }
    if (event.key.toLowerCase() === 'a') {
        if (continueRoadDrawingFromSelectedEndpoint()) {
            event.preventDefault();
            return;
        }
    }
    if (event.key === 'Enter' && state.mode === 'draw') {
        state.activeDrawRoadId = null;
        state.activeDrawInsertSide = null;
        setStatus('Started a new draw road chain.');
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection()) {
        event.preventDefault();
        deleteSelected();
    }
}

function continueRoadDrawingFromSelectedEndpoint() {
    const road = getSelectedRoad();
    if (!road || !isRoadEditing(road) || !Number.isInteger(state.selectedPointIndex)) return false;
    if (state.selectedPointIndex !== 0 && state.selectedPointIndex !== road.points.length - 1) {
        setStatus(`${road.name}: select the first or last node to continue the road.`);
        return true;
    }
    state.activeDrawRoadId = road.id;
    state.activeDrawInsertSide = state.selectedPointIndex === 0 ? 'start' : 'end';
    setMode('draw');
    setStatus(`${road.name}: continuing from ${state.activeDrawInsertSide === 'start' ? 'first' : 'last'} node. Click the ground to add nodes.`);
    return true;
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
        state.activeDrawInsertSide = 'end';
        enterRoadEditMode(road.id, 0);
        setStatus('First spline node placed. Add one more point to generate the 3D road.');
    } else {
        const wasBuilt = !!road.built;
        const profiles = normalizeRoadSegmentProfileList(road);
        const pointToAdd = {
            ...point,
            smooth: road.points.length > 0 ? 'smooth' : 'corner',
        };
        const insertSide = state.activeDrawInsertSide === 'start' ? 'start' : 'end';
        if (insertSide === 'start') {
            road.points.unshift(pointToAdd);
            profiles.unshift(cloneSegmentProfile(profiles[0]));
        } else {
            road.points.push(pointToAdd);
            profiles.push(cloneSegmentProfile(profiles[profiles.length - 1]));
        }
        normalizeRoadSegmentProfileList(road);
        buildGeneratedRoadGeometry(road);
        enterRoadEditMode(road.id, insertSide === 'start' ? 0 : road.points.length - 1);
        const direction = insertSide === 'start' ? 'prepended' : 'appended';
        setStatus(`${road.name}: ${direction} node ${road.points.length}. 3D road ${wasBuilt ? 'updated' : 'generated'}.`);
    }
    if (road.points.length >= 2) {
        rebuildSceneForChangedRoad(road.id);
    } else {
        rebuildScene();
    }
}

function insertRoadPoint(road, segmentIndex, point) {
    if (!road || segmentIndex < 0 || segmentIndex >= road.points.length - 1) return;
    const profiles = normalizeRoadSegmentProfileList(road);
    const splitProfile = cloneSegmentProfile(profiles[segmentIndex]);
    const insertIndex = segmentIndex + 1;
    road.points.splice(insertIndex, 0, {
        x: point.x,
        z: point.z,
        smooth: 'smooth',
    });
    profiles.splice(insertIndex, 0, splitProfile);
    normalizeRoadSegmentProfileList(road);
    rebuildGeneratedRoadAfterTopologyChange(road);
    enterRoadEditMode(road.id, insertIndex);
    rebuildSceneForChangedRoad(road.id);
    setStatus(`${road.name}: inserted node ${insertIndex + 1}. ${road.built ? '3D road rebuilt.' : 'Press Build 3D to generate the road.'}`);
}

function createDefaultRoad(point) {
    state.roadSeq += 1;
    const selected = getSelectedRoad();
    const laneWidth = selected?.laneWidth || DEFAULT_LANE_WIDTH_M;
    const trafficDirection = normalizeTrafficDirection(selected?.trafficDirection);
    const width = selected?.width || DEFAULT_ROAD_WIDTH_M;
    const laneLayout = calculateRoadLaneLayout(width, laneWidth, trafficDirection);
    return {
        id: `road-${state.roadSeq}`,
        name: `Road ${state.roadSeq}`,
        profileId: selected?.profileId || state.profiles[0]?.id || 'urban-asphalt',
        points: [{ ...point, smooth: 'corner' }],
        segmentProfiles: [],
        width,
        lanes: laneLayout.totalLanes,
        laneWidth,
        trafficDirection,
        sidewalkWidth: DEFAULT_SIDEWALK_WIDTH_M,
        sidewalkLeft: true,
        sidewalkRight: true,
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
        if (!isRoadEditing(road) && road.id !== state.activeDrawRoadId) return;
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
        const points = normalizeRoadPoints(road.points);
        if (points.length < 2) return;
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
            const axis = sampleRoadSegment(points, segmentIndex);
            for (let i = 1; i < axis.length; i += 1) {
                const distance = distancePointToSegment(point, axis[i - 1], axis[i]);
                const threshold = getRoadVisualHalfWidth(road, segmentIndex) + 2;
                if (distance <= threshold && (!best || distance < best.distance)) {
                    best = { road, segmentIndex, distance };
                }
            }
        }
    });
    return best;
}

function findNearestRoadSegment(point, thresholdM, roadId = null) {
    let best = null;
    state.roads.forEach((road) => {
        if (roadId && road.id !== roadId) return;
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

function getRoadVisualHalfWidth(road, segmentIndex = null) {
    return getProfileVisualHalfWidth(getEffectiveRoadProfile(road, segmentIndex));
}

function getProfileVisualHalfWidth(profile) {
    return Math.max(
        Math.abs(getProfileSampleVisualEdgeOffset(profile, 'left')),
        Math.abs(getProfileSampleVisualEdgeOffset(profile, 'right')),
    );
}

function getProfileSampleVisualHalfWidth(sample) {
    const leftEdge = getProfileSampleVisualEdgeOffset(sample, 'left');
    const rightEdge = getProfileSampleVisualEdgeOffset(sample, 'right');
    return Math.max(0.5, Math.abs(leftEdge - rightEdge) / 2);
}

function getProfileSampleVisualCenterOffset(sample) {
    const leftEdge = getProfileSampleVisualEdgeOffset(sample, 'left');
    const rightEdge = getProfileSampleVisualEdgeOffset(sample, 'right');
    return (leftEdge + rightEdge) / 2;
}

function getProfileSampleVisualEdgeOffset(sample, side) {
    const leftSidewalkWidth = getProfileSampleSidewalkWidth(sample, 'left');
    const rightSidewalkWidth = getProfileSampleSidewalkWidth(sample, 'right');
    if (side === 'left') {
        return getProfileSampleRoadEdgeOffset(sample, 'left')
            + getRoadSideExtension(leftSidewalkWidth > EPS, leftSidewalkWidth);
    }
    return getProfileSampleRoadEdgeOffset(sample, 'right')
        - getRoadSideExtension(rightSidewalkWidth > EPS, rightSidewalkWidth);
}

function getProfileSampleRoadWidth(sample) {
    return Math.max(1, Number(sample?.width) || 0);
}

function getProfileSampleRoadCenterOffset(sample) {
    const leftEdge = getProfileSampleRoadEdgeOffset(sample, 'left');
    const rightEdge = getProfileSampleRoadEdgeOffset(sample, 'right');
    return (leftEdge + rightEdge) / 2;
}

function getProfileSampleRoadEdgeOffset(sample, side) {
    const layout = getLaneLayoutForProfile(sample);
    if (layout.trafficDirection === 'two-way') {
        const dividerHalfWidth = layout.dividerWidthM / 2;
        return side === 'left'
            ? dividerHalfWidth + layout.backwardWidthM
            : -(dividerHalfWidth + layout.forwardWidthM);
    }
    const halfWidth = getProfileSampleRoadWidth(sample) / 2;
    return side === 'left' ? halfWidth : -halfWidth;
}

function getProfileSampleSidewalkWidth(sample, side) {
    const widthKey = side === 'left' ? 'leftSidewalkWidth' : 'rightSidewalkWidth';
    if (Number.isFinite(Number(sample?.[widthKey]))) {
        return Math.max(0, Number(sample[widthKey]) || 0);
    }
    return getProfileSidewalkWidth(sample, side);
}

function getProfileSampleWidths(samples, key) {
    return samples.map((sample) => Math.max(0.01, Number(sample?.[key]) || 0));
}

function createVariableOffsetPolyline(points, offsets, normalHints = []) {
    return points.map((point, index) => {
        const normal = getRoadNormalHint(points, index, normalHints);
        const offset = Number(offsets[index]);
        const safeOffset = Number.isFinite(offset) ? offset : 0;
        return {
            x: point.x + normal.x * safeOffset,
            z: point.z + normal.z * safeOffset,
        };
    });
}

function createRoadNormalHints(axisPoints, referencePoints = axisPoints) {
    if (!axisPoints?.length) return [];
    if (!referencePoints || referencePoints.length < 2) {
        return axisPoints.map((_, index) => getPointNormal(axisPoints, index));
    }
    return axisPoints.map((point) => getReferenceNormalAtPoint(referencePoints, point));
}

function getReferenceNormalAtPoint(referencePoints, target) {
    let best = null;
    for (let index = 1; index < referencePoints.length; index += 1) {
        const a = referencePoints[index - 1];
        const b = referencePoints[index];
        if (distance2(a, b) <= EPS) continue;
        const candidate = nearestPointOnSegment(target, a, b);
        if (!best || candidate.distance < best.distance) {
            best = {
                distance: candidate.distance,
                segmentIndex: index - 1,
                t: candidate.t,
            };
        }
    }

    if (!best) return { x: 0, z: 1 };
    if (best.t <= 0.02) return getPointNormal(referencePoints, best.segmentIndex);
    if (best.t >= 0.98) return getPointNormal(referencePoints, best.segmentIndex + 1);

    const a = referencePoints[best.segmentIndex];
    const b = referencePoints[best.segmentIndex + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: -dz / length, z: dx / length };
}

function getRoadNormalHint(points, index, normalHints = []) {
    const normal = normalHints[index];
    const x = Number(normal?.x) || 0;
    const z = Number(normal?.z) || 0;
    const length = Math.hypot(x, z);
    if (length > EPS) {
        return { x: x / length, z: z / length };
    }
    return getPointNormal(points, index);
}

function getLaneBoundarySampleOffsets(boundary, profile, profileSamples) {
    return profileSamples.map((sample) => {
        const layout = getLaneLayoutForProfile(sample);
        const match = layout.boundaryOffsets.find((candidate) => (
            candidate.kind === boundary.kind
            && candidate.side === boundary.side
            && candidate.index === boundary.index
        ));
        if (match) return match.offsetM;
        if (boundary.kind === 'center') return layout.dividerCenterOffsetM;
        const sideSign = Math.sign(boundary.offsetM) || 1;
        const side = sideSign > 0 ? 'left' : 'right';
        return getProfileSampleRoadEdgeOffset(sample, side) - sideSign * EDGE_MARKING_INSET_M;
    });
}

function getLaneLayoutForProfile(profile) {
    return calculateRoadLaneLayout(profile?.width, profile?.laneWidth, profile?.trafficDirection, {
        forwardLanes: profile?.forwardLanes,
        backwardLanes: profile?.backwardLanes,
        forwardWidth: profile?.forwardWidth,
        backwardWidth: profile?.backwardWidth,
        dividerWidth: profile?.dividerWidth,
        dividerType: profile?.dividerType,
    });
}

function maxSampleValue(values) {
    return Math.max(0, ...values.map((value) => Math.max(0, Number(value) || 0)));
}

function getPositiveRibbonWidth(value) {
    return Math.max(0.01, Number(value) || 0);
}

function getRoadSideExtension(enabled, sidewalkWidth) {
    return enabled && sidewalkWidth > 0
        ? CURB_WIDTH_M + sidewalkWidth + CURB_WIDTH_M
        : CURB_WIDTH_M;
}

function findRoadSegmentForInsertion(event, road) {
    if (!road) return null;
    const screenHit = findNearestRoadSegmentOnScreen(event, 56, road.id);
    if (screenHit) return screenHit;

    const ground = getGroundPoint(event);
    if (!ground) return null;
    const roadSurfaceThreshold = Math.max(road.width * 1.5, road.width / 2 + 12, 24);
    return findNearestRoadSegment(ground, roadSurfaceThreshold, road.id);
}

function findNearestRoadSegmentOnScreen(event, thresholdPx, roadId = null) {
    const rect = renderer.domElement.getBoundingClientRect();
    const click = { x: event.clientX, y: event.clientY };
    let best = null;

    state.roads.forEach((road) => {
        if (roadId && road.id !== roadId) return;
        const points = normalizeRoadPoints(road.points);
        if (points.length < 2) return;
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
            const segment = sampleRoadSegment(points, segmentIndex);
            for (let i = 1; i < segment.length; i += 1) {
                const a = localPointToScreen(segment[i - 1], rect);
                const b = localPointToScreen(segment[i], rect);
                const candidate = nearestPointOnScreenSegment(click, a, b);
                if (candidate.distance <= thresholdPx && (!best || candidate.distance < best.distance)) {
                    best = {
                        road,
                        segmentIndex,
                        distance: candidate.distance,
                        point: {
                            x: THREE.MathUtils.lerp(segment[i - 1].x, segment[i].x, candidate.t),
                            z: THREE.MathUtils.lerp(segment[i - 1].z, segment[i].z, candidate.t),
                        },
                    };
                }
            }
        }
    });

    return best;
}

function localPointToScreen(point, rect) {
    const projected = new THREE.Vector3(point.x, 1.42, point.z).project(camera);
    return {
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
}

function nearestPointOnScreenSegment(point, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = point.x - a.x;
    const wy = point.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 <= EPS ? 0 : THREE.MathUtils.clamp((wx * vx + wy * vy) / len2, 0, 1);
    const nearest = {
        x: a.x + vx * t,
        y: a.y + vy * t,
    };
    return {
        t,
        distance: Math.hypot(point.x - nearest.x, point.y - nearest.y),
    };
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

function syncInspector() {
    const road = getSelectedRoad();
    const roundabout = getSelectedRoundabout();
    const roadIsEditing = road ? isRoadEditing(road) : false;
    const selectedPoint = roadIsEditing && Number.isInteger(state.selectedPointIndex)
        ? road.points[state.selectedPointIndex]
        : null;
    const selectedSegment = roadIsEditing && Number.isInteger(state.selectedSegmentIndex)
        ? getEffectiveRoadProfile(road, state.selectedSegmentIndex)
        : null;
    const segmentProfileSelected = !!selectedSegment;

    dom.roadFields.hidden = !road;
    dom.roundaboutFields.hidden = !roundabout;
    dom.nodeFields.hidden = !roadIsEditing || road.points.length === 0;
    dom.segmentFields.hidden = !roadIsEditing || getRoadSegmentCount(road) === 0;
    dom.deleteSelectedBtn.hidden = false;
    dom.deleteSelectedBtn.disabled = !road && !roundabout;
    dom.buildRoadBtn.disabled = !road || road.points.length < 2;
    dom.buildSelectedRoadBtn.disabled = !road || road.points.length < 2;
    dom.pointSmoothInput.disabled = !selectedPoint;
    [
        dom.roadWidthInput,
        dom.trafficDirectionInput,
        dom.laneWidthInput,
        dom.roadLanesInput,
        dom.sidewalkWidthInput,
        dom.sidewalkLeftInput,
        dom.sidewalkRightInput,
    ].forEach((input) => {
        input.disabled = segmentProfileSelected;
    });
    [
        dom.segmentTransitionInput,
        dom.segmentRoadWidthInput,
        dom.segmentTrafficDirectionInput,
        dom.segmentLaneWidthInput,
        dom.segmentLanesInput,
        dom.segmentForwardWidthInput,
        dom.segmentBackwardWidthInput,
        dom.segmentForwardLanesInput,
        dom.segmentBackwardLanesInput,
        dom.segmentDividerTypeInput,
        dom.segmentDividerWidthInput,
        dom.segmentSidewalkLeftWidthInput,
        dom.segmentSidewalkRightWidthInput,
        dom.segmentSidewalkLeftInput,
        dom.segmentSidewalkRightInput,
        dom.resetSegmentProfileBtn,
    ].forEach((input) => {
        input.disabled = !selectedSegment;
    });
    if (selectedSegment) {
        const segmentIsTwoWay = selectedSegment.trafficDirection === 'two-way';
        dom.segmentRoadWidthInput.disabled = segmentIsTwoWay;
        dom.segmentForwardWidthInput.disabled = !segmentIsTwoWay;
        dom.segmentBackwardWidthInput.disabled = !segmentIsTwoWay;
        dom.segmentBackwardLanesInput.disabled = !segmentIsTwoWay;
        dom.segmentDividerTypeInput.disabled = !segmentIsTwoWay;
        dom.segmentDividerWidthInput.disabled = !segmentIsTwoWay || selectedSegment.dividerType === 'none';
        dom.segmentSidewalkLeftWidthInput.disabled = selectedSegment.sidewalkLeft === false;
        dom.segmentSidewalkRightWidthInput.disabled = selectedSegment.sidewalkRight === false;
    }

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

    dom.selectionState.textContent = selectedPoint
        ? `${road.name} node ${state.selectedPointIndex + 1}`
        : (selectedSegment
            ? `${road.name} segment ${state.selectedSegmentIndex + 1}`
            : `${road.name} ${roadIsEditing ? 'edit' : 'move'}`);
    dom.deleteSelectedBtn.textContent = selectedPoint
        ? 'Delete selected node'
        : (selectedSegment ? 'Reset selected segment' : 'Delete selected road');
    dom.deleteSelectedBtn.hidden = !!selectedSegment;
    const laneLayout = calculateRoadLaneLayout(road.width, road.laneWidth, road.trafficDirection);
    road.lanes = laneLayout.totalLanes;
    dom.roadNameInput.value = road.name;
    dom.roadWidthInput.value = formatNumber(road.width);
    dom.trafficDirectionInput.value = laneLayout.trafficDirection;
    dom.roadLanesInput.value = String(laneLayout.totalLanes);
    dom.laneWidthInput.value = formatNumber(road.laneWidth);
    dom.laneSummary.textContent = formatLaneSummary(laneLayout);
    dom.roadLanesInput.title = formatLaneSummary(laneLayout);
    dom.sidewalkWidthInput.value = formatNumber(road.sidewalkWidth);
    dom.sidewalkLeftInput.checked = !!road.sidewalkLeft;
    dom.sidewalkRightInput.checked = !!road.sidewalkRight;
    syncPointSelect(road);
    syncSegmentSelect(road);
    syncSegmentProfileFields(road, selectedSegment);
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

function syncSegmentSelect(road) {
    const currentValue = Number.isInteger(state.selectedSegmentIndex) ? String(state.selectedSegmentIndex) : '';
    const segmentCount = getRoadSegmentCount(road);
    const profiles = normalizeRoadSegmentProfileList(road);
    dom.segmentSelectInput.replaceChildren();

    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No segment';
    dom.segmentSelectInput.append(none);

    for (let index = 0; index < segmentCount; index += 1) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Segment ${index + 1} (${index + 1}-${index + 2})${profiles[index] ? ' override' : ''}`;
        dom.segmentSelectInput.append(option);
    }

    dom.segmentSelectInput.value = currentValue;
}

function syncSegmentProfileFields(road, selectedSegment) {
    const profile = selectedSegment || getEffectiveRoadProfile(road, null);
    const layout = getLaneLayoutForProfile(profile);
    dom.segmentTransitionInput.value = profile.transition;
    dom.segmentRoadWidthInput.value = formatNumber(profile.width);
    dom.segmentTrafficDirectionInput.value = layout.trafficDirection;
    dom.segmentLaneWidthInput.value = formatNumber(profile.laneWidth);
    dom.segmentLanesInput.value = String(layout.totalLanes);
    dom.segmentForwardWidthInput.value = formatNumber(layout.forwardWidthM);
    dom.segmentBackwardWidthInput.value = formatNumber(layout.backwardWidthM);
    dom.segmentForwardLanesInput.value = String(layout.forwardLanes);
    dom.segmentBackwardLanesInput.value = String(layout.backwardLanes);
    dom.segmentDividerTypeInput.value = layout.dividerType;
    dom.segmentDividerWidthInput.value = formatNumber(layout.dividerWidthM);
    dom.segmentLaneSummary.textContent = selectedSegment
        ? formatLaneSummary(layout)
        : 'Select a segment to override its profile.';
    dom.segmentSidewalkLeftWidthInput.value = formatNumber(profile.sidewalkLeftWidth);
    dom.segmentSidewalkRightWidthInput.value = formatNumber(profile.sidewalkRightWidth);
    dom.segmentSidewalkLeftInput.checked = !!profile.sidewalkLeft;
    dom.segmentSidewalkRightInput.checked = !!profile.sidewalkRight;
}

function updateSelectedRoadFromInspector() {
    const road = getSelectedRoad();
    if (!road) return;
    road.name = dom.roadNameInput.value.trim() || road.name;
    if (Number.isInteger(state.selectedSegmentIndex)) {
        syncInspector();
        return;
    }
    road.width = clampNumber(dom.roadWidthInput.value, 2, 80, road.width);
    road.laneWidth = clampNumber(dom.laneWidthInput.value, 2, 5, road.laneWidth);
    road.trafficDirection = normalizeTrafficDirection(dom.trafficDirectionInput.value);
    road.lanes = calculateRoadLaneLayout(road.width, road.laneWidth, road.trafficDirection).totalLanes;
    road.sidewalkWidth = clampNumber(dom.sidewalkWidthInput.value, 0, 8, road.sidewalkWidth);
    road.sidewalkLeft = dom.sidewalkLeftInput.checked;
    road.sidewalkRight = dom.sidewalkRightInput.checked;
    markRoadDirty(road);
    rebuildSceneForChangedRoad(road.id);
}

function updateSelectedSegmentSelectionFromInspector() {
    const road = getSelectedRoad();
    if (!road) return;
    const nextIndex = dom.segmentSelectInput.value === '' ? null : Number(dom.segmentSelectInput.value);
    if (Number.isInteger(nextIndex)) {
        selectRoadSegment(road.id, nextIndex);
        rebuildScene();
        setStatus(`Selected ${road.name} segment ${nextIndex + 1}.`);
        return;
    }
    enterRoadEditMode(road.id, null);
    rebuildScene();
    setStatus(`Editing ${road.name}: select a node or segment.`);
}

function updateSelectedSegmentFromInspector() {
    const road = getSelectedRoad();
    if (!road || !Number.isInteger(state.selectedSegmentIndex)) return;
    const trafficDirection = normalizeTrafficDirection(dom.segmentTrafficDirectionInput.value);
    const sidewalkLeft = dom.segmentSidewalkLeftInput.checked;
    const sidewalkRight = dom.segmentSidewalkRightInput.checked;
    const dividerType = trafficDirection === 'two-way'
        ? normalizeDividerType(dom.segmentDividerTypeInput.value)
        : 'none';
    const dividerWidth = trafficDirection === 'two-way'
        ? clampNumber(dom.segmentDividerWidthInput.value, 0, 24, DEFAULT_DIVIDER_WIDTH_M)
        : 0;
    const baseWidth = clampNumber(dom.segmentRoadWidthInput.value, 2, 80, road.width);
    const fallbackDirectionWidths = normalizeDirectionalRoadWidths({}, trafficDirection, baseWidth, dividerWidth);
    const rawForwardWidth = Number(dom.segmentForwardWidthInput.value);
    const rawBackwardWidth = Number(dom.segmentBackwardWidthInput.value);
    const useFallbackDirectionWidths = trafficDirection === 'two-way' && (
        !Number.isFinite(rawForwardWidth) || rawForwardWidth <= 0
        || !Number.isFinite(rawBackwardWidth) || rawBackwardWidth <= 0
    );
    const forwardWidth = trafficDirection === 'two-way'
        ? clampNumber(useFallbackDirectionWidths ? fallbackDirectionWidths.forwardWidth : rawForwardWidth, 0.5, 80, fallbackDirectionWidths.forwardWidth)
        : baseWidth;
    const backwardWidth = trafficDirection === 'two-way'
        ? clampNumber(useFallbackDirectionWidths ? fallbackDirectionWidths.backwardWidth : rawBackwardWidth, 0.5, 80, fallbackDirectionWidths.backwardWidth)
        : 0;
    const fittedDirectionWidths = normalizeDirectionalRoadWidths({ forwardWidth, backwardWidth }, trafficDirection, baseWidth, dividerWidth);
    const width = trafficDirection === 'two-way'
        ? fittedDirectionWidths.forwardWidth + fittedDirectionWidths.backwardWidth + dividerWidth
        : baseWidth;
    const sidewalkLeftWidth = sidewalkLeft
        ? clampNumber(dom.segmentSidewalkLeftWidthInput.value, 0, 8, road.sidewalkWidth)
        : 0;
    const sidewalkRightWidth = sidewalkRight
        ? clampNumber(dom.segmentSidewalkRightWidthInput.value, 0, 8, road.sidewalkWidth)
        : 0;
    const profile = {
        transition: normalizeSegmentTransition(dom.segmentTransitionInput.value),
        width,
        laneWidth: clampNumber(dom.segmentLaneWidthInput.value, 2, 5, road.laneWidth),
        trafficDirection,
        forwardWidth: fittedDirectionWidths.forwardWidth,
        backwardWidth: fittedDirectionWidths.backwardWidth,
        forwardLanes: Math.round(clampNumber(dom.segmentForwardLanesInput.value, 1, 16, 1)),
        backwardLanes: trafficDirection === 'two-way'
            ? Math.round(clampNumber(dom.segmentBackwardLanesInput.value, 1, 16, 1))
            : 0,
        dividerType,
        dividerWidth,
        sidewalkWidth: Math.max(sidewalkLeftWidth, sidewalkRightWidth),
        sidewalkLeftWidth,
        sidewalkRightWidth,
        sidewalkLeft,
        sidewalkRight,
    };
    const saved = setRoadSegmentProfile(road, state.selectedSegmentIndex, profile);
    if (!saved) return;
    rebuildSceneForChangedRoad(road.id);
    const directionText = saved.trafficDirection === 'two-way'
        ? ` forward ${formatNumber(saved.forwardWidth)} m, backward ${formatNumber(saved.backwardWidth)} m`
        : '';
    setStatus(`${road.name} segment ${state.selectedSegmentIndex + 1}: ${formatNumber(saved.width)} m${directionText}, ${saved.transition} transition, ${saved.lanes} lanes.`);
}

function resetSelectedSegmentProfile() {
    const road = getSelectedRoad();
    if (!road || !Number.isInteger(state.selectedSegmentIndex)) return;
    const segmentIndex = state.selectedSegmentIndex;
    if (!resetRoadSegmentProfile(road, segmentIndex)) return;
    rebuildSceneForChangedRoad(road.id);
    setStatus(`${road.name} segment ${segmentIndex + 1}: reset to road profile.`);
}

function updateSelectedPointFromInspector() {
    const road = getSelectedRoad();
    const point = road?.points[state.selectedPointIndex];
    if (!point) return;
    point.smooth = dom.pointSmoothInput.value;
    rebuildGeneratedRoadAfterGeometryChange(road);
    rebuildSceneForChangedRoad(road.id);
    setStatus(`${road.name} node ${state.selectedPointIndex + 1}: ${formatSmoothMode(point.smooth)}. ${road.built ? '3D road rebuilt.' : 'Press Build 3D to generate the road.'}`);
}

function updateSelectedPointSelectionFromInspector() {
    const road = getSelectedRoad();
    if (!road) return;
    const nextIndex = dom.pointSelectInput.value === '' ? null : Number(dom.pointSelectInput.value);
    enterRoadEditMode(road.id, Number.isInteger(nextIndex) ? nextIndex : null);
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
    return getRoadById(state.selectedRoadId);
}

function getSelectedRoundabout() {
    return getRoundaboutById(state.selectedRoundaboutId);
}

function getRoadById(roadId) {
    return state.roads.find((road) => road.id === roadId) || null;
}

function getRoundaboutById(roundaboutId) {
    return state.roundabouts.find((roundabout) => roundabout.id === roundaboutId) || null;
}

function selectRoad(roadId, pointIndex = null, options: { edit?: boolean } = {}) {
    state.selectedRoadId = roadId;
    state.selectedRoundaboutId = null;
    state.editingRoadId = options.edit && roadId ? roadId : null;
    state.selectedPointIndex = options.edit ? pointIndex : null;
    state.selectedSegmentIndex = null;
}

function enterRoadEditMode(roadId, pointIndex = null) {
    selectRoad(roadId, pointIndex, { edit: true });
}

function selectRoadSegment(roadId, segmentIndex) {
    selectRoad(roadId, null, { edit: true });
    const road = getRoadById(roadId);
    const segmentCount = getRoadSegmentCount(road);
    state.selectedSegmentIndex = Number.isInteger(segmentIndex) && segmentCount > 0
        ? THREE.MathUtils.clamp(segmentIndex, 0, Math.max(0, segmentCount - 1))
        : null;
}

function isRoadEditing(roadOrId) {
    const roadId = typeof roadOrId === 'string' ? roadOrId : roadOrId?.id;
    return !!roadId && state.editingRoadId === roadId;
}

function selectRoundabout(roundaboutId) {
    state.selectedRoundaboutId = roundaboutId;
    state.selectedRoadId = null;
    state.selectedPointIndex = null;
    state.selectedSegmentIndex = null;
    state.editingRoadId = null;
    state.activeDrawRoadId = null;
    state.activeDrawInsertSide = null;
}

function hasSelection() {
    return !!state.selectedRoadId || !!state.selectedRoundaboutId;
}

function hasSelectedPoint() {
    const road = getSelectedRoad();
    return isRoadEditing(road) && Number.isInteger(state.selectedPointIndex) && !!road.points[state.selectedPointIndex];
}

function hasSelectedSegment() {
    const road = getSelectedRoad();
    return isRoadEditing(road)
        && Number.isInteger(state.selectedSegmentIndex)
        && state.selectedSegmentIndex >= 0
        && state.selectedSegmentIndex < getRoadSegmentCount(road);
}

function markRoadDirty(road) {
    if (!road) return;
    road.buildDirty = true;
}

function rebuildGeneratedRoadAfterGeometryChange(road) {
    if (!road) return;
    road.points = normalizeRoadPoints(road.points);
    normalizeRoadSegmentProfileList(road);
    if (road.built && road.points.length >= 2) {
        road.builtAxisPoints = sampleRoadAxis(road);
        road.buildDirty = false;
        return;
    }
    road.buildDirty = road.points.length > 0;
}

function rebuildGeneratedRoadAfterTopologyChange(road) {
    if (!road) return;
    const wasBuilt = !!road.built;
    road.points = normalizeRoadPoints(road.points);
    normalizeRoadSegmentProfileList(road);
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
    buildGeneratedRoadGeometry(road);
    rebuildSceneForChangedRoad(road.id);
    setStatus(`${road.name} built as 3D road from ${road.points.length} spline nodes.`);
}

function buildGeneratedRoadGeometry(road) {
    if (!road || road.points.length < 2) return false;
    road.points = normalizeRoadPoints(road.points);
    normalizeRoadSegmentProfileList(road);
    road.builtAxisPoints = sampleRoadAxis(road);
    road.built = true;
    road.buildDirty = false;
    return true;
}

function deleteSelected() {
    if (hasSelectedPoint()) {
        deleteSelectedPoint();
        return;
    }
    if (hasSelectedSegment()) {
        resetSelectedSegmentProfile();
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
    const profiles = normalizeRoadSegmentProfileList(road);
    road.points.splice(removedIndex, 1);

    if (road.points.length === 0) {
        deleteSelectedRoad();
        return;
    }

    const profileIndexToRemove = removedIndex === 0
        ? 0
        : Math.min(removedIndex, profiles.length - 1);
    profiles.splice(profileIndexToRemove, 1);
    normalizeRoadSegmentProfileList(road);
    state.selectedPointIndex = Math.min(removedIndex, road.points.length - 1);
    state.selectedSegmentIndex = null;
    rebuildGeneratedRoadAfterTopologyChange(road);
    rebuildSceneForChangedRoad(road.id);

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
    state.activeDrawInsertSide = null;
    rebuildScene();
    setStatus(`Deleted ${removed.name}.`);
}

function deleteSelectedRoundabout() {
    if (!state.selectedRoundaboutId) return;
    const index = state.roundabouts.findIndex((roundabout) => roundabout.id === state.selectedRoundaboutId);
    if (index < 0) return;
    const [removed] = state.roundabouts.splice(index, 1);
    state.selectedRoundaboutId = state.roundabouts[Math.max(0, index - 1)]?.id || null;
    state.editingRoadId = null;
    rebuildScene();
    setStatus(`Deleted ${removed.name}.`);
}

function clearProject() {
    state.roads = [];
    state.roundabouts = [];
    state.selectedRoadId = null;
    state.selectedRoundaboutId = null;
    state.selectedPointIndex = null;
    state.selectedSegmentIndex = null;
    state.editingRoadId = null;
    state.activeDrawRoadId = null;
    state.activeDrawInsertSide = null;
    rebuildScene();
    setStatus('Project cleared.');
}

function syncStats() {
    const roadCount = state.roads.length;
    const pointCount = state.roads.reduce((sum, road) => sum + road.points.length, 0);
    const builtCount = state.roads.filter((road) => road.built).length;
    const junctionCount = state.topology?.junctionCount || 0;
    dom.objectCount.textContent = `${builtCount}/${roadCount} built`;
    if (dom.junctionCount) dom.junctionCount.textContent = `${junctionCount} junction${junctionCount === 1 ? '' : 's'}`;
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
        if (child.userData?.exportable === false) return;
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

function formatLaneSummary(layout) {
    if (layout.trafficDirection === 'one-way') {
        const laneWidths = layout.forwardLaneWidthsM.map((width) => `${formatNumber(width)} m`).join(' / ');
        return `${layout.totalLanes} one-way lane${layout.totalLanes === 1 ? '' : 's'} · widths ${laneWidths}`;
    }
    const forwardWidths = layout.forwardLaneWidthsM.map((width) => `${formatNumber(width)} m`).join(' / ');
    const backwardWidths = layout.backwardLaneWidthsM.map((width) => `${formatNumber(width)} m`).join(' / ');
    const divider = layout.dividerType === 'none'
        ? 'no divider'
        : `${layout.dividerType} divider ${formatNumber(layout.dividerWidthM)} m`;
    return `${layout.totalLanes} lanes · road F ${formatNumber(layout.forwardWidthM)} m, B ${formatNumber(layout.backwardWidthM)} m · forward ${layout.forwardLanes}, backward ${layout.backwardLanes} · ${divider} · F lanes ${forwardWidths} · B lanes ${backwardWidths}`;
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
