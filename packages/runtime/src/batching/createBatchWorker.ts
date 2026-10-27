import type { ICEBatchWorkerLike } from './ICEBatchWorkerPool.js';

export function createBatchWorker(): ICEBatchWorkerLike {
  if (typeof Worker === 'undefined') {
    throw new Error('ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: Worker is unavailable');
  }
  const url = new URL('../workers/renderBatchWorker.js', import.meta.url);
  try {
    return new Worker(url, { type: 'module' }) as unknown as ICEBatchWorkerLike;
  } catch {
    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error(
        'ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: module Worker startup failed',
      );
    }
    const objectUrl = URL.createObjectURL(new Blob([
      `import(${JSON.stringify(url.href)});`,
    ], { type: 'text/javascript' }));
    try {
      return new Worker(objectUrl) as unknown as ICEBatchWorkerLike;
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error(
        'ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: Worker startup failed',
      );
    }
  }
}
