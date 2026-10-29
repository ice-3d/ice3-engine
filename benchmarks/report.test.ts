import { it } from 'node:test';
import { expect } from '../tests/assertions.ts';
import { improvementPercent } from './core/statistics';
import { createBenchmarkReport } from './report';

it('writes null GPU timing and an explicit reason when timers are unavailable', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [{
      backend: 'webgpu',
      scenario: 'unique-meshes',
      warmupFrames: 60,
      measuredFrames: 300,
      initializationMs: 25,
      samples: {
        cpuFrameMs: [12, 10],
        gpuFrameMs: null,
        pickMs: [],
      },
      gpuFrameTimeUnavailableReason: 'timestamp-query unavailable',
    }],
  });
  expect(report.runs[0]?.metrics.gpuFrameMs).toBeNull();
  expect(report.runs[0]?.gpuFrameTimeUnavailableReason)
    .toBe('timestamp-query unavailable');
  expect(report.runs[0]?.metrics.pickMs).toBeNull();
});

it('does not divide by zero when comparing an empty pick sample', () => {
  expect(() => improvementPercent(0, 0)).toThrowError(
    /ICE3_BENCHMARK_INVALID/,
  );
});
