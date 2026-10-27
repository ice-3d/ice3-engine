import type {
  ICEBatchWorkerRequest,
  ICEBatchWorkerResponse,
} from '../batching/ICEBatchWorkerProtocol.js';
import { mergeBatchBuffers } from '../batching/mergeBatchBuffers.js';

const scope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ICEBatchWorkerRequest>) => void,
  ): void;
  postMessage(
    message: ICEBatchWorkerResponse,
    transfer?: readonly Transferable[],
  ): void;
};

scope.addEventListener('message', (event) => {
  const request = event.data;
  try {
    const batches = mergeBatchBuffers(request.sources, {
      maxTrianglesPerBatch: request.maxTrianglesPerBatch,
      maxBytesPerBatch: request.maxBytesPerBatch,
    }).map((batch) => ({
      id: batch.id,
      materialKey: batch.materialKey,
      positions: batch.positions.buffer as ArrayBuffer,
      indices: batch.indices.buffer as ArrayBuffer,
      semanticIndices: batch.semanticIndices.buffer as ArrayBuffer,
      semanticIds: batch.semanticIds,
      semanticNodeIds: batch.semanticNodeIds,
      semanticSelectionIds: batch.semanticSelectionIds,
      bounds: batch.bounds,
      triangleCount: batch.triangleCount,
    }));
    scope.postMessage(
      {
        type: 'built',
        generation: request.generation,
        batches,
      },
      [...new Set(batches.flatMap((batch) => [
        batch.positions,
        batch.indices,
        batch.semanticIndices,
      ]))],
    );
  } catch (error) {
    scope.postMessage({
      type: 'failed',
      generation: request.generation,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
