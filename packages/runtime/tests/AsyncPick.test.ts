import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/runtime';
import { FakeRendererBackend } from '@ice3/renderer';
import { createHost } from '../../../tests/test-dom.ts';

it('returns a Promise from pick and pickItem', async () => {
  const backend = new FakeRendererBackend({ picking: true });
  const scene = new ICEScene({ id: 'scene' });
  const mesh = new ICEMesh({
    id: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  });
  scene.addChild(mesh);
  backend.pickResult = 'pump';
  const engine = new ICE3({ backend }).init(createHost());
  engine.setScene(scene).setCamera(new ICEPerspectiveCamera({
    id: 'camera',
    position: [0, 0, 4],
    target: [0, 0, 0],
  }));

  const picked = engine.pick({ x: 10, y: 10 });
  const itemResult = engine.pickItem({ x: 10, y: 10 });

  expect(picked).toBeInstanceOf(Promise);
  expect(itemResult).toBeInstanceOf(Promise);
  await expect(picked).resolves.toBe(mesh);
  await expect(itemResult).resolves.toMatchObject({
    item: { nodeId: 'pump' },
  });
});

it('commits only the latest pointer click when picks finish out of order', async () => {
  const backend = new FakeRendererBackend({ picking: true });
  let resolveFirst!: (value: string | undefined) => void;
  const first = new Promise<string | undefined>((resolve) => {
    resolveFirst = resolve;
  });
  let pickCount = 0;
  backend.pick = () => (pickCount++ === 0 ? first : Promise.resolve('valve'));
  const host = createHost();
  const engine = new ICE3({ backend }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ff0000' }),
  }));
  scene.addChild(new ICEMesh({
    id: 'valve',
    selectionId: 'valve',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#00ff00' }),
  }));
  engine.setScene(scene).setCamera(new ICEPerspectiveCamera({
    id: 'camera',
    position: [0, 0, 4],
    target: [0, 0, 0],
  })).start();
  const committed: string[][] = [];
  engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
    committed.push([...(event.param?.selection ?? [])]);
  });
  const overlay = host.querySelector<HTMLCanvasElement>(
    'canvas[data-layer="overlay"]',
  )!;
  Object.defineProperty(overlay, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    }),
  });
  const click = (): void => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 20 },
        clientY: { value: 20 },
        pointerId: { value: 1 },
        button: { value: 0 },
      });
      overlay.dispatchEvent(event);
    }
  };

  click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveFirst('pump');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(committed.at(-1)).toEqual(['valve']);
});
