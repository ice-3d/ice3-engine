import {
  ICE3,
  ICEMesh,
  ICEOrbitController,
  ICEPerspectiveCamera,
  ICETilesetLoader,
  type ICEEngineDiagnostics,
  type ICENode,
  type ICEProjectedPoint,
  type ICETilesetEvent,
  type ICETilesetHandle,
  type ICETilesetStats,
} from 'ice3';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`ICE3 M1 example element missing: ${selector}`);
  return element;
};

const stage = required<HTMLElement>('[data-role="stage"]');
const status = required<HTMLOutputElement>('[data-role="status"]');
const disposeButton = required<HTMLButtonElement>('#dispose');
const loading = required<HTMLElement>('[data-role="loading"]');
const loadingTitle = required<HTMLElement>('[data-role="loading-title"]');
const loadingDetail = required<HTMLElement>('[data-role="loading-detail"]');
const controlsHint = required<HTMLElement>('[data-role="controls-hint"]');
const tilesetProgress = required<HTMLOutputElement>(
  '[data-role="tileset-progress"]',
);
const selectionInfo = required<HTMLElement>('[data-role="selection-info"]');
const selectionName = required<HTMLElement>('[data-role="selection-name"]');
const selectionCode = required<HTMLElement>('[data-role="selection-code"]');
const selectionStatus = required<HTMLElement>('[data-role="selection-status"]');
const selectionType = required<HTMLElement>('[data-role="selection-type"]');
const selectionArea = required<HTMLElement>('[data-role="selection-area"]');
const rendererQuery = new URLSearchParams(window.location.search).get('renderer');
const renderer = rendererQuery === 'auto'
  || rendererQuery === 'webgl2'
  || rendererQuery === 'webgpu'
  ? rendererQuery
  : 'webgl2';
const engine = await new ICE3({ renderer }).initAsync(stage);
engine.setBackgroundColor('#000000');
const camera = new ICEPerspectiveCamera({
  id: 'camera-main',
  fov: 45,
  near: 0.1,
  far: 1000,
  position: [3.2, 2.4, 4.5],
  target: [0, 0, 0],
});
const query = new URLSearchParams(window.location.search);
const adaptiveDemo = query.get('demo') === 'adaptive';
const adaptiveBatching = query.get('adaptive') === '0'
  ? false
  : adaptiveDemo || query.get('adaptive') === '1';
const defaultAssetUrl = adaptiveDemo
  ? '/assets/adaptive-demo/tileset.json'
  : '/assets/wastewater-plant/tiled/tileset.json';
const assetOverride = query.get('asset');
const loader = new ICETilesetLoader(engine, {
  camera,
  ...(adaptiveBatching
    ? {
        renderBatching: {
          mode: 'adaptive' as const,
          maxWorkers: 2,
          uploadBytesPerFrame: 2 * 1024 * 1024,
          maxExtraGpuBytes: 32 * 1024 * 1024,
        },
      }
    : {}),
});
let handle: ICETilesetHandle | null = null;
let orbit: ICEOrbitController | null = null;
let selectedNode: SelectionTarget | null = null;
let assetReleased = false;
let loadFinished = false;
let viewUpdating = false;
let sceneRevealed = false;
let assetCenter: readonly [number, number, number] = [0, 0, 0];

function resolveAssetOverride(value: string): string {
  const url = new URL(value, window.location.href);
  if (
    url.origin !== window.location.origin
    || !url.pathname.startsWith('/assets/')
  ) {
    throw new Error('本地资产必须位于当前站点的 /assets/ 目录');
  }
  return `${url.pathname}${url.search}`;
}

async function resolveAssetUrl(): Promise<string> {
  if (assetOverride !== null) {
    return resolveAssetOverride(assetOverride);
  }
  return defaultAssetUrl;
}

engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
  const selectedId = event.param?.selection[0];
  selectedNode = selectedId
    ? findSelectionTarget(handle?.scene, selectedId) ?? null
    : null;
  updateStatus();
  if (selectedNode) {
    showSelectionInfo(selectedNode);
  } else {
    hideSelectionInfo();
  }
});

function updateStatus(): void {
  if (selectedNode) {
    status.textContent = `已选中 ${selectedNode.displayName}`;
    return;
  }
  if (assetReleased) {
    status.textContent = '资产已释放';
    return;
  }
  if (viewUpdating) {
    status.textContent = '正在更新当前视角';
    return;
  }
  if (!loadFinished) {
    status.textContent = '正在加载分区';
    return;
  }
  const stats = handle?.stats;
  status.textContent = stats && stats.failed > 0
    ? `部分分区加载失败（${stats.failed}/${stats.total}）`
    : stats && stats.lod.fallback > 0
      ? `当前显示粗模回退（${stats.lod.fallback}）`
      : '当前视角已就绪';
}

function updateTilesetProgress(stats: ICETilesetStats): void {
  tilesetProgress.textContent = [
    `切面 ${stats.lod.target}`,
    `驻留 ${stats.lod.resident}`,
    `粗模 ${stats.lod.coarseResident}`,
    `细模 ${stats.lod.fineResident}`,
    `回退 ${stats.lod.fallback}`,
  ].join(' · ');
  tilesetProgress.dataset.state = stats.failed > 0 ? 'partial' : 'active';
}

function onTilesetEvent(
  type: string,
  event: ICETilesetEvent | undefined,
): void {
  const stats = event?.stats;
  if (!stats) return;
  if (type === 'TILESET_TILE_LOADING' || type === 'TILESET_TILE_UNLOADED') {
    viewUpdating = true;
    loadFinished = false;
  }
  if (type === 'TILESET_IDLE') {
    viewUpdating = false;
    loadFinished = true;
  }
  if (type === 'TILESET_READY' || stats.loaded > 0) revealScene();
  updateTilesetProgress(stats);
  updateStatus();
}

function revealScene(): void {
  if (sceneRevealed) return;
  sceneRevealed = true;
  requestAnimationFrame(() => {
    stage.setAttribute('aria-busy', 'false');
    disposeButton.disabled = false;
    loading.dataset.state = 'ready';
    controlsHint.dataset.state = 'visible';
    controlsHint.setAttribute('aria-hidden', 'false');
  });
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface SelectionTarget {
  readonly id: string;
  readonly displayName: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function showSelectionInfo(node: SelectionTarget): void {
  const hash = hashText(node.id);
  const statuses = ['运行正常', '待机', '维护中'] as const;
  const stageNames: Readonly<Record<string, string>> = {
    intake: '预处理',
    primary: '一级处理',
    biological: '生物处理',
    secondary: '二沉与污泥回流',
    advanced: '深度处理',
    sludge: '污泥处理',
    chemical: '药剂投加',
    utilities: '公用工程',
  };
  const areaNames: Readonly<Record<string, string>> = {
    IntakeArea: '进水区',
    PrimaryTreatmentArea: '一级处理区',
    BiologicalTrainA: '生化 A 线',
    BiologicalTrainB: '生化 B 线',
    SecondaryTreatmentArea: '二沉与回流区',
    AdvancedTreatmentArea: '深度处理区',
    DischargeArea: '排放区',
    SludgeTreatmentArea: '污泥处理区',
    ChemicalDosingArea: '加药区',
    UtilitiesArea: '公用工程区',
  };
  const processStage = typeof node.metadata?.processStage === 'string'
    ? node.metadata.processStage
    : '';
  const area = typeof node.metadata?.area === 'string'
    ? node.metadata.area
    : '';
  const equipmentTag = typeof node.metadata?.equipmentTag === 'string'
    ? node.metadata.equipmentTag
    : undefined;
  selectionName.textContent = node.displayName;
  selectionCode.textContent = equipmentTag
    ?? `EQ-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
  selectionStatus.textContent = statuses[hash % statuses.length]!;
  selectionType.textContent = stageNames[processStage] ?? '工业设备';
  selectionArea.textContent = areaNames[area] ?? '厂区';
  selectionInfo.dataset.state = 'visible';
  selectionInfo.setAttribute('aria-hidden', 'false');
}

function hideSelectionInfo(): void {
  selectionInfo.dataset.state = 'hidden';
  selectionInfo.setAttribute('aria-hidden', 'true');
}

function selectedScenePoint(): readonly [number, number, number] {
  const firstMesh = handle ? findStableMesh(handle.scene) : undefined;
  if (!firstMesh) return assetCenter;
  const bounds = firstMesh.geometry.getBounds();
  const local = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
    1,
  ] as const;
  const matrix = firstMesh.updateWorldMatrix().elements;
  return [
    matrix[0]! * local[0]
      + matrix[4]! * local[1]
      + matrix[8]! * local[2]
      + matrix[12]!,
    matrix[1]! * local[0]
      + matrix[5]! * local[1]
      + matrix[9]! * local[2]
      + matrix[13]!,
    matrix[2]! * local[0]
      + matrix[6]! * local[1]
      + matrix[10]! * local[2]
      + matrix[14]!,
  ];
}

function findStableMesh(node: ICENode): ICEMesh | undefined {
  const meshes: ICEMesh[] = [];
  const visit = (current: ICENode, parentVisible = true): void => {
    const visible = parentVisible && current.visible;
    if (visible && current instanceof ICEMesh) meshes.push(current);
    for (const child of current.children) visit(child, visible);
  };
  visit(node);
  meshes.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return meshes[0];
}

function firstSelectionIdentity(node: ICENode): string | undefined {
  if (node instanceof ICEMesh) return node.selectionId;
  const batch = node as ICENode & {
    readonly semanticSelectionIds?: readonly string[];
  };
  if (node.typeId === 'ice3:RenderBatch') {
    return batch.semanticSelectionIds?.[0];
  }
  for (const child of node.children) {
    const selectionId = firstSelectionIdentity(child);
    if (selectionId) return selectionId;
  }
  return undefined;
}

function wastewaterEquipmentIds(node: ICENode): string[] {
  const ids: string[] = [];
  if (
    node instanceof ICEMesh
    && node.selectionId.startsWith('ice3-virtual-wwtp/equipment/')
  ) {
    ids.push(node.selectionId);
  }
  const batch = node as ICENode & {
    readonly semanticSelectionIds?: readonly string[];
  };
  for (const id of batch.semanticSelectionIds ?? []) {
    if (id.startsWith('ice3-virtual-wwtp/equipment/')) {
      ids.push(id);
    }
  }
  for (const child of node.children) {
    ids.push(...wastewaterEquipmentIds(child));
  }
  return ids;
}

function wastewaterEquipmentSelectionIds(): readonly string[] {
  if (!handle) return [];
  return Object.freeze([...new Set(wastewaterEquipmentIds(handle.scene))].sort());
}

function findSelectionTarget(
  node: ICENode | undefined,
  selectionId: string,
): SelectionTarget | undefined {
  if (!node) return undefined;
  if (node.selectionId === selectionId) {
    const metadata = node.metadata;
    return {
      id: node.id,
      displayName: typeof metadata?.displayName === 'string'
        ? metadata.displayName
        : node.displayName,
      ...(metadata ? { metadata } : {}),
    };
  }
  const batch = node as ICENode & {
    readonly semanticSelectionIds?: readonly string[];
    readonly semanticNodeIds?: readonly string[];
  };
  if (node.typeId === 'ice3:RenderBatch') {
    const index = batch.semanticSelectionIds?.indexOf(selectionId) ?? -1;
    if (index >= 0) {
      const stableId = batch.semanticNodeIds?.[index]
        ?? selectionId;
      const equipmentTag = selectionId.split('/').filter(Boolean).at(-1);
      return {
        id: stableId,
        displayName: equipmentTag ? `设备 ${equipmentTag}` : stableId,
      };
    }
  }
  for (const child of node.children) {
    const found = findSelectionTarget(child, selectionId);
    if (found) return found;
  }
  return undefined;
}

function equipmentBusinessMetadata(
  selectionId: string,
): Readonly<Record<string, unknown>> | undefined {
  return handle
    ? findSelectionTarget(handle.scene, selectionId)?.metadata
    : undefined;
}

async function capturedSceneContext(): Promise<{
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
}> {
  const bitmap = await createImageBitmap(await engine.capture());
  const sample = document.createElement('canvas');
  sample.width = bitmap.width;
  sample.height = bitmap.height;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas missing');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { context, width: sample.width, height: sample.height };
}

async function scenePixelAt(
  x: number,
  y: number,
): Promise<readonly [number, number, number, number]> {
  const { context } = await capturedSceneContext();
  const diagnostics = engine.getDiagnostics();
  const pixel = context.getImageData(
    Math.max(0, Math.floor(x * diagnostics.dpr)),
    Math.max(0, Math.floor(y * diagnostics.dpr)),
    1,
    1,
  ).data;
  return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
}

async function scenePixelAtProjection(): Promise<
  readonly [number, number, number, number]
> {
  const point = engine.project(selectedScenePoint());
  return scenePixelAt(point.x, point.y);
}

async function yellowPixelCount(): Promise<number> {
  const { context, width, height } = await capturedSceneContext();
  const pixels = context.getImageData(0, 0, width, height).data;
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (
      pixels[offset]! > 180
      && pixels[offset + 1]! > 140
      && pixels[offset + 2]! < 120
    ) {
      count += 1;
    }
  }
  return count;
}

async function pickSelectionId(
  point: { readonly x: number; readonly y: number },
): Promise<string | undefined> {
  const node = await engine.pick(point);
  return node?.selectionId ?? node?.id;
}

function disposeAsset(): void {
  if (!handle) return;
  assetReleased = true;
  orbit?.dispose();
  orbit = null;
  engine.setSelection([]);
  handle.dispose();
  handle = null;
  selectedNode = null;
  hideSelectionInfo();
  controlsHint.dataset.state = 'hidden';
  controlsHint.setAttribute('aria-hidden', 'true');
  tilesetProgress.textContent = '分区已释放';
  tilesetProgress.dataset.state = 'released';
  updateStatus();
}

async function start(): Promise<void> {
  try {
    handle = await loader.open(await resolveAssetUrl());
    const { min, max } = handle.bounds;
    assetCenter = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ];
    const radius = Math.max(
      0.1,
      Math.hypot(
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2],
      ) / 2,
    );
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
    const directionLength = Math.hypot(1, 0.7, 1.2);
    camera.setTarget(assetCenter);
    camera.setPosition([
      assetCenter[0] + distance * (1 / directionLength),
      assetCenter[1] + distance * (0.7 / directionLength),
      assetCenter[2] + distance * (1.2 / directionLength),
    ]);
    orbit = new ICEOrbitController(engine, camera).start();
    engine.setScene(handle.scene).setCamera(camera).start();
    assetReleased = false;
    updateTilesetProgress(handle.stats);
    updateStatus();
    for (const type of [
      'TILESET_TILE_LOADING',
      'TILESET_TILE_LOADED',
      'TILESET_TILE_FAILED',
      'TILESET_TILE_UNLOADED',
      'TILESET_READY',
      'TILESET_IDLE',
      'TILESET_LOD_CHANGED',
      'TILESET_LOD_FALLBACK',
    ]) {
      handle.on<ICETilesetEvent>(type, (event) => (
        onTilesetEvent(type, event.param)
      ));
    }
    void handle.whenReady().then(revealScene, () => {});
    await handle.whenIdle();
    loadFinished = true;
    const stats = handle.stats;
    updateTilesetProgress(stats);
    if (stats.loaded === 0) {
      loading.dataset.state = 'error';
      loading.setAttribute('aria-label', '工业模型加载失败');
      loadingTitle.textContent = '模型加载失败';
      loadingDetail.textContent = '所有空间分区均加载失败';
      stage.setAttribute('aria-busy', 'false');
    } else {
      revealScene();
    }
    updateStatus();
  } catch (error) {
    selectedNode = null;
    hideSelectionInfo();
    loading.dataset.state = 'error';
    loading.setAttribute('aria-label', '工业模型加载失败');
    loadingTitle.textContent = '模型加载失败';
    loadingDetail.textContent = '请检查模型文件与网络连接';
    stage.setAttribute('aria-busy', 'false');
    status.textContent = `加载失败: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function sceneStats(): {
  nodeCount: number;
  maxNodeDepth: number;
  meshCount: number;
  primitiveCount: number;
  triangleCount: number;
  edgeSegmentCount: number;
  materialCount: number;
  selectionGroupCount: number;
} {
  if (!handle) {
    return {
      nodeCount: 0,
      maxNodeDepth: 0,
      meshCount: 0,
      primitiveCount: 0,
      triangleCount: 0,
      edgeSegmentCount: 0,
      materialCount: 0,
      selectionGroupCount: 0,
    };
  }
  const materials = new Set<object>();
  const selections = new Set<string>();
  let nodeCount = 0;
  let maxNodeDepth = 0;
  let meshCount = 0;
  let primitiveCount = 0;
  let triangleCount = 0;
  let edgeSegmentCount = 0;
  const visit = (
    node: ICENode,
    depth: number,
    parentVisible = true,
  ): void => {
    const visible = parentVisible && node.visible;
    if (!visible) return;
    nodeCount += 1;
    maxNodeDepth = Math.max(maxNodeDepth, depth);
    if (node instanceof ICEMesh) {
      meshCount += 1;
      triangleCount += node.geometry.indices.length / 3;
      edgeSegmentCount += (node.geometry.edgeIndices?.length ?? 0) / 2;
      materials.add(node.material);
      selections.add(node.selectionId);
      primitiveCount += node.geometry.edgeIndices ? 2 : 1;
    }
    for (const child of node.children) visit(child, depth + 1, visible);
  };
  for (const child of handle.scene.children) visit(child, 0);
  return {
    nodeCount,
    maxNodeDepth,
    meshCount,
    primitiveCount,
    triangleCount,
    edgeSegmentCount,
    materialCount: materials.size,
    selectionGroupCount: selections.size,
  };
}

disposeButton.addEventListener('click', disposeAsset);

window.__ice3M1 = {
  diagnostics: (): Readonly<ICEEngineDiagnostics> => engine.getDiagnostics(),
  projection: (): ICEProjectedPoint => engine.project([0, 0, 0]),
  projectWorldPoint: (point) => engine.project(point),
  assetCenter: () => engine.project(selectedScenePoint()),
  cameraPosition: () => camera.getPosition().toArray(),
  cameraTarget: () => camera.getTarget().toArray(),
  setCameraPose: (position, target) => {
    camera.setPosition(position).setTarget(target);
    viewUpdating = true;
    updateStatus();
    engine.requestRender('test-camera-pose');
  },
  showLodOverview: () => {
    if (!handle) return;
    const { min, max } = handle.bounds;
    const center = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ] as const;
    camera.setPosition([center[0] + 18, center[1] + 20, center[2] + 60]);
    camera.setTarget(center);
    viewUpdating = true;
    updateStatus();
    engine.requestRender('lod-overview');
  },
  focusLodBranch: () => {
    const point = selectedScenePoint();
    camera.setPosition([point[0], point[1], point[2] + 2]);
    camera.setTarget(point);
    viewUpdating = true;
    updateStatus();
    engine.requestRender('lod-focus');
  },
  selectOverviewDevice: () => {
    const selectionId = handle
      ? firstSelectionIdentity(handle.scene)
      : undefined;
    engine.setSelection(selectionId ? [selectionId] : []);
  },
  equipmentSelectionIds: wastewaterEquipmentSelectionIds,
  equipmentMetadata: equipmentBusinessMetadata,
  whenLodIdle: async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await handle?.whenIdle();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await handle?.whenIdle();
    viewUpdating = false;
    loadFinished = true;
    updateStatus();
  },
  visibleMeshCount: () => {
    let count = 0;
    const visit = (node: ICENode): void => {
      if (node instanceof ICEMesh && node.visible) count += 1;
      for (const child of node.children) visit(child);
    };
    if (handle) visit(handle.scene);
    return count;
  },
  scenePixelAtProjection,
  scenePixelAt,
  yellowPixelCount,
  pickSelectionId,
  selectedIds: () => engine.getSelection(),
  disposeAsset,
  assetStats: sceneStats,
  adaptiveStats: () => handle?.adaptiveStats ?? {
    mode: 'asset',
    activeGeneration: 1,
    adaptiveBatchCount: 0,
  },
  tilesetStats: () => handle?.stats ?? {
    total: 0,
    pending: 0,
    loading: 0,
    loaded: 0,
    failed: 0,
    evicted: 0,
    visible: 0,
    resident: 0,
    residentBytes: 0,
    residentContents: 0,
    loadingContents: 0,
    lod: {
      target: 0,
      resident: 0,
      coarseResident: 0,
      fineResident: 0,
      transitioning: 0,
      fallback: 0,
      maxScreenSpaceErrorPixels: 16,
    },
  },
};

void start();
