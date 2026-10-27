import type { ICEGeometryBounds } from '@ice3/core';

export interface ICERenderBatchCandidate {
  readonly id: string;
  readonly materialKey: string;
  readonly triangleCount: number;
  readonly byteLength: number;
  readonly bounds: ICEGeometryBounds;
}

export interface ICERenderBatchPlanInput {
  readonly generation: number;
  readonly visibleBatchIds: readonly string[];
  readonly batches: readonly ICERenderBatchCandidate[];
  readonly maxExtraGpuBytes: number;
}

export interface ICERenderBatchPlan {
  readonly generation: number;
  readonly sourceBatchIds: readonly string[];
  readonly estimatedDrawCallsSaved: number;
  readonly estimatedBytes: number;
  readonly estimatedGainMs: number;
  readonly estimatedCostMs: number;
  readonly accepted: boolean;
}
