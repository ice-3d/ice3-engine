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
        cpuStages: {
          collectMs: [1, 1],
          prepareAndUploadMs: [2, 2],
          encodeMs: [3, 3],
          submitMs: [4, 4],
        },
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

it('reports CPU stage summaries alongside total CPU time', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [{
      backend: 'webgpu',
      scenario: 'wastewater-1x',
      warmupFrames: 60,
      measuredFrames: 2,
      initializationMs: 5,
      samples: {
        cpuFrameMs: [1, 2],
        cpuStages: {
          collectMs: [0.1, 0.1],
          prepareAndUploadMs: [0.2, 0.2],
          encodeMs: [0.3, 0.3],
          submitMs: [0.4, 0.4],
        },
        gpuFrameMs: null,
        pickMs: [],
      },
    }],
  });
  expect(report.runs[0]?.metrics.cpuStages.collectMs.median).toBe(0.1);
  expect(report.runs[0]?.metrics.cpuStages.submitMs.p95).toBe(0.4);
});

it('treats an empty GPU sample array as unavailable evidence', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [{
      backend: 'webgpu',
      scenario: 'wastewater-1x',
      warmupFrames: 1,
      measuredFrames: 1,
      initializationMs: 1,
      samples: {
        cpuFrameMs: [1],
        cpuStages: {
          collectMs: [0.1],
          prepareAndUploadMs: [0.2],
          encodeMs: [0.3],
          submitMs: [0.4],
        },
        gpuFrameMs: [],
        pickMs: [],
      },
      gpuFrameTimeUnavailableReason: 'map-failed',
    }],
  });
  expect(report.runs[0]?.metrics.gpuFrameMs).toBeNull();
  expect(report.runs[0]?.gpuFrameTimeUnavailableReason).toBe('map-failed');
});

it('keeps a zero-resolution baseline as an unavailable percentage', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [
      benchmarkRun('webgl2', [0, 0]),
      benchmarkRun('webgpu', [0.1, 0.1]),
    ],
  });
  expect(report.improvements[0]?.cpuMedianPercent).toBeNull();
});

function benchmarkRun(
  backend: 'webgl2' | 'webgpu',
  cpuFrameMs: readonly number[],
) {
  return {
    backend,
    scenario: 'wastewater-1x',
    warmupFrames: 1,
    measuredFrames: cpuFrameMs.length,
    initializationMs: 1,
    samples: {
      cpuFrameMs,
      cpuStages: {
        collectMs: cpuFrameMs,
        prepareAndUploadMs: cpuFrameMs,
        encodeMs: cpuFrameMs,
        submitMs: cpuFrameMs,
      },
      gpuFrameMs: null,
      pickMs: [],
    },
  } as const;
}
