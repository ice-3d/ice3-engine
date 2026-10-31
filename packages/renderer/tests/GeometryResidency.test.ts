import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEIndexedGeometry } from '@ice3/core';
import { WebGL2GeometryCache } from '../src/WebGL2GeometryCache';
import { WebGPUGeometryCache } from '../src/WebGPUGeometryCache';
import { fakeWebGPUDevice } from './fake-webgpu';

it('does not upload or recreate buffers for a transform-only revision', () => {
  const { device } = fakeWebGPUDevice();
  const cache = new WebGPUGeometryCache({ device });
  const first = triangleGeometry('shared', 1);
  cache.pin(first);
  const before = cache.uploadCount;
  const revision = new ICEIndexedGeometry({
    id: first.id,
    positions: first.positions,
    indices: first.indices,
  });

  cache.pin(revision);

  expect(cache.uploadCount).toBe(before);
  expect(cache.updateBytes).toBe(0);
});

it('updates only changed position ranges', () => {
  const cache = new WebGL2GeometryCache();
  const first = triangleGeometry('shared', 1);
  const revision = triangleGeometry('shared', 2);
  const gl = fakeWebGL2();
  cache.pin(gl, first);
  const before = cache.updateBytes;

  cache.pin(gl, revision, {
    positionRanges: [{ byteOffset: 12, byteLength: 12 }],
  });

  expect(cache.updateBytes - before).toBe(12);
  expect(cache.uploadCount).toBe(1);
});

it('keeps the previous generation when a partial write fails', () => {
  const cache = new WebGL2GeometryCache();
  const first = triangleGeometry('shared', 1);
  const revision = triangleGeometry('shared', 2);
  cache.pin(fakeWebGL2(), first);

  expect(() => cache.pin(failingWebGL2(), revision, {
    positionRanges: [{ byteOffset: 12, byteLength: 12 }],
  })).toThrow(/ICE3_GPU_RESOURCE_FAILED/);
  expect(cache.retain(fakeWebGL2(), first).attributeDigest).toBe(
    first.identity?.attributeDigest,
  );
});

it('keys topology-preserving updates by stable geometry identity', () => {
  const { device } = fakeWebGPUDevice();
  const cache = new WebGPUGeometryCache({ device });
  const first = triangleGeometry('shared', 1, true);
  const revision = triangleGeometry('shared', 2, true);
  cache.pin(first);
  const before = cache.uploadCount;

  cache.pin(revision, {
    positionRanges: [{ byteOffset: 12, byteLength: 12 }],
  });

  expect(cache.uploadCount).toBe(before);
  expect(cache.updateBytes).toBe(12);
});

function triangleGeometry(
  id: string,
  offset: number,
  identity = false,
): ICEIndexedGeometry {
  return new ICEIndexedGeometry({
    id,
    positions: new Float32Array([0, 0, 0, offset, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    ...(identity
      ? {
        identity: {
          geometryId: 'component/body',
          topologyDigest: 'b'.repeat(64),
          attributeDigest: `${offset}`.padStart(64, '0'),
        },
      }
      : {}),
  });
}

function fakeWebGL2(failUpdate = false): WebGL2RenderingContext {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    UNSIGNED_INT: 0x1405,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    deleteVertexArray: () => undefined,
    deleteBuffer: () => undefined,
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    bufferSubData: () => {
      if (failUpdate) {
        throw new Error('partial write failed');
      }
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
  } as unknown as WebGL2RenderingContext;
}

function failingWebGL2(): WebGL2RenderingContext {
  return fakeWebGL2(true);
}
