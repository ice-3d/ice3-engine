import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { FakeRendererBackend } from '@ice3/renderer';
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEPerspectiveCamera,
  ICERenderBatch,
  ICEScene,
} from '../src/index';

it('maps a batched semantic selection back to its render batch', () => {
  const backend = new FakeRendererBackend({ picking: true });
  backend.pickResult = 'equipment/pump-1';
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 640 });
  Object.defineProperty(host, 'clientHeight', { value: 360 });
  host.getBoundingClientRect = () => ({
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
    backend,
    scheduler: {
      request: () => 1,
      cancelAll: () => {},
      flushForTest: () => false,
      pendingCount: () => 0,
    },
  }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  const batch = new ICERenderBatch({
    id: 'batch-1',
    geometry: new ICEBoxGeometry({ width: 2, height: 2, depth: 2 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
    semanticIds: ['equipment/pump-1'],
    semanticNodeIds: ['equipment-node-1'],
    semanticSelectionIds: ['equipment/pump-1'],
    materialKey: 'metal',
  });
  scene.addChild(batch);
  engine.setScene(scene);
  engine.setCamera(new ICEPerspectiveCamera({
    id: 'camera',
    fov: 45,
    near: 0.1,
    far: 100,
    position: [0, 0, 5],
    target: [0, 0, 0],
  }));

  expect(engine.pick({ x: 320, y: 180 })).toBe(batch);
  expect(engine.getDiagnostics().lastPickId).toBe('equipment/pump-1');
  engine.destroy();
});
