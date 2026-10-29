import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { collectRenderables } from '../src/Renderables';
import { collectInstanceBatches } from '../src/InstanceBatch';

it('collects renderables and instances without a graphics API', () => {
  const scene = new ICEScene({ id: 'scene' });
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  scene.addChild(new ICEMesh({ id: 'a', geometry, material }));
  scene.addChild(new ICEMesh({
    id: 'b',
    geometry,
    material,
    position: [2, 0, 0],
  }));

  const renderables = collectRenderables(scene);
  const instances = collectInstanceBatches(renderables);

  expect(renderables.map((item) => item.id)).toEqual(['a', 'b']);
  expect(instances).toHaveLength(1);
  expect(instances[0]?.meshIds).toEqual(['a', 'b']);
});
