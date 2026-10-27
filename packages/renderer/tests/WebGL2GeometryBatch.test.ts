import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEScene,
} from '@ice3/core';
import { expect, it } from 'node-test';
import {
  collectRenderables,
  collectRenderBatches,
  selectionIdentity,
  semanticSelectionId,
  type ICEGeometryRenderable,
} from '../src/WebGL2GeometryBatch';

class TestBatchNode extends ICENode {
  override get typeId(): string {
    return 'ice3:RenderBatch';
  }

  constructor(id: string) {
    super({ id });
  }

  readonly geometry = new ICEIndexedGeometry({
    id: 'batch-geometry',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  readonly material = new ICEBasicMaterial({ color: '#ffffff' });
  readonly semanticIds = ['semantic:0'];
  readonly semanticNodeIds = ['node:0'];
  readonly semanticSelectionIds = ['device:0'];
  readonly materialKey = '0';
}

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

it('reuses each node world matrix without a per-frame copy', () => {
  const mesh = new ICEMesh({
    id: 'box',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  });
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(mesh);

  const renderable = collectRenderables(scene)[0]!;

  expect(renderable.worldMatrix).toBe(mesh.updateWorldMatrix().elements);
});

it('reuses a caller-provided renderable buffer', () => {
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'box',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));
  const output: ICEGeometryRenderable[] = [];

  expect(collectRenderables(scene, output)).toBe(output);
  expect(output).toHaveLength(1);
});

it('collects visible render batches without traversing device meshes', () => {
  const batch = new TestBatchNode('batch');
  const hidden = new TestBatchNode('hidden-batch');
  hidden.visible = false;
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(batch);
  scene.addChild(hidden);

  expect(collectRenderBatches(scene).map((draw) => draw.id))
    .toEqual(['batch']);
});

it('maps batch semantic indices back to device selection identities', () => {
  const batch = new TestBatchNode('batch');

  expect(semanticSelectionId(batch, 0)).toBe('device:0');
  expect(semanticSelectionId(batch, 1)).toBeUndefined();
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
