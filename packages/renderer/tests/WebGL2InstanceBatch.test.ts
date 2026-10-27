import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
} from '@ice3/core';
import { expect, test } from 'node-test';
import {
  collectInstanceBatches,
  type ICEGeometryRenderable,
  type ICEInstanceBatch,
  WebGL2InstanceCache,
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

test('updates the cached instance count when a group changes size', () => {
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
  const gl = fakeWebGL2();
  const geometryEntry = {
    vertexArray: {} as WebGLVertexArrayObject,
    positionBuffer: {} as WebGLBuffer,
    triangleIndexBuffer: {} as WebGLBuffer,
    edgeIndexBuffer: null,
    colorBuffer: null,
    semanticBuffer: null,
    triangleCount: 3,
    edgeCount: 0,
    bytes: 0,
  };
  const geometryCache = {
    retain: () => geometryEntry,
  } as unknown as import('../src/WebGL2GeometryCache.js').WebGL2GeometryCache;
  const cache = new WebGL2InstanceCache();
  const batch = (
    semanticIds: readonly string[],
  ): ICEInstanceBatch => ({
    id: 'instance:device-0',
    geometry,
    material,
    instanceMatrices: new Float32Array(semanticIds.length * 16),
    semanticIds,
    semanticIndices: Uint32Array.from(
      { length: semanticIds.length },
      (_value, index) => index,
    ),
    meshIds: semanticIds.map((id) => `mesh:${id}`),
    materialKey: '#ffb000:',
  });

  expect(cache.retain(gl, geometryCache, batch([
    'device-0',
    'device-1',
    'device-2',
    'device-3',
  ]))?.instanceCount).toBe(4);
  expect(cache.retain(gl, geometryCache, batch([
    'device-0',
    'device-1',
  ]))?.instanceCount).toBe(2);
});

function fakeWebGL2(): WebGL2RenderingContext {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    UNSIGNED_INT: 0x1405,
    DYNAMIC_DRAW: 0x88e8,
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    deleteVertexArray: () => undefined,
    deleteBuffer: () => undefined,
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    vertexAttribDivisor: () => undefined,
  } as unknown as WebGL2RenderingContext;
}
