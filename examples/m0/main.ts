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
  ICEWorldLayer,
  type ICEEngineDiagnostics,
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

function measureWorldLabelOffset(current: ICE3): {
  screenX: number;
  screenY: number;
  labelX: number;
  labelY: number;
} {
  const projection = current.project([0, 0, 0]);
  const label = current
    .getDiagnostics()
    .labels.find((item) => item.id === 'demo-block-label');
  if (!label) {
    throw new Error('World label diagnostics missing');
  }
  return {
    screenX: projection.x,
    screenY: projection.y,
    labelX: label.rect.x + label.rect.width / 2,
    labelY: label.rect.y + label.rect.height / 2,
  };
}

function mount(rebuilt: boolean): void {
  orbit?.dispose();
  engine?.destroy();
  stage.replaceChildren();

  engine = new ICE3().init(stage);
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
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  });
  scene.addChild(block);

  const worldLayer = new ICEWorldLayer({ id: 'world-layer', order: 0 });
  worldLayer.addChild(
    new ICELabel({
      id: 'demo-block-label',
      anchorId: 'demo-block',
      text: '示例设备',
    }),
  );

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
  engine.setScene(scene).setCamera(camera).addLayer(worldLayer).addLayer(hudLayer);
  engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
    const selection = event.param?.selection ?? [];
    status.textContent = selection.length > 0
      ? `已选中 ${selection[0]}`
      : '运行';
  });
  engine.start();
  status.textContent = rebuilt ? '已重建' : '运行';
}

rebuild.addEventListener('click', () => mount(true));

window.__ice3M0 = {
  diagnostics: (): Readonly<ICEEngineDiagnostics> => engine.getDiagnostics(),
  projection: (): ICEProjectedPoint => engine.project([0, 0, 0]),
  hudRect: () => {
    const rect = engine
      .getDiagnostics()
      .labels.find((item) => item.id === 'hud-status')?.rect;
    if (!rect) throw new Error('HUD rect missing');
    return rect;
  },
  getSelection: () => engine.getSelection(),
  measureWorldLabelOffset: () => measureWorldLabelOffset(engine),
  loseContext: () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const extension = canvas?.getContext('webgl2')?.getExtension(
      'WEBGL_lose_context',
    );
    if (!extension) throw new Error('Context-loss test extension unavailable');
    extension.loseContext();
  },
  restoreContext: () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const extension = canvas?.getContext('webgl2')?.getExtension(
      'WEBGL_lose_context',
    );
    if (!extension) throw new Error('Context-loss test extension unavailable');
    extension.restoreContext();
  },
};

mount(false);
