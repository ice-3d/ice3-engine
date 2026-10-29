import {
  improvementPercent,
  summarizeSamples,
  type ICEBenchmarkSummary,
} from './core/statistics.js';
import type { ICERendererStats } from '@ice3/renderer';

export type ICEBenchmarkRunInput = Readonly<{
  backend: 'webgl2' | 'webgpu';
  scenario: string;
  warmupFrames: number;
  measuredFrames: number;
  initializationMs: number;
  stats?: ICERendererStats;
  samples: Readonly<{
    cpuFrameMs: readonly number[];
    gpuFrameMs: readonly number[] | null;
    pickMs: readonly number[];
  }>;
  gpuFrameTimeUnavailableReason?: string;
}>;

export type ICEBenchmarkReport = Readonly<{
  generatedAt: string;
  environment: Readonly<{
    browser: string;
    platform: string;
    adapter: string;
  }>;
  runs: readonly Readonly<{
    backend: 'webgl2' | 'webgpu';
    scenario: string;
    warmupFrames: number;
    measuredFrames: number;
    initializationMs: number;
    stats?: ICERendererStats;
    metrics: Readonly<{
      cpuFrameMs: ICEBenchmarkSummary;
      gpuFrameMs: ICEBenchmarkSummary | null;
      pickMs: ICEBenchmarkSummary | null;
    }>;
    gpuFrameTimeUnavailableReason?: string;
  }>[];
  improvements: readonly Readonly<{
    scenario: string;
    cpuMedianPercent: number;
    gpuMedianPercent: number | null;
    pickMedianPercent: number | null;
  }>[];
}>;

export function createBenchmarkReport(input: {
  readonly environment: ICEBenchmarkReport['environment'];
  readonly runs: readonly ICEBenchmarkRunInput[];
  readonly generatedAt?: string;
}): ICEBenchmarkReport {
  const runs = input.runs.map((run) => ({
    backend: run.backend,
    scenario: run.scenario,
    warmupFrames: run.warmupFrames,
    measuredFrames: run.measuredFrames,
    initializationMs: run.initializationMs,
    ...(run.stats ? { stats: run.stats } : {}),
    metrics: {
      cpuFrameMs: summarizeSamples(run.samples.cpuFrameMs),
      gpuFrameMs: run.samples.gpuFrameMs
        ? summarizeSamples(run.samples.gpuFrameMs)
        : null,
      pickMs: run.samples.pickMs.length > 0
        ? summarizeSamples(run.samples.pickMs)
        : null,
    },
    ...(run.gpuFrameTimeUnavailableReason
      ? {
          gpuFrameTimeUnavailableReason:
            run.gpuFrameTimeUnavailableReason,
        }
      : {}),
  }));
  const improvements = [];
  for (const scenario of new Set(runs.map((run) => run.scenario))) {
    const webgl2 = runs.find(
      (run) => run.scenario === scenario && run.backend === 'webgl2',
    );
    const webgpu = runs.find(
      (run) => run.scenario === scenario && run.backend === 'webgpu',
    );
    if (!webgl2 || !webgpu) continue;
    improvements.push({
      scenario,
      cpuMedianPercent: improvementPercent(
        webgl2.metrics.cpuFrameMs.median,
        webgpu.metrics.cpuFrameMs.median,
      ),
      gpuMedianPercent:
        webgl2.metrics.gpuFrameMs && webgpu.metrics.gpuFrameMs
          ? improvementPercent(
              webgl2.metrics.gpuFrameMs.median,
              webgpu.metrics.gpuFrameMs.median,
            )
          : null,
      pickMedianPercent:
        webgl2.metrics.pickMs && webgpu.metrics.pickMs
          ? improvementPercent(
              webgl2.metrics.pickMs.median,
              webgpu.metrics.pickMs.median,
            )
          : null,
    });
  }
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    environment: input.environment,
    runs,
    improvements,
  };
}

export function reportToMarkdown(report: ICEBenchmarkReport): string {
  const lines = [
    '# ICE3 Renderer Benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    `Browser: ${report.environment.browser}`,
    `Platform: ${report.environment.platform}`,
    `Adapter: ${report.environment.adapter}`,
    '',
    '| Scenario | Backend | Init ms | CPU median ms | CPU p95 ms | GPU median ms | Pick median ms | Draw calls | GPU bytes | CPU improvement |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const run of report.runs) {
    const improvement = report.improvements.find(
      (item) => item.scenario === run.scenario,
    );
    lines.push([
      run.scenario,
      run.backend,
      formatNumber(run.initializationMs),
      formatNumber(run.metrics.cpuFrameMs.median),
      formatNumber(run.metrics.cpuFrameMs.p95),
      run.metrics.gpuFrameMs
        ? formatNumber(run.metrics.gpuFrameMs.median)
        : 'n/a',
      run.metrics.pickMs
        ? formatNumber(run.metrics.pickMs.median)
        : 'n/a',
      String(run.stats?.drawCalls ?? 'n/a'),
      String(run.stats?.gpuBytes ?? 'n/a'),
      run.backend === 'webgpu' && improvement
        ? `${formatNumber(improvement.cpuMedianPercent)}%`
        : 'baseline',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  const gpuUnavailable = report.runs.find(
    (run) => run.gpuFrameTimeUnavailableReason,
  )?.gpuFrameTimeUnavailableReason;
  if (gpuUnavailable) {
    lines.push('', `GPU timing unavailable: ${gpuUnavailable}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}
