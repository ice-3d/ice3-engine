import {
  ICE3,
  ICEAssetLoader,
  ICEMesh,
  ICEOrbitController,
  ICEPerspectiveCamera,
  type ICEAssetHandle,
  type ICENode,
} from 'ice3';

interface ConformanceCase {
  readonly id: string;
  readonly title: string;
  readonly assetUrl: string;
  readonly expectedNames: readonly string[];
  readonly expectedSemantics: readonly string[];
  readonly adapter: string;
  readonly warnings: readonly string[];
  readonly notes?: string;
}

interface ConformanceManifest {
  readonly contractVersion: string;
  readonly cases: readonly ConformanceCase[];
}

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Conformance example element missing: ${selector}`);
  return element;
};

const stage = required<HTMLElement>('[data-role="stage"]');
const loading = required<HTMLElement>('[data-role="loading"]');
const status = required<HTMLElement>('[data-role="status"]');
const formatName = required<HTMLElement>('[data-role="format-name"]');
const triangles = required<HTMLElement>('[data-role="triangles"]');
const meshes = required<HTMLElement>('[data-role="meshes"]');
const nodes = required<HTMLElement>('[data-role="nodes"]');
const materials = required<HTMLElement>('[data-role="materials"]');
const note = required<HTMLElement>('[data-role="note"]');
const renderCheck = required<HTMLElement>('[data-role="render-check"]');
const contractCheck = required<HTMLElement>('[data-role="contract-check"]');
const nameCheck = required<HTMLElement>('[data-role="name-check"]');
const selection = required<HTMLElement>('[data-role="selection"]');
const selectionName = required<HTMLElement>('[data-role="selection-name"]');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-format]')];

const engine = new ICE3({ renderer: 'webgl2' }).init(stage);
engine.setBackgroundColor('#03070a');
const camera = new ICEPerspectiveCamera({
  id: 'conformance-camera',
  fov: 42,
  near: 0.05,
  far: 10_000,
  position: [6, 5, 8],
  target: [0, 0, 0],
});
new ICEOrbitController(engine, camera).start();
const loader = new ICEAssetLoader(engine, { verifyIntegrity: true });
let manifest: ConformanceManifest;
let current: ConformanceCase | undefined;
let handle: ICEAssetHandle | undefined;
let loadVersion = 0;
let assetCenter: readonly [number, number, number] = [0, 0, 0];

engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
  const id = event.param?.selection[0];
  const node = id && handle ? findSelected(handle.scene, id) : undefined;
  selection.dataset.state = node ? 'visible' : 'hidden';
  selectionName.textContent = node?.displayName ?? '';
});

async function loadCase(item: ConformanceCase): Promise<void> {
  const version = ++loadVersion;
  document.body.dataset.state = 'loading';
  loading.dataset.state = 'visible';
  stage.setAttribute('aria-busy', 'true');
  status.textContent = `正在加载 ${item.title}`;
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute(
      'aria-current',
      button.dataset.format === item.id ? 'true' : 'false',
    );
  });
  try {
    const next = await loader.load(item.assetUrl);
    if (version !== loadVersion) {
      next.dispose();
      return;
    }
    handle?.dispose();
    handle = next;
    current = item;
    fitCamera(next);
    engine.setScene(next.scene).setCamera(camera);
    updateMetrics(next, item);
    const names = collectNames(next.scene);
    const matched = item.expectedNames.every((name) => (
      names.some((candidate) => candidate.includes(name))
    ));
    nameCheck.dataset.state = matched ? 'pass' : 'fail';
    nameCheck.textContent = matched ? '语义 Node 通过' : '语义 Node 缺失';
    contractCheck.dataset.state = next.contract.status === 'active'
      ? 'pass'
      : 'fail';
    contractCheck.textContent = next.contract.status === 'active'
      ? 'Prepared Profile 通过'
      : 'Profile 无效';
    note.textContent = item.notes ?? item.expectedSemantics.join(' · ');
    loading.dataset.state = 'hidden';
    stage.setAttribute('aria-busy', 'false');
    document.body.dataset.state = 'ready';
    document.body.dataset.format = item.id;
    status.textContent = `${item.title} 已加载`;
    await nextFrame();
    await nextFrame();
    const ratio = visiblePixelRatio();
    renderCheck.dataset.state = ratio > 0.002 ? 'pass' : 'fail';
    renderCheck.textContent = ratio > 0.002
      ? `GPU 画面通过 ${(ratio * 100).toFixed(1)}%`
      : 'GPU 画面无内容';
  } catch (error) {
    loading.dataset.state = 'error';
    document.body.dataset.state = 'error';
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function fitCamera(asset: ICEAssetHandle): void {
  const { min, max } = asset.bounds;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size = Math.max(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
    1,
  );
  assetCenter = center;
  camera.setTarget(center);
  camera.setPosition([
    center[0] + size * 1.6,
    center[1] + size * 1.2,
    center[2] + size * 1.9,
  ]);
}

function updateMetrics(asset: ICEAssetHandle, item: ConformanceCase): void {
  formatName.textContent = item.title;
  triangles.textContent = asset.stats.triangleCount.toLocaleString('zh-CN');
  meshes.textContent = asset.stats.meshCount.toLocaleString('zh-CN');
  nodes.textContent = asset.stats.nodeCount.toLocaleString('zh-CN');
  materials.textContent = asset.stats.materialCount.toLocaleString('zh-CN');
}

function collectNames(root: ICENode): string[] {
  const names: string[] = [];
  const visit = (node: ICENode): void => {
    names.push(node.displayName);
    for (const child of node.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return names;
}

function findSelected(root: ICENode, id: string): ICENode | undefined {
  for (const child of root.children) {
    if (child.selectionId === id) return child;
    const nested = findSelected(child, id);
    if (nested) return nested;
  }
  return undefined;
}

function visiblePixelRatio(): number {
  const canvas = stage.querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]');
  const gl = canvas?.getContext('webgl2');
  if (!canvas || !gl || !engine.project(assetCenter).visible) return 0;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  const stride = 4;
  let samples = 0;
  let visible = 0;
  for (let y = 0; y < canvas.height; y += stride) {
    for (let x = 0; x < canvas.width; x += stride) {
      const index = (y * canvas.width + x) * 4;
      samples += 1;
      if (
        (pixels[index] ?? 0) > 10
        || (pixels[index + 1] ?? 0) > 10
        || (pixels[index + 2] ?? 0) > 10
      ) {
        visible += 1;
      }
    }
  }
  return visible / Math.max(1, samples);
}

function nextFrame(): Promise<void> {
  return new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const item = manifest.cases.find(
      (candidate) => candidate.id === button.dataset.format,
    );
    if (item) void loadCase(item);
  });
});

window.__ice3Conformance = {
  load: async (id: string) => {
    const item = manifest.cases.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown conformance case: ${id}`);
    await loadCase(item);
  },
  state: () => ({
    format: document.body.dataset.format ?? null,
    state: document.body.dataset.state ?? null,
    status: status.textContent,
    pixelRatio: visiblePixelRatio(),
    names: handle ? collectNames(handle.scene) : [],
    stats: handle?.stats ?? null,
    contractStatus: handle?.contract.status ?? null,
  }),
  probePixels: visiblePixelRatio,
};

manifest = await fetch('/assets/conformance/manifest.json')
  .then((response) => {
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    return response.json() as Promise<ConformanceManifest>;
  });
const requested = new URLSearchParams(window.location.search).get('format');
const initial = manifest.cases.find((item) => item.id === requested)
  ?? manifest.cases[0];
if (!initial) throw new Error('Conformance manifest has no cases');
engine.start();
await loadCase(initial);
