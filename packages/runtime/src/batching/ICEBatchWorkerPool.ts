import { createBatchWorker } from './createBatchWorker.js';
import type {
  ICEBatchWorkerRequest,
  ICEBatchWorkerResponse,
} from './ICEBatchWorkerProtocol.js';

export interface ICEBatchWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(
    type: string,
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface ICEBatchWorkerPoolOptions {
  readonly maxWorkers?: number;
  readonly workerFactory?: () => ICEBatchWorkerLike;
}

interface WorkerJob {
  readonly request: ICEBatchWorkerRequest;
  readonly signal: AbortSignal;
  readonly resolve: (response: ICEBatchWorkerResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
  settled: boolean;
  worker?: ICEBatchWorkerLike;
}

export class ICEBatchWorkerPool {
  private readonly maxWorkers: number;
  private readonly workerFactory: () => ICEBatchWorkerLike;
  private readonly queue: WorkerJob[] = [];
  private readonly active = new Map<number, WorkerJob>();
  private disposed = false;

  constructor(options: ICEBatchWorkerPoolOptions = {}) {
    const requested = options.maxWorkers ?? defaultConcurrency();
    this.maxWorkers = Number.isInteger(requested) && requested > 0
      ? requested
      : 1;
    this.workerFactory = options.workerFactory ?? createBatchWorker;
  }

  run(
    request: ICEBatchWorkerRequest,
    signal: AbortSignal,
  ): Promise<ICEBatchWorkerResponse> {
    if (this.disposed) {
      return Promise.resolve(failed(
        request.generation,
        'ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: worker pool is disposed',
      ));
    }
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const job: WorkerJob = {
        request,
        signal,
        resolve,
        reject,
        abort: () => this.cancel(job),
        settled: false,
      };
      signal.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of [...this.queue, ...this.active.values()]) {
      if (job.settled) continue;
      job.settled = true;
      job.signal.removeEventListener('abort', job.abort);
      job.worker?.terminate();
      job.reject(abortError());
    }
    this.queue.length = 0;
    this.active.clear();
  }

  private pump(): void {
    while (!this.disposed && this.active.size < this.maxWorkers) {
      const job = this.queue.shift();
      if (!job) return;
      if (job.settled) continue;
      this.start(job);
    }
  }

  private start(job: WorkerJob): void {
    let worker: ICEBatchWorkerLike;
    try {
      worker = this.workerFactory();
    } catch (error) {
      this.settle(job, failed(
        job.request.generation,
        `ICE3_RENDER_BATCH_WORKER_UNAVAILABLE: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ));
      return;
    }
    job.worker = worker;
    this.active.set(job.request.generation, job);
    const onMessage = (event: MessageEvent | ErrorEvent): void => {
      const response = (event as MessageEvent).data as
        | ICEBatchWorkerResponse
        | undefined;
      if (
        !response
        || response.generation !== job.request.generation
      ) {
        this.settle(job, failed(
          job.request.generation,
          'ICE3_RENDER_BATCH_WORKER_FAILED: response generation is invalid',
        ));
        return;
      }
      this.settle(job, response);
    };
    const onError = (event: MessageEvent | ErrorEvent): void => {
      this.settle(job, failed(
        job.request.generation,
        `ICE3_RENDER_BATCH_WORKER_FAILED: ${
          (event as ErrorEvent).message ?? 'worker failed'
        }`,
      ));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const transfer = transferList(job.request);
    try {
      worker.postMessage(job.request, transfer);
    } catch (error) {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      this.settle(job, failed(
        job.request.generation,
        `ICE3_RENDER_BATCH_WORKER_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ));
    }
  }

  private settle(job: WorkerJob, response: ICEBatchWorkerResponse): void {
    if (job.settled) return;
    job.settled = true;
    job.signal.removeEventListener('abort', job.abort);
    job.worker?.terminate();
    const activeJob = this.active.get(job.request.generation);
    if (activeJob === job) this.active.delete(job.request.generation);
    job.resolve(response);
    this.pump();
  }

  private cancel(job: WorkerJob): void {
    if (job.settled) return;
    job.settled = true;
    job.signal.removeEventListener('abort', job.abort);
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    job.worker?.terminate();
    const activeJob = this.active.get(job.request.generation);
    if (activeJob === job) this.active.delete(job.request.generation);
    job.reject(abortError());
    this.pump();
  }
}

function transferList(request: ICEBatchWorkerRequest): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const source of request.sources) {
    buffers.add(source.positions);
    buffers.add(source.indices);
    buffers.add(source.semanticIndices);
  }
  return [...buffers];
}

function failed(
  generation: number,
  message: string,
): ICEBatchWorkerResponse {
  return { type: 'failed', generation, message };
}

function abortError(): DOMException {
  return new DOMException('Batch worker request was aborted', 'AbortError');
}

function defaultConcurrency(): number {
  return Math.min(
    4,
    Math.max(
      1,
      (globalThis.navigator?.hardwareConcurrency ?? 2) - 1,
    ),
  );
}
