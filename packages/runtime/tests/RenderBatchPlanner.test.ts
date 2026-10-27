import { expect, test } from 'node-test';
import { ICERenderBatchPlanner } from '../src/batching/ICERenderBatchPlanner.js';

const planner = new ICERenderBatchPlanner();

const planInput = (count: number, byteLength: number) => ({
  generation: 2,
  visibleBatchIds: Array.from(
    { length: count },
    (_, index) => `batch:${index}`,
  ),
  batches: Array.from({ length: count }, (_, index) => ({
    id: `batch:${index}`,
    materialKey: 'material:0',
    triangleCount: 500,
    byteLength,
    bounds: {
      min: [0, 0, 0] as const,
      max: [1, 1, 1] as const,
    },
  })),
  maxExtraGpuBytes: 16 * 1024 * 1024,
});

test('accepts a useful merge within the extra GPU byte budget', () => {
  expect(planner.plan(planInput(100, 16 * 1024)).accepted).toBe(true);
});

test('rejects a merge above the extra GPU byte budget', () => {
  expect(planner.plan(planInput(2, 64 * 1024 * 1024)).accepted).toBe(false);
});

test('accepts an exact byte-budget boundary', () => {
  const input = planInput(16, 1024 * 1024);
  for (const batch of input.batches) batch.triangleCount = 0;

  expect(planner.plan(input)).toMatchObject({
    accepted: false,
    estimatedBytes: 16 * 1024 * 1024,
  });
});

test('includes candidate geometry in the extra memory estimate', () => {
  const input = planInput(4, 1024 * 1024);
  input.maxExtraGpuBytes = 4 * 1024 * 1024;

  expect(planner.plan(input)).toMatchObject({
    accepted: false,
    estimatedBytes: 4 * 1024 * 1024 + 4 * 500 * 28,
  });
});

test('rejects plans with no draw-call savings', () => {
  expect(planner.plan(planInput(1, 1024)).accepted).toBe(false);
});

test('rejects negative input instead of producing a plan', () => {
  const input = planInput(4, 1024);
  input.batches[0]!.byteLength = -1;

  expect(planner.plan(input)).toMatchObject({
    accepted: false,
    sourceBatchIds: [],
  });
});

test('orders candidates deterministically by visible order', () => {
  const input = planInput(12, 16 * 1024);
  input.visibleBatchIds = [
    'batch:8',
    'batch:2',
    'batch:10',
    'batch:0',
    'batch:7',
    'batch:3',
    'batch:11',
    'batch:1',
    'batch:6',
    'batch:5',
    'batch:9',
    'batch:4',
  ];
  input.batches = [...input.batches].reverse();

  expect(planner.plan(input).sourceBatchIds).toEqual(input.visibleBatchIds);
});
