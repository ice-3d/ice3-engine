import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
  type ICERenderScheduler,
} from '../src/index';

it('projects the camera target to the viewport center', () => {
  const callbacks: FrameRequestCallback[] = [];
  const scheduler: ICERenderScheduler = {
    request: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelAll: () => {
      callbacks.length = 0;
    },
    flushForTest: () => {
      const pending = callbacks.shift();
      pending?.(0);
      return pending !== undefined;
    },
    pendingCount: () => callbacks.length,
  };
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

  const engine = new ICE3({
    backend: new FakeRendererBackend(),
    scheduler,
  }).init(host);
  engine.setScene(new ICEScene({ id: 'scene' }));
  engine.setCamera(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 45,
      near: 0.1,
      far: 100,
      position: [0, 0, 5],
      target: [0, 0, 0],
    }),
  );
  engine.start();
  scheduler.flushForTest();

  expect(engine.project([0, 0, 0])).toMatchObject({
    x: 320,
    y: 180,
    visible: true,
  });
  engine.destroy();
});

it('picks the visible box through the public semantic API', async () => {
  const scheduler: ICERenderScheduler = {
    request: () => 1,
    cancelAll: () => {},
    flushForTest: () => false,
    pendingCount: () => 0,
  };
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

  const engine = new ICE3({ backend: new FakeRendererBackend(), scheduler }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(
    new ICEMesh({
      id: 'block',
      geometry: new ICEBoxGeometry({ width: 2, height: 2, depth: 2 }),
      material: new ICEBasicMaterial({ color: '#2f81f7' }),
    }),
  );
  engine.setScene(scene);
  engine.setCamera(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 45,
      near: 0.1,
      far: 100,
      position: [0, 0, 5],
      target: [0, 0, 0],
    }),
  );

  expect((await engine.pick({ x: 320, y: 180 }))?.id).toBe('block');
  expect(await engine.pick({ x: 1, y: 1 })).toBeUndefined();
  engine.destroy();
});

it('uses node scale when calculating the pick volume', async () => {
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

  const engine = new ICE3({
    backend: new FakeRendererBackend(),
    scheduler: {
      request: () => 1,
      cancelAll: () => {},
      flushForTest: () => false,
      pendingCount: () => 0,
    },
  }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(
    new ICEMesh({
      id: 'small-block',
      scale: [0.2, 0.2, 0.2],
      geometry: new ICEBoxGeometry({ width: 2, height: 2, depth: 2 }),
      material: new ICEBasicMaterial({ color: '#2f81f7' }),
    }),
  );
  engine.setScene(scene);
  engine.setCamera(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 45,
      near: 0.1,
      far: 100,
      position: [0, 0, 5],
      target: [0, 0, 0],
    }),
  );

  const center = engine.project([0, 0, 0]);
  const outside = engine.project([0.8, 0, 0]);
  expect((await engine.pick({ x: center.x, y: center.y }))?.id).toBe('small-block');
  expect(await engine.pick({ x: outside.x, y: outside.y })).toBeUndefined();
  engine.destroy();
});

it('picks the nearest object across differently scaled nodes', async () => {
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
  const engine = new ICE3({
    backend: new FakeRendererBackend(),
    scheduler: {
      request: () => 1,
      cancelAll: () => {},
      flushForTest: () => false,
      pendingCount: () => 0,
    },
  }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  const geometry = new ICEBoxGeometry({ width: 2, height: 2, depth: 2 });
  const material = new ICEBasicMaterial({ color: '#2f81f7' });
  scene.addChild(
    new ICEMesh({
      id: 'far-large',
      position: [0, 0, -2],
      scale: [2, 2, 2],
      geometry,
      material,
    }),
  );
  scene.addChild(
    new ICEMesh({
      id: 'near-small',
      position: [0, 0, 2],
      scale: [0.2, 0.2, 0.2],
      geometry,
      material,
    }),
  );
  engine.setScene(scene);
  engine.setCamera(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 45,
      near: 0.1,
      far: 100,
      position: [0, 0, 5],
      target: [0, 0, 0],
    }),
  );

  expect((await engine.pick({ x: 320, y: 180 }))?.id).toBe('near-small');
  engine.destroy();
});

it('resizes its internal viewport when the window size changes', async () => {
  const host = document.createElement('div');
  let width = 640;
  let height = 360;
  Object.defineProperty(host, 'clientWidth', { get: () => width });
  Object.defineProperty(host, 'clientHeight', { get: () => height });
  host.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const engine = new ICE3({
    backend: new FakeRendererBackend(),
    scheduler: {
      request: () => 1,
      cancelAll: () => {},
      flushForTest: () => false,
      pendingCount: () => 0,
    },
  }).init(host);

  width = 800;
  height = 400;
  window.dispatchEvent(new Event('resize'));

  expect(engine.getDiagnostics().viewport).toMatchObject({ width: 800, height: 400 });
  engine.destroy();
});
