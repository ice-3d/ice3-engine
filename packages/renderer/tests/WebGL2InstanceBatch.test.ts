import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
} from '@ice3/core';
import { expect, test } from 'node-test';
import {
  collectInstanceBatches,
  type ICEGeometryRenderable,
} from '../src/WebGL2InstanceBatch.js';

test('collects repeated shared geometry into one instance batch', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'shared-device',
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const renderables: ICEGeometryRenderable[] = [0, 1, 2, 3].map((index) => {
    const mesh = new ICEMesh({
      id: `device-${index}`,
      selectionId: `selection-${index}`,
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        index * 10, 0, 0, 1,
      ],
      geometry,
      material,
    });
    return {
      id: mesh.id,
      mesh,
      worldMatrix: mesh.updateWorldMatrix().elements,
    };
  });

  const batches = collectInstanceBatches(renderables);

  expect(batches).toHaveLength(1);
  expect(batches[0]!.geometry).toBe(geometry);
  expect(batches[0]!.material).toBe(material);
  expect(batches[0]!.instanceMatrices).toHaveLength(64);
  expect([...batches[0]!.semanticIds]).toEqual([
    'selection-0',
    'selection-1',
    'selection-2',
    'selection-3',
  ]);
  expect(batches[0]!.instanceMatrices[12]).toBe(0);
  expect(batches[0]!.instanceMatrices[28]).toBe(10);
  expect(batches[0]!.instanceMatrices[44]).toBe(20);
  expect(batches[0]!.instanceMatrices[60]).toBe(30);
});
