import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import * as mockApi from '../../../tests/test-mocks.ts';
import {
  ICEAdaptiveRenderBatchController,
  type ICEAdaptiveBatchExecutionResult,
} from '../src/batching/ICEAdaptiveRenderBatchController.js';
import type { ICERenderBatchPlan } from '../src/batching/ICERenderBatchPlan.js';

const acceptedPlan: ICERenderBatchPlan = {
  generation: 2,
  sourceBatchIds: ['batch:0', 'batch:1'],
  estimatedDrawCallsSaved: 1,
  estimatedBytes: 1024,
  estimatedGainMs: 4,
  estimatedCostMs: 1,
  accepted: true,
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const controller = (
  result: ICEAdaptiveBatchExecutionResult = {
    kind: 'completed',
    estimatedBytes: 1024,
  },
) => {
  const diagnostics: string[] = [];
  const execute = mockApi.fn(async () => result);
  return {
    controller: new ICEAdaptiveRenderBatchController({
      mode: 'adaptive',
      activeGeneration: 1,
      maxExtraGpuBytes: 2048,
      execute,
      onDiagnostic: (code) => diagnostics.push(code),
    }),
    diagnostics,
    execute,
  };
};

test('defers while the camera is moving and starts when stable', () => {
  const setup = controller();

  expect(setup.controller.request({
    cameraMoving: true,
    generation: 2,
    plan: acceptedPlan,
  })).toEqual({ kind: 'deferred' });
  expect(setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  })).toEqual({ kind: 'started', generation: 2 });
  expect(setup.execute).toHaveBeenCalledTimes(1);
});

test('cancellation preserves the active generation', () => {
  const setup = controller();
  setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  });

  setup.controller.cancel(2);

  expect(setup.controller.activeGeneration).toBe(1);
  expect(setup.diagnostics).toContain('ICE3_RENDER_BATCH_ADAPTIVE_CANCELLED');
});

test('worker failure leaves the active generation unchanged', async () => {
  const setup = controller({ kind: 'failed', reason: 'worker', error: 'lost' });
  setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  });
  await flush();

  expect(setup.controller.activeGeneration).toBe(1);
  expect(setup.diagnostics).toContain('ICE3_RENDER_BATCH_ADAPTIVE_FAILED');
});

test('upload failure leaves the active generation unchanged', async () => {
  const setup = controller({ kind: 'failed', reason: 'upload', error: 'gpu' });
  setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  });
  await flush();

  expect(setup.controller.activeGeneration).toBe(1);
  expect(setup.diagnostics).toContain('ICE3_RENDER_BATCH_ADAPTIVE_FAILED');
});

test('memory rejection never starts a worker', () => {
  const setup = controller();
  const plan = { ...acceptedPlan, estimatedBytes: 4096 };

  expect(setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan,
  })).toEqual({ kind: 'rejected', reason: 'memory' });
  expect(setup.execute).not.toHaveBeenCalled();
  expect(setup.diagnostics).toContain('ICE3_RENDER_BATCH_MEMORY_REJECTED');
});

test('adaptive mode disabled bypasses planning and execution', () => {
  const execute = mockApi.fn(async (): Promise<ICEAdaptiveBatchExecutionResult> => ({
    kind: 'completed',
    estimatedBytes: 0,
  }));
  const value = new ICEAdaptiveRenderBatchController({
    mode: 'asset',
    activeGeneration: 1,
    execute,
  });

  expect(value.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  })).toEqual({ kind: 'disabled' });
  expect(execute).not.toHaveBeenCalled();
});

test('completion activates once and deduplicates generation diagnostics', async () => {
  const setup = controller();
  setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  });
  await flush();
  setup.controller.request({
    cameraMoving: false,
    generation: 2,
    plan: acceptedPlan,
  });
  await flush();

  expect(setup.controller.activeGeneration).toBe(2);
  expect(setup.diagnostics.filter((code) => (
    code === 'ICE3_RENDER_BATCH_ADAPTIVE_COMPLETED'
  ))).toHaveLength(1);
});
