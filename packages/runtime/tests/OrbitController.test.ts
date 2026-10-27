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

it('focuses item bounds while preserving the current view direction', () => {
  const { camera, controller, dispose } = createMotionScenario();
  const direction = (): readonly number[] => {
    const position = camera.getPosition().toArray();
    const target = camera.getTarget().toArray();
    const delta = position.map((value, axis) => value - target[axis]!);
    const length = Math.hypot(...delta);
    return delta.map((value) => value / length);
  };
  const directionBefore = direction();

  controller.focus({
    bounds: {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    },
  }, { animate: false });
  const directionAfter = direction();

  expect(camera.getTarget().toArray()).toEqual([0, 0, 0]);
  expect(directionAfter).toEqual(directionBefore);
  expect(Math.hypot(...camera.getPosition().toArray())).toBeGreaterThan(2);
  dispose();
});

it('rejects invalid focus padding', () => {
  const { controller, dispose } = createMotionScenario();

  expect(() => controller.focus({
    bounds: {
      min: [0, 0, 0],
      max: [0, 0, 0],
    },
  }, { padding: 0 })).toThrow(/ICE3_CAMERA_FOCUS_INVALID/);
  dispose();
});

it('maps W and S to the same view-plane pan as the up and down arrows', () => {
  const positionAfterKey = (code: string): readonly number[] => {
    const scenario = createMotionScenario();
    scenario.engine.trigger('KEY_DOWN', {
      target: { kind: 'scene' },
      event: { type: 'keydown', code, key: code },
    });
    scenario.advanceFrame();
    const position = scenario.camera.getPosition().toArray();
    scenario.dispose();
    return position;
  };

  const up = positionAfterKey('ArrowUp');
  const w = positionAfterKey('KeyW');
  const down = positionAfterKey('ArrowDown');
  const s = positionAfterKey('KeyS');

  expect(w).toEqual(up);
  expect(s).toEqual(down);
  expect(w[1]).toBeGreaterThan(0);
  expect(w[2]).toBeCloseTo(5, 5);
  expect(s[1]).toBeLessThan(0);
  expect(s[2]).toBeCloseTo(5, 5);
});

it('routes physical keyboard presses from the engine surface', () => {
  const { camera, advanceFrame, dispose } = createMotionScenario();
  const before = camera.getPosition().toArray();

  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyW',
    key: 'w',
  }));
  advanceFrame();

  expect(camera.getPosition().toArray()).not.toEqual(before);
  dispose();
});

it('pans vertically with the up and down arrow keys without zooming', () => {
  const upward = createMotionScenario();
  upward.engine.trigger('KEY_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'keydown', code: 'ArrowUp', key: 'ArrowUp' },
  });
  upward.advanceFrame();
  const upTarget = upward.camera.getTarget().toArray();
  const upCamera = upward.camera.getPosition().toArray();
  upward.dispose();

  const downward = createMotionScenario();
  downward.engine.trigger('KEY_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'keydown', code: 'ArrowDown', key: 'ArrowDown' },
  });
  downward.advanceFrame();
  const downTarget = downward.camera.getTarget().toArray();
  downward.dispose();

  expect(upTarget[1]).toBeGreaterThan(0);
  expect(upCamera[1]).toBeGreaterThan(0);
  expect(upCamera[2]).toBeCloseTo(5, 5);
  expect(downTarget[1]).toBeLessThan(0);
});

it('maps A, D, and the left and right arrows to horizontal view-plane pan', () => {
  const positionAfterKey = (code: string): readonly number[] => {
    const scenario = createMotionScenario();
    scenario.engine.trigger('KEY_DOWN', {
      target: { kind: 'scene' },
      event: { type: 'keydown', code, key: code },
    });
    scenario.advanceFrame();
    const position = scenario.camera.getPosition().toArray();
    scenario.dispose();
    return position;
  };

  expect(positionAfterKey('KeyA')[0]).toBeLessThan(0);
  expect(positionAfterKey('ArrowLeft')[0]).toBeLessThan(0);
  expect(positionAfterKey('KeyD')[0]).toBeGreaterThan(0);
  expect(positionAfterKey('ArrowRight')[0]).toBeGreaterThan(0);
});

it('stops camera movement when the held key is released', () => {
  const { engine, camera, advanceFrame, dispose } = createMotionScenario();
  engine.trigger('KEY_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'keydown', code: 'KeyW', key: 'w' },
  });
  advanceFrame();
  const afterMovement = camera.getPosition().toArray();

  engine.trigger('KEY_UP', {
    target: { kind: 'scene' },
    event: { type: 'keyup', code: 'KeyW', key: 'w' },
  });
  advanceFrame();

  expect(camera.getPosition().toArray()).toEqual(afterMovement);
  dispose();
});

it('does not move the camera when typing in an editable control', () => {
  const { camera, advanceFrame, dispose } = createMotionScenario();
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  const before = camera.getPosition().toArray();

  input.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    code: 'KeyW',
    key: 'w',
  }));
  advanceFrame();

  expect(camera.getPosition().toArray()).toEqual(before);
  input.remove();
  dispose();
});

it('prevents navigation keys from scrolling the page', () => {
  const { dispose } = createMotionScenario();
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'ArrowLeft',
    key: 'ArrowLeft',
  });

  window.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  dispose();
});

it('releases held keys when the window loses focus', () => {
  const { camera, advanceFrame, dispose } = createMotionScenario();
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyW',
    key: 'w',
  }));
  advanceFrame();
  const beforeBlur = camera.getPosition().toArray();

  window.dispatchEvent(new Event('blur'));
  advanceFrame();

  expect(camera.getPosition().toArray()).toEqual(beforeBlur);
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
