import type {
  ICERenderBatchCandidate,
  ICERenderBatchPlan,
  ICERenderBatchPlanInput,
} from './ICERenderBatchPlan.js';

const DRAW_GAIN_MS = 0.1;
const WORKER_OVERHEAD_MS = 0.25;
const COPY_BYTES_PER_MS = 2 * 1024 * 1024;
const UPLOAD_BYTES_PER_MS = 1024 * 1024;
const MEMORY_BYTES_PER_MS = 64 * 1024 * 1024 / 0.02;
const MINIMUM_GAIN_MS = 0.2;

interface Candidate {
  readonly batch: ICERenderBatchCandidate;
  readonly visibleIndex: number;
}

export class ICERenderBatchPlanner {
  plan(input: ICERenderBatchPlanInput): ICERenderBatchPlan {
    if (!validInput(input)) return rejected(input.generation);
    const visible = [...new Set(input.visibleBatchIds)];
    const visibleIndex = new Map(
      visible.map((id, index) => [id, index] as const),
    );
    const byId = new Map<string, ICERenderBatchCandidate>();
    for (const batch of input.batches) {
      if (byId.has(batch.id) || !validCandidate(batch)) {
        return rejected(input.generation);
      }
      byId.set(batch.id, batch);
    }
    const candidates: Candidate[] = [];
    for (const id of visible) {
      const batch = byId.get(id);
      if (batch) candidates.push({ batch, visibleIndex: visibleIndex.get(id)! });
    }
    candidates.sort((left, right) => (
      left.batch.materialKey.localeCompare(right.batch.materialKey, 'en')
      || left.visibleIndex - right.visibleIndex
      || left.batch.byteLength - right.batch.byteLength
      || left.batch.id.localeCompare(right.batch.id, 'en')
    ));
    if (candidates.length < 2) {
      return rejected(input.generation, candidates);
    }
    const estimatedBytes = candidates.reduce(
      (total, candidate) => total + candidate.batch.byteLength,
      0,
    );
    const drawCallsSaved = candidates.length - new Set(
      candidates.map((candidate) => candidate.batch.materialKey),
    ).size;
    const estimatedGainMs = drawCallsSaved * DRAW_GAIN_MS;
    const estimatedCostMs = WORKER_OVERHEAD_MS
      + estimatedBytes / COPY_BYTES_PER_MS
      + estimatedBytes / UPLOAD_BYTES_PER_MS
      + estimatedBytes / MEMORY_BYTES_PER_MS;
    return {
      generation: input.generation,
      sourceBatchIds: candidates.map((candidate) => candidate.batch.id),
      estimatedDrawCallsSaved: drawCallsSaved,
      estimatedBytes,
      estimatedGainMs,
      estimatedCostMs,
      accepted: drawCallsSaved > 0
        && estimatedBytes <= input.maxExtraGpuBytes
        && estimatedGainMs >= MINIMUM_GAIN_MS
        && estimatedGainMs > estimatedCostMs,
    };
  }
}

function rejected(
  generation: number,
  candidates: readonly Candidate[] = [],
): ICERenderBatchPlan {
  return {
    generation: Number.isInteger(generation) && generation >= 0
      ? generation
      : 0,
    sourceBatchIds: candidates.map((candidate) => candidate.batch.id),
    estimatedDrawCallsSaved: 0,
    estimatedBytes: 0,
    estimatedGainMs: 0,
    estimatedCostMs: 0,
    accepted: false,
  };
}

function validInput(input: ICERenderBatchPlanInput): boolean {
  return Number.isInteger(input.generation)
    && input.generation >= 0
    && Number.isFinite(input.maxExtraGpuBytes)
    && input.maxExtraGpuBytes >= 0
    && Array.isArray(input.visibleBatchIds)
    && Array.isArray(input.batches);
}

function validCandidate(batch: ICERenderBatchCandidate): boolean {
  return typeof batch.id === 'string'
    && batch.id.length > 0
    && typeof batch.materialKey === 'string'
    && Number.isFinite(batch.triangleCount)
    && batch.triangleCount >= 0
    && Number.isInteger(batch.byteLength)
    && batch.byteLength >= 0;
}
