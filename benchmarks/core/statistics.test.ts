import { it } from 'node:test';
import { expect } from '../../tests/assertions.ts';
import {
  improvementPercent,
  summarizeSamples,
} from './statistics';

it('uses nearest-rank percentiles on unsorted samples', () => {
  expect(summarizeSamples([40, 10, 30, 20, 50])).toEqual({
    min: 10,
    median: 30,
    mean: 30,
    p95: 50,
    p99: 50,
    count: 5,
  });
});

it('reports WebGPU improvement as a percentage reduction', () => {
  expect(improvementPercent(20, 15)).toBe(25);
  expect(improvementPercent(10, 12)).toBe(-20);
});

it('rejects empty and non-finite samples', () => {
  expect(() => summarizeSamples([])).toThrowError(/ICE3_BENCHMARK_INVALID/);
  expect(() => summarizeSamples([1, Number.NaN]))
    .toThrowError(/ICE3_BENCHMARK_INVALID/);
  expect(() => improvementPercent(0, 0))
    .toThrowError(/ICE3_BENCHMARK_INVALID/);
});
