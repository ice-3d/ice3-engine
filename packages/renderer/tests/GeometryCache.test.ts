import { ICEIndexedGeometry } from '@ice3/core';
import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGL2GeometryCache } from '../src/WebGL2GeometryCache.js';

test('keeps pinned geometry across frames without uploading it again', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'pinned',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const gl = fakeWebGL2();
  const cache = new WebGL2GeometryCache({ inactiveGraceFrames: 0 });

  cache.pin(gl, geometry);
  cache.beginFrame();
  cache.endFrame();
  expect(cache.uploadCount).toBe(1);
  expect(cache.evictionCount).toBe(0);
  expect(cache.totalBytes).toBeGreaterThan(0);

  cache.unpin(geometry);
  cache.beginFrame();
  cache.endFrame();
  expect(cache.uploadCount).toBe(1);
  expect(cache.evictionCount).toBe(1);
  expect(cache.totalBytes).toBe(0);
});

test('retains recently inactive geometry for reuse', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'recent',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const gl = fakeWebGL2();
  const cache = new WebGL2GeometryCache({
    inactiveGraceFrames: 3,
    maxBytes: 1024 * 1024,
  });

  cache.retain(gl, geometry);
  cache.beginFrame();
  cache.endFrame();
  cache.beginFrame();
  cache.endFrame();
  expect(cache.evictionCount).toBe(0);
  expect(cache.retain(gl, geometry)).toBeDefined();
  expect(cache.uploadCount).toBe(1);

  cache.beginFrame();
  cache.endFrame();
  cache.beginFrame();
  cache.endFrame();
  cache.beginFrame();
  cache.endFrame();
  expect(cache.evictionCount).toBe(1);
  expect(cache.totalBytes).toBe(0);
});

test('rejects a pinned upload that exceeds the GPU geometry budget', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'oversized',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const cache = new WebGL2GeometryCache({
    inactiveGraceFrames: 0,
    maxBytes: 20,
  });

  expect(() => cache.pin(fakeWebGL2(), geometry))
    .toThrow(/ICE3_GPU_RESOURCE_FAILED/);
  expect(cache.totalBytes).toBe(0);
});

function fakeWebGL2(): WebGL2RenderingContext {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    UNSIGNED_INT: 0x1405,
    STATIC_DRAW: 0x88e4,
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    deleteVertexArray: () => undefined,
    deleteBuffer: () => undefined,
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
  } as unknown as WebGL2RenderingContext;
}
