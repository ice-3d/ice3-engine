import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  buildSelectionMask,
  WebGPUSelectionMaskBuffer,
} from '../src/WebGPUSelectionMask';
import { fakeWebGPUDevice } from './fake-webgpu';

it('maps multiple semantic ranges without selected-object draws', () => {
  const result = buildSelectionMask(
    [['pump-a', 'pump-b'], ['valve', 'tank']],
    ['tank', 'pump-b', 'pump-b'],
  );
  expect(result.bases).toEqual([0, 2]);
  expect([...result.words]).toEqual([0, 1, 0, 1]);
});

it('returns one aligned word for an empty selection', () => {
  const result = buildSelectionMask([[]], []);
  expect(result.bases).toEqual([0]);
  expect(result.words.byteLength).toBe(4);
});

it('writes changed mask words and reuses the buffer', () => {
  const fake = fakeWebGPUDevice();
  const mask = new WebGPUSelectionMaskBuffer(fake.device);
  mask.update(new Uint32Array([0, 1]));
  const generation = mask.generation;
  mask.update(new Uint32Array([0, 1]));
  expect(fake.writes).toHaveLength(1);
  mask.update(new Uint32Array([1, 1]));
  expect(fake.writes).toHaveLength(2);
  expect(mask.generation).toBe(generation);
  mask.dispose();
  expect(mask.buffer).toBeNull();
});
