import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUTimestampProfiler } from '../src/WebGPUTimestampProfiler';
import { fakeWebGPUDevice } from './fake-webgpu';

it('returns a two-millisecond GPU duration', async () => {
  const fake = fakeWebGPUDevice();
  fake.setTimestampValues([1_000_000_000, 1_002_000_000]);
  const profiler = new WebGPUTimestampProfiler(fake.device, 4);
  const encoder = fake.device.createCommandEncoder();
  profiler.resolveFrame(encoder, 1);
  expect(await profiler.drain()).toEqual([2]);
  profiler.dispose();
  expect(fake.querySets[0]?.destroyed).toBe(true);
});

it('rejects zero and backwards durations', async () => {
  const fake = fakeWebGPUDevice();
  fake.setTimestampValues([1_000_000_000, 1_000_000_000]);
  const profiler = new WebGPUTimestampProfiler(fake.device, 2);
  profiler.resolveFrame(fake.device.createCommandEncoder(), 1);
  expect(await profiler.drain()).toEqual([]);
  expect(profiler.unavailableReason).toBe('invalid-timestamp');
});

it('never overwrites an unresolved ring slot', () => {
  const fake = fakeWebGPUDevice();
  const profiler = new WebGPUTimestampProfiler(fake.device, 1);
  profiler.resolveFrame(fake.device.createCommandEncoder(), 1);
  expect(() => (
    profiler.resolveFrame(fake.device.createCommandEncoder(), 2)
  )).toThrowError(/ICE3_TIMESTAMP_SLOT_BUSY/);
});

it('reports a map failure without inventing a duration', async () => {
  const fake = fakeWebGPUDevice({ timestampMapFails: true });
  const profiler = new WebGPUTimestampProfiler(fake.device, 2);
  profiler.resolveFrame(fake.device.createCommandEncoder(), 1);
  expect(await profiler.drain()).toEqual([]);
  expect(profiler.unavailableReason).toBe('map-failed');
});
