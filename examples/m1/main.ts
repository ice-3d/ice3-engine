import {
  ICE3,
  ICEAssetLoader,
  ICEOrbitController,
  ICEPerspectiveCamera,
  type ICEEngineDiagnostics,
  type ICEInputEvent,
  type ICEInputTarget,
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
const engine = new ICE3().init(stage);
engine.setBackgroundColor('#aeb8c4');
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
let assetCenter: readonly [number, number, number] = [0, 0, 0];
const requestedAsset = new URLSearchParams(window.location.search).get('asset')
  ?? 'prepared-cube.glb';
const assetName = requestedAsset.replace(/[^a-zA-Z0-9._-]/g, '');

engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
  const selection = event.param?.selection ?? [];
  status.textContent = selection.length > 0
    ? `已选中 ${selection[0]}`
    : status.textContent === '资产已释放' ? '资产已释放' : '资产已加载';
});
engine.on<{ target: ICEInputTarget; event: ICEInputEvent }>(
  'POINTER_DOWN',
  () => {},
);

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
  orbit?.dispose();
  orbit = null;
  handle.dispose();
  handle = null;
  status.textContent = '资产已释放';
}

async function start(): Promise<void> {
  try {
    handle = await loader.load(`/assets/${assetName}`);
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
    status.textContent = '资产已加载';
  } catch (error) {
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
  scenePixelAtProjection,
  selectedIds: () => engine.getSelection(),
  disposeAsset,
  assetStats: () => handle?.stats ?? {
    nodeCount: 0,
    meshCount: 0,
    triangleCount: 0,
  },
};

void start();
