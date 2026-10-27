import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEIndexedGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { expect, it } from 'node-test';
import { collectRenderables } from '../src/WebGL2BoxBatch';

it('collects visible box and indexed geometry meshes with stable IDs', () => {
  const geometry = new ICEBoxGeometry({ width: 2, height: 3, depth: 4 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const scene = new ICEScene({ id: 'scene' });

  scene.addChild(new ICEMesh({ id: 'a', geometry, material }));
  scene.addChild(new ICEMesh({
    id: 'indexed',
    geometry: new ICEIndexedGeometry({
      id: 'indexed-geometry',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    }),
    material,
  }));
  const hidden = new ICEMesh({ id: 'hidden', geometry, material });
  hidden.visible = false;
  scene.addChild(hidden);

  expect(collectRenderables(scene).map((item) => item.id)).toEqual([
    'a',
    'indexed',
  ]);
});
