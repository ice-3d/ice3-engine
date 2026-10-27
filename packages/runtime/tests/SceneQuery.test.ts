import { expect, test } from 'node-test';
import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { collectSceneItems } from '../src/query/ICESceneQuery';

test('deduplicates coarse and fine representations by selection identity', () => {
  const scene = new ICEScene({ id: 'scene' });
  const geometry = new ICEIndexedGeometry({
    id: 'geometry',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  });
  const material = new ICEBasicMaterial({ color: '#fff' });
  const coarse = new ICEMesh({
    id: 'coarse',
    selectionId: 'device-1',
    geometry,
    material,
  });
  const fine = new ICEMesh({
    id: 'fine',
    selectionId: 'device-1',
    geometry,
    material,
  });
  coarse.addChild(fine);
  scene.addChild(coarse);

  const items = collectSceneItems(scene);
  expect(items).toHaveLength(1);
  expect(items[0]!.nodeId).toBe('fine');
});
