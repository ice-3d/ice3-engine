import type { ICEGeometryBounds } from '@ice3/core';

export interface ICEBatchWorkerSource {
  readonly id: string;
  readonly materialKey: string;
  readonly positions: ArrayBuffer;
  readonly indices: ArrayBuffer;
  readonly semanticIndices: ArrayBuffer;
}

export interface ICEBatchWorkerOutput {
  readonly id: string;
  readonly materialKey: string;
  readonly positions: ArrayBuffer;
  readonly indices: ArrayBuffer;
  readonly semanticIndices: ArrayBuffer;
  readonly bounds: ICEGeometryBounds;
  readonly triangleCount: number;
}

export interface ICEBatchWorkerRequest {
  readonly type: 'build';
  readonly generation: number;
  readonly maxTrianglesPerBatch: number;
  readonly maxBytesPerBatch: number;
  readonly sources: readonly ICEBatchWorkerSource[];
}

export type ICEBatchWorkerResponse =
  | {
    readonly type: 'built';
    readonly generation: number;
    readonly batches: readonly ICEBatchWorkerOutput[];
  }
  | {
    readonly type: 'failed';
    readonly generation: number;
    readonly message: string;
  };
