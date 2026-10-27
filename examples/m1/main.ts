import {
  ICE3,
  ICEAssetLoader,
  ICEOrbitController,
  ICEPerspectiveCamera,
  type ICEEngineDiagnostics,
  type ICENode,
  type ICEProjectedPoint,
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
const loader = new ICEAssetLoader(engine);
let handle: Awaited<ReturnType<ICEAssetLoader['load']>> | null = null;
let orbit: ICEOrbitController | null = null;
let selectedNode: ICENode | null = null;
let assetReleased = false;
let assetCenter: readonly [number, number, number] = [0, 0, 0];
const requestedAsset = new URLSearchParams(window.location.search).get('asset')
  ?? 'prepared-cube.glb';
const assetName = requestedAsset.replace(/[^a-zA-Z0-9._-]/g, '');

engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
  const selectedId = event.param?.selection[0];
  selectedNode = selectedId
    ? handle?.scene.findByID(selectedId) ?? null
    : null;
  status.textContent = selectedNode
    ? `已选中 ${selectedNode.displayName}`
    : assetReleased ? '资产已释放' : '资产已加载';
  if (selectedNode) {
    showSelectionInfo(selectedNode);
  } else {
    hideSelectionInfo();
  }
});

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

function scenePixelAtProjection(): readonly [number, number, number, number] {
  const point = engine.project(assetCenter);
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
  status.textContent = '资产已释放';
}

async function start(): Promise<void> {
  try {
    handle = await loader.load(`/assets/${assetName}`);
    loadingDetail.textContent = '初始化场景视图';
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
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    status.textContent = '资产已加载';
    stage.setAttribute('aria-busy', 'false');
    disposeButton.disabled = false;
    loading.dataset.state = 'ready';
    controlsHint.dataset.state = 'visible';
    controlsHint.setAttribute('aria-hidden', 'false');
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

disposeButton.addEventListener('click', disposeAsset);

window.__ice3M1 = {
  diagnostics: (): Readonly<ICEEngineDiagnostics> => engine.getDiagnostics(),
  projection: (): ICEProjectedPoint => engine.project([0, 0, 0]),
  assetCenter: () => engine.project(assetCenter),
  cameraPosition: () => camera.getPosition().toArray(),
  cameraTarget: () => camera.getTarget().toArray(),
  scenePixelAtProjection,
  selectedIds: () => engine.getSelection(),
  disposeAsset,
  assetStats: () => handle?.stats ?? {
    nodeCount: 0,
    maxNodeDepth: 0,
    meshCount: 0,
    primitiveCount: 0,
    triangleCount: 0,
    edgeSegmentCount: 0,
    materialCount: 0,
    selectionGroupCount: 0,
  },
};

void start();
