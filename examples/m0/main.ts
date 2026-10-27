import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICELabel,
  ICEMesh,
  ICEOrbitController,
  ICEPerspectiveCamera,
  ICEScene,
  ICEScreenLayer,
  type ICEEngineDiagnostics,
  type ICEInputEvent,
  type ICEInputTarget,
  type ICEProjectedPoint,
} from 'ice3';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`ICE3 M0 example element missing: ${selector}`);
  }
  return element;
};

const stage = required<HTMLElement>('[data-role="stage"]');
const status = required<HTMLOutputElement>('[data-role="status"]');
const rebuild = required<HTMLButtonElement>('#rebuild');

let engine: ICE3;
let orbit: ICEOrbitController;
let loseContextExtension: WEBGL_lose_context | null = null;

function mount(rebuilt: boolean): void {
  orbit?.dispose();
  engine?.destroy();
  stage.replaceChildren();

  engine = new ICE3().init(stage);
  loseContextExtension = document
    .querySelector<HTMLCanvasElement>('canvas[data-layer="scene"]')
    ?.getContext('webgl2')
    ?.getExtension('WEBGL_lose_context') ?? null;
  const scene = new ICEScene({ id: 'scene-main' });
  const camera = new ICEPerspectiveCamera({
    id: 'camera-main',
    fov: 45,
    near: 0.1,
    far: 1000,
    position: [3.2, 2.4, 4.5],
    target: [0, 0, 0],
  });
  const block = new ICEMesh({
    id: 'demo-block',
    geometry: new ICEBoxGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new ICEBasicMaterial({
      color: '#2f81f7',
      edgeColor: '#e6f2ff',
    }),
  });
  scene.addChild(block);

  const hudLayer = new ICEScreenLayer({ id: 'screen-layer', order: 10 });
  hudLayer.addChild(
    new ICELabel({
      id: 'hud-status',
      text: '运行',
      screenPosition: [24, 24],
      background: '#173b2a',
      color: '#8df0b5',
      interactive: true,
    }),
  );

  orbit = new ICEOrbitController(engine, camera).start();
  engine.setScene(scene).setCamera(camera).addLayer(hudLayer);
  engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
    const selection = event.param?.selection ?? [];
    status.textContent = selection.length > 0
      ? `已选中 ${selection[0]}`
      : '运行';
  });
  engine.on<{ target: ICEInputTarget; event: ICEInputEvent }>(
    'POINTER_DOWN',
    (event) => {
      if (event.param?.target.kind === 'layer') {
        status.textContent = event.param.target.labelId === 'hud-status'
          ? 'HUD 已点击'
          : '图层已点击';
      }
    },
  );
  engine.start();
  status.textContent = rebuilt ? '已重建' : '运行';
}

rebuild.addEventListener('click', () => mount(true));

window.__ice3M0 = {
  diagnostics: (): Readonly<ICEEngineDiagnostics> => engine.getDiagnostics(),
  projection: (): ICEProjectedPoint => engine.project([0, 0, 0]),
  scenePixelAtProjection: (): readonly [number, number, number, number] => {
    const point = engine.project([0, 0, 0]);
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('WebGL2 canvas missing');
    const pixel = new Uint8Array(4);
    const dpr = engine.getDiagnostics().dpr;
    gl.readPixels(
      Math.max(0, Math.floor(point.x * dpr)),
      Math.max(0, Math.floor((engine.getDiagnostics().viewport.height - point.y) * dpr)),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
  },
  hudRect: () => {
    const rect = engine
      .getDiagnostics()
      .labels.find((item) => item.id === 'hud-status')?.rect;
    if (!rect) throw new Error('HUD rect missing');
    return rect;
  },
  getSelection: () => engine.getSelection(),
  loseContext: () => {
    if (!loseContextExtension) {
      throw new Error('Context-loss test extension unavailable');
    }
    loseContextExtension.loseContext();
  },
  restoreContext: () => {
    if (!loseContextExtension) {
      throw new Error('Context-loss test extension unavailable');
    }
    loseContextExtension.restoreContext();
  },
};

mount(false);
