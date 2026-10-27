// @node-test-environment jsdom

import { expect, it } from 'node-test';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
  ICEPerspectiveCamera,
  ICEScene,
  type ICERenderScheduler,
} from '../src/index';

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

it('starts idempotently and destroys resources once', () => {
  const backend = new FakeRendererBackend();
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

  const engine = new ICE3({ backend, scheduler }).init(createHost());
  engine.setScene(new ICEScene({ id: 'scene' }));
  engine.setCamera(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 45,
      near: 0.1,
      far: 100,
      position: [0, 2, 5],
      target: [0, 0, 0],
    }),
  );

  engine.start().start();
  expect(scheduler.pendingCount()).toBe(1);
  scheduler.flushForTest();
  expect(backend.frames).toHaveLength(1);

  engine.destroy();
  engine.destroy();
  expect(backend.disposeCount).toBe(1);
  expect(scheduler.pendingCount()).toBe(0);
});

it('does not render before a scene and camera are configured', () => {
  const backend = new FakeRendererBackend();
  const engine = new ICE3({ backend }).init(createHost());

  engine.start().requestRender();

  expect(engine.getDiagnostics().lastDiagnostic?.code).toBe('ICE3_ENGINE_NOT_READY');
  expect(backend.frames).toHaveLength(0);
  engine.destroy();
});

it('removes generated canvases when backend initialization fails', () => {
  const host = createHost();
  const backend = new FakeRendererBackend();
  backend.initialize = () => {
    throw new Error('backend failed');
  };
  const engine = new ICE3({ backend });

  expect(() => engine.init(host)).toThrowError('backend failed');
  expect(host.children).toHaveLength(0);
  expect(engine.getDiagnostics().canvas).toEqual({ width: 0, height: 0 });
});

it('waits for context restoration before rendering', () => {
  const backend = new FakeRendererBackend();
  let loseContext: (() => void) | undefined;
  let restoreContext: (() => void) | undefined;
  backend.initialize = (options) => {
    loseContext = options.onContextLost;
    restoreContext = options.onContextRestored;
  };
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
  const engine = new ICE3({ backend, scheduler }).init(createHost());
  engine.setScene(new ICEScene({ id: 'scene' })).setCamera(
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

  loseContext?.();
  scheduler.flushForTest();
  expect(backend.frames).toHaveLength(0);

  restoreContext?.();
  scheduler.flushForTest();
  expect(backend.frames).toHaveLength(1);
  engine.destroy();
});
