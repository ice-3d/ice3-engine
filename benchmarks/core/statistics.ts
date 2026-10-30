export type ICEBenchmarkSummary = Readonly<{
  min: number;
  median: number;
  mean: number;
  p95: number;
  p99: number;
  count: number;
}>;

export function summarizeSamples(
  samples: readonly number[],
): ICEBenchmarkSummary {
  if (
    samples.length === 0
    || samples.some((sample) => !Number.isFinite(sample))
  ) {
    throw new Error('ICE3_BENCHMARK_INVALID: samples must be finite and non-empty');
  }
  const values = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1]! + values[middle]!) / 2
    : values[middle]!;
  return {
    min: values[0]!,
    median,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: nearestRank(values, 0.95),
    p99: nearestRank(values, 0.99),
    count: values.length,
  };
}

export function improvementPercent(
  webgl2: number,
  webgpu: number,
): number {
  if (
    !Number.isFinite(webgl2)
    || !Number.isFinite(webgpu)
    || webgl2 === 0
  ) {
    throw new Error('ICE3_BENCHMARK_INVALID: comparison values are invalid');
  }
  return (webgl2 - webgpu) / webgl2 * 100;
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentile * sorted.length) - 1),
  );
  return sorted[index]!;
}
