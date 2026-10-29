import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { probeWebGPU } from '../src/index';
import { fakeWebGPUEnvironment } from './fake-webgpu';

it('reports api-unavailable without navigator.gpu', async () => {
  await expect(probeWebGPU({ gpu: undefined })).resolves.toMatchObject({
    supported: false,
    reason: 'api-unavailable',
  });
});

it('reports adapter-unavailable for a null adapter', async () => {
  const fake = fakeWebGPUEnvironment({ adapter: null });
  await expect(probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  })).resolves.toMatchObject({
    supported: false,
    reason: 'adapter-unavailable',
  });
});

it('reports adapter-timeout when adapter lookup does not settle', async () => {
  const gpu = {
    requestAdapter: () => new Promise(() => {}),
    getPreferredCanvasFormat: () => 'bgra8unorm',
  } as unknown as GPU;
  await expect(probeWebGPU({
    gpu,
    timeoutMs: 5,
  })).resolves.toMatchObject({
    supported: false,
    reason: 'adapter-timeout',
  });
});

it('rejects an adapter below the ICE3 buffer limit', async () => {
  const fake = fakeWebGPUEnvironment({
    adapterLimits: { maxBufferSize: 1024 },
  });
  await expect(probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  })).resolves.toMatchObject({
    supported: false,
    reason: 'limit-too-low',
  });
});

it('reports device-failed when requestDevice rejects', async () => {
  const fake = fakeWebGPUEnvironment({ deviceRequestFails: true });
  await expect(probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  })).resolves.toMatchObject({
    supported: false,
    reason: 'device-failed',
  });
});

it('reports context-failed when the test canvas has no WebGPU context', async () => {
  const fake = fakeWebGPUEnvironment({ contextAvailable: false });
  const result = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  expect(result).toMatchObject({
    supported: false,
    reason: 'context-failed',
  });
  expect(fake.destroyCount()).toBe(1);
});

it('reports a failed pipeline request', async () => {
  const fake = fakeWebGPUEnvironment({ pipelineFails: true });
  const result = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  expect(result).toMatchObject({
    supported: false,
    reason: 'pipeline-failed',
  });
  expect(fake.destroyCount()).toBe(1);
});

it('reports device-lost when the device is lost during the probe', async () => {
  const fake = fakeWebGPUEnvironment({ deviceLost: true });
  await expect(probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  })).resolves.toMatchObject({
    supported: false,
    reason: 'device-lost',
  });
});

it('returns the probed devices and caches success for the same GPU', async () => {
  const fake = fakeWebGPUEnvironment();
  const first = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  const second = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  expect(first).toMatchObject({
    supported: true,
    adapter: fake.adapter,
    device: fake.device,
    format: 'bgra8unorm',
  });
  expect(second).toBe(first);
  expect(fake.adapterRequestCount()).toBe(1);
  expect(fake.destroyCount()).toBe(0);
});

it('invalidates a cached probe when its consumer releases it', async () => {
  const fake = fakeWebGPUEnvironment();
  const first = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  if (!first.supported) throw new Error('expected supported probe');
  first.release();
  await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  expect(fake.adapterRequestCount()).toBe(2);
});

it('requests only optional features advertised by the adapter', async () => {
  const fake = fakeWebGPUEnvironment({
    adapterFeatures: ['timestamp-query'],
  });
  const result = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
    optionalFeatures: ['timestamp-query', 'depth-clip-control'],
  });

  expect(fake.deviceRequests[0]).toMatchObject({
    requiredFeatures: ['timestamp-query'],
  });
  expect(result.supported ? result.enabledFeatures.has('timestamp-query') : false)
    .toBe(true);
});

it('does not reuse a probe created without optional features', async () => {
  const fake = fakeWebGPUEnvironment({
    adapterFeatures: ['timestamp-query'],
  });
  await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
  });
  const result = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: () => fake.canvas,
    optionalFeatures: ['timestamp-query'],
  });

  expect(fake.adapterRequestCount()).toBe(2);
  expect(result.supported ? result.enabledFeatures.has('timestamp-query') : false)
    .toBe(true);
});
