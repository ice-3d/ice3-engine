import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEIndexedGeometry } from '@ice3/core';
import { WebGPUGeometryCache } from '../src/index';
import { fakeWebGPUDevice } from './fake-webgpu';

it('uploads position and color into one aligned vertex buffer', () => {
  const { device, buffers, writes } = fakeWebGPUDevice();
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  });
  const cache = new WebGPUGeometryCache({ device });

  const entry = cache.retain(geometry);

  expect(entry.vertexCount).toBe(3);
  expect(entry.indexFormat).toBe('uint16');
  expect(buffers[0]?.size).toBe(72);
  expect(buffers[1]?.size).toBe(8);
  expect(new Float32Array(writes[0]!.data.buffer))
    .toEqual(new Float32Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 0, 1, 0,
      0, 1, 0, 0, 0, 1,
    ]));
  cache.dispose();
  expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
});

it('evicts an inactive unpinned entry without destroying a pinned entry', () => {
  const { device, buffers } = fakeWebGPUDevice();
  const cache = new WebGPUGeometryCache({
    device,
    maxBytes: 100,
    inactiveGraceFrames: 0,
  });
  const first = new ICEIndexedGeometry({
    id: 'first',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const second = new ICEIndexedGeometry({
    id: 'second',
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });

  cache.pin(first);
  cache.beginFrame();
  cache.retain(second);
  cache.endFrame();

  expect(buffers[0]?.destroyed).toBe(false);
  expect(buffers[1]?.destroyed).toBe(false);
  expect(buffers[2]?.destroyed).toBe(true);
  expect(cache.totalBytes).toBe(80);
});
