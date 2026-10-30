import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { WebGPURenderPlanCache } from '../src/WebGPURenderPlan';

it('reuses a plan until scene revision changes', () => {
  const scene = new ICEScene({ id: 'scene' });
  const cache = new WebGPURenderPlanCache();
  const first = cache.get(scene);
  expect(cache.get(scene)).toBe(first);

  scene.addChild(new ICEMesh({
    id: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));
  const second = cache.get(scene);

  expect(second).not.toBe(first);
  expect(second.revision).toBe(scene.revision);
  expect(second.renderables).toHaveLength(1);
});

it('invalidates for visibility and local transform changes', () => {
  const scene = new ICEScene({ id: 'scene' });
  const mesh = new ICEMesh({
    id: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  });
  scene.addChild(mesh);
  const cache = new WebGPURenderPlanCache();
  const visiblePlan = cache.get(scene);

  mesh.visible = false;
  const hiddenPlan = cache.get(scene);
  mesh.setLocalMatrix([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    2, 0, 0, 1,
  ]);
  const transformedPlan = cache.get(scene);

  expect(hiddenPlan).not.toBe(visiblePlan);
  expect(hiddenPlan.renderables).toHaveLength(0);
  expect(transformedPlan).not.toBe(hiddenPlan);
});
