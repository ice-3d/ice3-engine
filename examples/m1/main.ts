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
const engine = new ICE3().init(stage);
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
const adaptiveBatching = adaptiveDemo || query.get('adaptive') === '1';
const assetUrl = adaptiveDemo
  ? '/assets/adaptive-demo/tileset.json'
  : '/assets/hierarchical-demo/tileset.json';
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
let selectedNode: ICENode | null = null;
let assetReleased = false;
let loadFinished = false;
let viewUpdating = false;
let sceneRevealed = false;
let assetCenter: readonly [number, number, number] = [0, 0, 0];

engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
  const selectedId = event.param?.selection[0];
  selectedNode = selectedId
    ? findNodeBySelectionId(handle?.scene, selectedId) ?? null
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

function showSelectionInfo(node: ICENode): void {
  const hash = hashText(node.id);
  const statuses = ['运行正常', '待机', '维护中'] as const;
  const types = ['泵组', '输送设备', '控制柜', '检测设备', '执行机构'] as const;
  const areas = ['A 区', 'B 区', '动力区', '装配区'] as const;
  selectionName.textContent = node.displayName;
  selectionCode.textContent = `EQ-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
  selectionStatus.textContent = statuses[hash % statuses.length]!;
  selectionType.textContent = types[(hash >>> 3) % types.length]!;
  selectionArea.textContent = areas[(hash >>> 6) % areas.length]!;
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
  const visit = (current: ICENode): void => {
    if (current instanceof ICEMesh) meshes.push(current);
    for (const child of current.children) visit(child);
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

function findNodeBySelectionId(
  node: ICENode | undefined,
  selectionId: string,
): ICENode | undefined {
  if (!node) return undefined;
  if (node instanceof ICEMesh && node.selectionId === selectionId) {
    return node;
  }
  for (const child of node.children) {
    const found = findNodeBySelectionId(child, selectionId);
    if (found) return found;
  }
  return undefined;
}

function scenePixelAtProjection(): readonly [number, number, number, number] {
  const point = engine.project(selectedScenePoint());
  const canvas = document.querySelector<HTMLCanvasElement>(
    'canvas[data-layer="scene"]',
  );
  const gl = canvas?.getContext('webgl2');
  if (!canvas || !gl) throw new Error('WebGL2 canvas missing');
  const pixel = new Uint8Array(4);
  const diagnostics = engine.getDiagnostics();
  gl.readPixels(
    Math.max(0, Math.floor(point.x * diagnostics.dpr)),
    Math.max(0, Math.floor((diagnostics.viewport.height - point.y) * diagnostics.dpr)),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
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
    handle = await loader.open(assetUrl);
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
  const visit = (node: ICENode, depth: number): void => {
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
    for (const child of node.children) visit(child, depth + 1);
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
  whenLodIdle: async () => {
    await Promise.resolve();
    await handle?.whenIdle();
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
