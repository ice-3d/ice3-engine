import type { ICEBatchWorkerLike } from './ICEBatchWorkerPool.js';

const WORKER_SOURCE = String.raw`
self.addEventListener('message', (event) => {
  const request = event.data;
  try {
    if (!request.sources.length) {
      self.postMessage({ type: 'built', generation: request.generation, batches: [] });
      return;
    }
    const materialKey = request.sources[0].materialKey;
    if (!materialKey || request.sources.some((source) => source.materialKey !== materialKey)) {
      throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: mixed materials');
    }
    const sources = request.sources.map((source) => ({
      id: source.id,
      positions: new Float32Array(source.positions),
      indices: new Uint32Array(source.indices),
      semanticIndices: new Uint32Array(source.semanticIndices),
      semanticIds: source.semanticIds,
      semanticNodeIds: source.semanticNodeIds,
      semanticSelectionIds: source.semanticSelectionIds,
    })).sort((left, right) => left.id.localeCompare(right.id, 'en'));
    const ids = new Set();
    const semanticIds = [];
    const semanticNodeIds = [];
    const semanticSelectionIds = [];
    const semanticBySelectionId = new Map();
    for (const source of sources) {
      if (ids.has(source.id)) throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: duplicate source');
      ids.add(source.id);
      if (
        source.positions.byteLength % 12 !== 0 ||
        source.indices.byteLength % 12 !== 0 ||
        source.semanticIndices.byteLength !== source.positions.byteLength / 3 ||
        source.semanticIds.length !== source.semanticNodeIds.length ||
        source.semanticIds.length !== source.semanticSelectionIds.length
      ) throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: source lengths');
      const vertexCount = source.positions.length / 3;
      for (const index of source.indices) if (index >= vertexCount) {
        throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: source index');
      }
      source.remap = new Uint32Array(source.semanticSelectionIds.length);
      for (let index = 0; index < source.remap.length; index += 1) {
        const selectionId = source.semanticSelectionIds[index];
        let target = semanticBySelectionId.get(selectionId);
        if (target === undefined) {
          target = semanticIds.length;
          semanticBySelectionId.set(selectionId, target);
          semanticIds.push(source.semanticIds[index]);
          semanticNodeIds.push(source.semanticNodeIds[index]);
          semanticSelectionIds.push(selectionId);
        }
        source.remap[index] = target;
      }
      for (const semantic of source.semanticIndices) {
        if (semantic >= source.semanticIds.length) {
          throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: semantic index');
        }
      }
    }
    const maxTriangles = request.maxTrianglesPerBatch;
    if (!Number.isInteger(maxTriangles) || maxTriangles < 1) {
      throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: triangle limit');
    }
    const maxBytes = request.maxBytesPerBatch;
    if (!Number.isInteger(maxBytes) || maxBytes < 28) {
      throw new Error('ICE3_RENDER_BATCH_WORKER_INVALID: byte limit');
    }
    const batches = [];
    let positions = [], indices = [], semantics = [], count = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const finish = () => {
      if (count === 0) return;
      batches.push({
        id: 'adaptive:' + materialKey + ':' + batches.length,
        materialKey,
        positions: new Float32Array(positions).buffer,
        indices: new Uint32Array(indices).buffer,
        semanticIndices: new Uint32Array(semantics).buffer,
        semanticIds,
        semanticNodeIds,
        semanticSelectionIds,
        bounds: { min: [...min], max: [...max] },
        triangleCount: count,
      });
      positions = []; indices = []; semantics = []; count = 0;
      min[0] = min[1] = min[2] = Infinity;
      max[0] = max[1] = max[2] = -Infinity;
    };
    for (const source of sources) {
      for (let offset = 0; offset < source.indices.length; offset += 3) {
        if (count > 0 && (count + 1 > maxTriangles || count * 28 + 28 > maxBytes)) finish();
        for (let corner = offset; corner < offset + 3; corner += 1) {
          const vertex = source.indices[corner];
          indices.push(positions.length / 3);
          const x = source.positions[vertex * 3];
          const y = source.positions[vertex * 3 + 1];
          const z = source.positions[vertex * 3 + 2];
          positions.push(x, y, z);
          semantics.push(source.remap[source.semanticIndices[vertex]]);
          min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
          max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
        }
        count += 1;
      }
    }
    finish();
    const transfer = [...new Set(batches.flatMap((batch) => [
      batch.positions, batch.indices, batch.semanticIndices,
    ]))];
    self.postMessage({
      type: 'built',
      generation: request.generation,
      batches,
    }, transfer);
  } catch (error) {
    self.postMessage({
      type: 'failed',
      generation: request.generation,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
`;

export function createBatchWorker(): ICEBatchWorkerLike {
  if (
    typeof Worker === 'undefined'
    || typeof Blob === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error('ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: Worker is unavailable');
  }
  const objectUrl = URL.createObjectURL(new Blob(
    [WORKER_SOURCE],
    { type: 'text/javascript' },
  ));
  try {
    const worker = new Worker(objectUrl);
    return {
      postMessage: (message, transfer) => {
        if (transfer) {
          worker.postMessage(message, transfer as Transferable[]);
        } else {
          worker.postMessage(message);
        }
      },
      addEventListener: (type, listener) => {
        worker.addEventListener(type, listener as EventListener);
      },
      removeEventListener: (type, listener) => {
        worker.removeEventListener(type, listener as EventListener);
      },
      terminate: () => {
        worker.terminate();
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error(
      'ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: Worker startup failed',
    );
  }
}
