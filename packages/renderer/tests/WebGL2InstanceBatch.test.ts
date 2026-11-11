import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
} from '@ice3/core';
import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  collectInstanceBatches,
  renderablesOutsideInstanceBatches,
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

test('meshes outside any instance batch stay on the individual draw path', () => {
  const shared = new ICEIndexedGeometry({
    id: 'shared-device',
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const unique = new ICEIndexedGeometry({
    id: 'unique-tank',
    positions: new Float32Array([
      0, 0, 0,
      2, 0, 0,
      0, 2, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const renderable = (id: string, geometry: ICEIndexedGeometry): ICEGeometryRenderable => {
    const mesh = new ICEMesh({
      id,
      selectionId: `selection-${id}`,
      geometry,
      material,
    });
    return { id: mesh.id, mesh, worldMatrix: mesh.updateWorldMatrix().elements };
  };
  const renderables = [
    renderable('device-a', shared),
    renderable('device-b', shared),
    renderable('tank', unique),
  ];

  const batches = collectInstanceBatches(renderables);
  // 实例化只收出现两次以上的组合，落单的 tank 不在任何批次里。
  expect(batches).toHaveLength(1);
  expect(batches[0]!.meshIds).toEqual(['device-a', 'device-b']);

  // 深度通道靠这个函数补齐第三条路径；漏掉就等于那些网格没有接触阴影。
  const standalone = renderablesOutsideInstanceBatches(renderables, batches);
  expect(standalone.map((entry) => entry.id)).toEqual(['tank']);
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
    instanceOpacity: new Float32Array(semanticIds.length).fill(1),
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
  // The per-instance opacity buffer is part of the batch's GPU footprint.
  expect(cache.totalBytes).toBe(2 * 16 * 4 + 2 * 4 + 2 * 4);
});

test('skips all uploads when an instance batch is unchanged', () => {
  const geometry = triangleGeometry('cache-static');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  const batch = instanceBatch(geometry, material, [0, 4]);

  cache.retain(gl, fakeGeometryCache(geometry), batch);
  const afterFirst = calls.length;
  cache.beginFrame();
  cache.retain(gl, fakeGeometryCache(geometry), batch);

  expect(calls.length).toBe(afterFirst);
  expect(cache.uploadStats.skippedBatches).toBe(1);
  expect(cache.uploadStats.bytes).toBe(0);
});

test('uploads only the changed matrix span', () => {
  const geometry = triangleGeometry('cache-range');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  const first = instanceBatch(geometry, material, [0, 4, 8]);
  const second = instanceBatch(geometry, material, [0, 4, 8]);
  second.instanceMatrices[17] = 3;

  cache.retain(gl, fakeGeometryCache(geometry), first);
  cache.beginFrame();
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), second);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 17 * 4,
    bytes: 4,
  }]);
  expect(cache.uploadStats.bytes).toBe(4);
});

test('full uploads when the instance count changes', () => {
  const geometry = triangleGeometry('cache-resize');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(gl, fakeGeometryCache(geometry), instanceBatch(geometry, material, [0, 4]));
  cache.beginFrame();
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), instanceBatch(geometry, material, [0]));

  expect(calls.some((call) => call.kind === 'data')).toBe(true);
  expect(cache.uploadStats.fullUploads).toBe(1);
});

test('uploads only opacity when opacity changes', () => {
  const geometry = triangleGeometry('cache-opacity');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(
    gl,
    fakeGeometryCache(geometry),
    instanceBatch(geometry, material, [0, 4]),
  );
  const changed = instanceBatch(geometry, material, [0, 4]);
  changed.instanceOpacity[1] = 0.5;
  cache.beginFrame();
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), changed);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 4,
    bytes: 4,
  }]);
});

test('uploads only semantic indices when selection changes', () => {
  const geometry = triangleGeometry('cache-semantic');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(
    gl,
    fakeGeometryCache(geometry),
    instanceBatch(geometry, material, [0, 4]),
  );
  const changed = instanceBatch(geometry, material, [0, 4]);
  changed.semanticIndices[1] = 9;
  cache.beginFrame();
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), changed);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 4,
    bytes: 4,
  }]);
});

type UploadCall =
  | { readonly kind: 'data'; readonly bytes: number }
  | {
    readonly kind: 'subdata';
    readonly byteOffset: number;
    readonly bytes: number;
  };

function recordingWebGL2(calls: UploadCall[]): WebGL2RenderingContext {
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
    bufferData: (_target, data) => {
      calls.push({
        kind: 'data',
        bytes: data.byteLength,
      });
    },
    bufferSubData: (_target, byteOffset, data) => {
      calls.push({
        kind: 'subdata',
        byteOffset,
        bytes: data.byteLength,
      });
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    vertexAttribDivisor: () => undefined,
  } as unknown as WebGL2RenderingContext;
}

function triangleGeometry(id: string): ICEIndexedGeometry {
  return new ICEIndexedGeometry({
    id,
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

function fakeGeometryCache(
  geometry: ICEIndexedGeometry,
): import('../src/WebGL2GeometryCache.js').WebGL2GeometryCache {
  return {
    retain: () => ({
      vertexArray: {} as WebGLVertexArrayObject,
      positionBuffer: {} as WebGLBuffer,
      triangleIndexBuffer: {} as WebGLBuffer,
      edgeIndexBuffer: null,
      colorBuffer: null,
      semanticBuffer: null,
      triangleCount: geometry.indices.length,
      edgeCount: 0,
      bytes: 0,
    }),
  } as unknown as import('../src/WebGL2GeometryCache.js').WebGL2GeometryCache;
}

function instanceBatch(
  geometry: ICEIndexedGeometry,
  material: ICEBasicMaterial,
  translations: readonly number[],
): ICEInstanceBatch {
  const instanceMatrices = new Float32Array(translations.length * 16);
  translations.forEach((translation, index) => {
    const offset = index * 16;
    instanceMatrices[offset] = 1;
    instanceMatrices[offset + 5] = 1;
    instanceMatrices[offset + 10] = 1;
    instanceMatrices[offset + 12] = translation;
    instanceMatrices[offset + 15] = 1;
  });
  return {
    id: `instance:${geometry.id}`,
    geometry,
    material,
    instanceMatrices,
    instanceOpacity: new Float32Array(translations.length).fill(1),
    semanticIds: translations.map((_value, index) => `selection-${index}`),
    semanticIndices: Uint32Array.from(
      { length: translations.length },
      (_value, index) => index,
    ),
    meshIds: translations.map((_value, index) => `mesh-${index}`),
    materialKey: material.color,
  };
}

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
