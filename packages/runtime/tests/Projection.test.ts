// @node-test-environment jsdom

import { expect, it } from 'node-test';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
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
