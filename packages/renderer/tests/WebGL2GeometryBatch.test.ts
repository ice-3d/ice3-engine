import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEIndexedGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { expect, it } from 'node-test';
import {
  collectRenderables,
  selectionIdentity,
} from '../src/WebGL2GeometryBatch';

it('collects visible box and indexed geometry meshes with stable IDs', () => {
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'box',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material,
  }));
  scene.addChild(new ICEMesh({
    id: 'indexed',
    geometry: new ICEIndexedGeometry({
      id: 'indexed-geometry',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    }),
    material,
  }));

  expect(collectRenderables(scene).map((item) => item.id)).toEqual([
    'box',
    'indexed',
  ]);
});

it('uses the declared equipment identity for rendering selection', () => {
  const mesh = new ICEMesh({
    id: 'motor-7/primitive/1',
    selectionId: 'motor-7',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  });
  expect(selectionIdentity(mesh)).toBe('motor-7');
});
