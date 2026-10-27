// @node-test-environment jsdom

import { expect, it, vi } from 'node-test';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
  ICEOrbitController,
  ICEPerspectiveCamera,
  ICEScene,
  type ICERenderScheduler,
} from '../src/index';

const createController = () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const camera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 45,
    near: 0.1,
    far: 100,
    position: [0, 0, 5],
    target: [0, 0, 0],
  });
  return {
    engine,
    camera,
    controller: new ICEOrbitController(engine, camera),
  };
};

const createHost = (): HTMLDivElement => {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 640 });
  Object.defineProperty(host, 'clientHeight', { value: 360 });
  host.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return host;
};

const createManualScheduler = (): ICERenderScheduler => {
  const callbacks: FrameRequestCallback[] = [];
  return {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelAll: () => {
      callbacks.length = 0;
    },
    flushForTest: () => {
      const pending = callbacks.shift();
      pending?.(performance.now());
      return pending !== undefined;
    },
    pendingCount: () => callbacks.length,
  };
};

const createInteractiveController = () => {
  const scheduler = createManualScheduler();
  const engine = new ICE3({
    backend: new FakeRendererBackend(),
    scheduler,
  }).init(createHost());
  const camera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 45,
    near: 0.1,
    far: 100,
    position: [0, 0, 5],
    target: [0, 0, 0],
  });
  const controller = new ICEOrbitController(engine, camera).start();
  engine.setScene(new ICEScene({ id: 'scene' })).setCamera(camera).start();
  scheduler.flushForTest();
  return { engine, camera, controller, scheduler };
};

const createMotionScenario = () => {
  let currentTime = 1_000;
  const now = vi.spyOn(performance, 'now').mockReturnValue(currentTime);
  const resources = createInteractiveController();
  const advanceFrame = (deltaMs = 20): void => {
    currentTime += deltaMs;
    now.mockReturnValue(currentTime);
    resources.scheduler.flushForTest();
  };
  const settle = (): void => {
    for (let frame = 0; frame < 12; frame += 1) {
      advanceFrame(64);
    }
  };
  const dispose = (): void => {
    resources.controller.dispose();
    resources.engine.destroy();
    now.mockRestore();
  };
  return { ...resources, advanceFrame, settle, dispose };
};

it('rotates the camera without moving the scene', () => {
  const { camera, controller, advanceFrame, dispose } = createMotionScenario();
  const before = camera.getPosition().toArray();

  controller.rotateBy(100, 0);
  advanceFrame();

  expect(camera.getPosition().toArray()).not.toEqual(before);
  expect(Math.hypot(...camera.getPosition().toArray())).toBeCloseTo(5, 5);
  dispose();
});

it('clamps camera pitch and zoom distance', () => {
  const { camera, controller, settle, dispose } = createMotionScenario();

  controller.rotateBy(0, 100_000);
  settle();
  expect(Number.isFinite(camera.getPosition().y)).toBe(true);
  controller.zoomBy(100_000);
  settle();
  expect(Math.hypot(...camera.getPosition().toArray())).toBeLessThanOrEqual(100);
  controller.zoomBy(-100_000);
  settle();
  expect(Math.hypot(...camera.getPosition().toArray())).toBeGreaterThanOrEqual(0.2);
  dispose();
});

it('is idempotent when started and stopped', () => {
  const { controller } = createController();

  controller.start().start();
  controller.stop().stop();
  controller.dispose();
});

it('orbits from shared engine pointer events until pointer release', () => {
  const { engine, camera, advanceFrame, settle, dispose } = createMotionScenario();
  const before = camera.getPosition().toArray();

  engine.trigger('POINTER_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'pointerdown', point: { x: 10, y: 10 }, pointerId: 3 },
  });
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene' },
    event: { type: 'pointermove', point: { x: 110, y: 10 }, pointerId: 3 },
  });
  advanceFrame();
  const afterDrag = camera.getPosition().toArray();
  engine.trigger('POINTER_UP', {
    target: { kind: 'scene' },
    event: { type: 'pointerup', point: { x: 110, y: 10 }, pointerId: 3 },
  });
  settle();
  const afterRelease = camera.getPosition().toArray();

  expect(afterDrag).not.toEqual(before);
  expect(afterRelease).not.toEqual(afterDrag);
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene' },
    event: { type: 'pointermove', point: { x: 210, y: 10 }, pointerId: 3 },
  });
  expect(camera.getPosition().toArray()).toEqual(afterRelease);
  dispose();
});

it('zooms from two-pointer pinching', () => {
  const { engine, camera, advanceFrame, dispose } = createMotionScenario();
  const initial = Math.hypot(...camera.getPosition().toArray());

  engine.trigger('POINTER_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'pointerdown', point: { x: 0, y: 0 }, pointerId: 11 },
  });
  engine.trigger('POINTER_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'pointerdown', point: { x: 0, y: 100 }, pointerId: 12 },
  });
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene' },
    event: { type: 'pointermove', point: { x: 0, y: 200 }, pointerId: 12 },
  });
  advanceFrame();

  expect(Math.hypot(...camera.getPosition().toArray())).toBeLessThan(initial);
  dispose();
});

it('orbits when a pointer drag starts over a scene node', () => {
  const { engine, camera, advanceFrame, dispose } = createMotionScenario();
  const before = camera.getPosition().toArray();

  engine.trigger('POINTER_DOWN', {
    target: { kind: 'scene', nodeId: 'block' },
    event: { type: 'pointerdown', point: { x: 10, y: 10 }, pointerId: 3 },
  });
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene', nodeId: 'block' },
    event: { type: 'pointermove', point: { x: 110, y: 10 }, pointerId: 3 },
  });
  advanceFrame();

  expect(camera.getPosition().toArray()).not.toEqual(before);
  dispose();
});

it('eases camera rotation across rendered frames', () => {
  const { camera, controller, advanceFrame, dispose } = createMotionScenario();
  const before = camera.getPosition().toArray();

  controller.rotateBy(200, 0);
  const immediate = camera.getPosition().toArray();
  expect(immediate).toEqual(before);

  advanceFrame();
  const firstFrame = camera.getPosition().toArray();

  advanceFrame();
  const secondFrame = camera.getPosition().toArray();

  expect(firstFrame).not.toEqual(before);
  expect(secondFrame).not.toEqual(firstFrame);
  dispose();
});

it('normalizes line-based wheel deltas to pixel-equivalent zoom', () => {
  const lineScenario = createMotionScenario();
  lineScenario.engine.trigger('WHEEL', {
    target: { kind: 'scene' },
    event: {
      type: 'wheel',
      point: { x: 10, y: 10 },
      deltaY: 3,
      deltaMode: 1,
    },
  });
  lineScenario.settle();
  const lineDistance = Math.hypot(
    ...lineScenario.camera.getPosition().toArray(),
  );
  lineScenario.dispose();

  const pixelScenario = createMotionScenario();
  pixelScenario.engine.trigger('WHEEL', {
    target: { kind: 'scene' },
    event: {
      type: 'wheel',
      point: { x: 10, y: 10 },
      deltaY: 48,
      deltaMode: 0,
    },
  });
  pixelScenario.settle();
  const pixelDistance = Math.hypot(
    ...pixelScenario.camera.getPosition().toArray(),
  );
  pixelScenario.dispose();

  expect(lineDistance).toBeCloseTo(pixelDistance, 5);
});

it('limits a single wheel event to a controlled zoom step', () => {
  const scenario = createMotionScenario();
  scenario.engine.trigger('WHEEL', {
    target: { kind: 'scene' },
    event: {
      type: 'wheel',
      point: { x: 10, y: 10 },
      deltaY: 100_000,
      deltaMode: 0,
    },
  });
  scenario.settle();

  expect(
    Math.hypot(...scenario.camera.getPosition().toArray()),
  ).toBeLessThan(6.4);
  scenario.dispose();
});
