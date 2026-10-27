import { expect, it } from 'node-test';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
  ICEOrbitController,
  ICEPerspectiveCamera,
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

it('rotates the camera without moving the scene', () => {
  const { camera, controller } = createController();
  const before = camera.getPosition().toArray();

  controller.rotateBy(100, 0);

  expect(camera.getPosition().toArray()).not.toEqual(before);
  expect(Math.hypot(...camera.getPosition().toArray())).toBeCloseTo(5, 5);
  controller.dispose();
});

it('clamps camera pitch and zoom distance', () => {
  const { camera, controller } = createController();

  controller.rotateBy(0, 100_000);
  expect(Number.isFinite(camera.getPosition().y)).toBe(true);
  controller.zoomBy(100_000);
  expect(Math.hypot(...camera.getPosition().toArray())).toBeLessThanOrEqual(100);
  controller.zoomBy(-100_000);
  expect(Math.hypot(...camera.getPosition().toArray())).toBeGreaterThanOrEqual(0.2);
  controller.dispose();
});

it('is idempotent when started and stopped', () => {
  const { controller } = createController();

  controller.start().start();
  controller.stop().stop();
  controller.dispose();
});

it('orbits from shared engine pointer events until pointer release', () => {
  const { engine, camera, controller } = createController();
  const before = camera.getPosition().toArray();
  controller.start();

  engine.trigger('POINTER_DOWN', {
    target: { kind: 'scene' },
    event: { type: 'pointerdown', point: { x: 10, y: 10 }, pointerId: 3 },
  });
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene' },
    event: { type: 'pointermove', point: { x: 110, y: 10 }, pointerId: 3 },
  });
  engine.trigger('POINTER_UP', {
    target: { kind: 'scene' },
    event: { type: 'pointerup', point: { x: 110, y: 10 }, pointerId: 3 },
  });
  const after = camera.getPosition().toArray();

  expect(after).not.toEqual(before);
  engine.trigger('POINTER_MOVE', {
    target: { kind: 'scene' },
    event: { type: 'pointermove', point: { x: 210, y: 10 }, pointerId: 3 },
  });
  expect(camera.getPosition().toArray()).toEqual(after);
  controller.dispose();
});

it('zooms from two-pointer pinching', () => {
  const { engine, camera, controller } = createController();
  const initial = Math.hypot(...camera.getPosition().toArray());
  controller.start();

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

  expect(Math.hypot(...camera.getPosition().toArray())).toBeLessThan(initial);
  controller.dispose();
});
