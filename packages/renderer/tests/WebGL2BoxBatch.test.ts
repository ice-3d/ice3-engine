import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { expect, it } from 'node-test';
import { collectRenderables } from '../src/WebGL2BoxBatch';

it('collects only visible boxes with stable IDs', () => {
  const geometry = new ICEBoxGeometry({ width: 2, height: 3, depth: 4 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const scene = new ICEScene({ id: 'scene' });

  scene.addChild(new ICEMesh({ id: 'a', geometry, material }));
  const hidden = new ICEMesh({ id: 'hidden', geometry, material });
  hidden.visible = false;
  scene.addChild(hidden);

  expect(collectRenderables(scene).map((item) => item.id)).toEqual(['a']);
});
