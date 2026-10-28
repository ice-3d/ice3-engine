import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBatchWorkerPool,
  type ICEBatchWorkerLike,
} from '../src/batching/ICEBatchWorkerPool.js';
import type {
  ICEBatchWorkerRequest,
  ICEBatchWorkerResponse,
} from '../src/batching/ICEBatchWorkerProtocol.js';

class FakeWorker implements ICEBatchWorkerLike {
  readonly messages: Array<{
    readonly message: ICEBatchWorkerRequest;
    readonly transfer: readonly Transferable[];
  }> = [];
  terminated = false;
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent | ErrorEvent) => void>
  >();

  postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    this.messages.push({
      message: message as ICEBatchWorkerRequest,
      transfer,
    });
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ICEBatchWorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: response } as MessageEvent);
    }
  }

  fail(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener({ message } as ErrorEvent);
    }
  }
}

const request = (generation: number): ICEBatchWorkerRequest => ({
  type: 'build',
  generation,
  maxTrianglesPerBatch: 100,
  maxBytesPerBatch: 1024,
  sources: [{
    id: `batch:${generation}`,
    materialKey: 'material:0',
    positions: new ArrayBuffer(12),
    indices: new ArrayBuffer(12),
    semanticIndices: new ArrayBuffer(12),
  }],
});

test('does not exceed the configured worker concurrency', async () => {
  const workers: FakeWorker[] = [];
  const pool = new ICEBatchWorkerPool({
    maxWorkers: 2,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const first = pool.run(request(1), new AbortController().signal);
  const second = pool.run(request(2), new AbortController().signal);
  const third = pool.run(request(3), new AbortController().signal);

  expect(workers).toHaveLength(2);
  workers[0]!.respond({
    type: 'built',
    generation: 1,
    batches: [],
  });
  await first;
  expect(workers).toHaveLength(3);
  workers[1]!.respond({
    type: 'built',
    generation: 2,
    batches: [],
  });
  workers[2]!.respond({
    type: 'built',
    generation: 3,
    batches: [],
  });
  await Promise.all([second, third]);
  pool.dispose();
});

test('keeps concurrent material jobs for one generation bounded', async () => {
  const workers: FakeWorker[] = [];
  const pool = new ICEBatchWorkerPool({
    maxWorkers: 2,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });

  const first = pool.run(request(4), new AbortController().signal);
  const second = pool.run(request(4), new AbortController().signal);
  const third = pool.run(request(4), new AbortController().signal);

  expect(workers).toHaveLength(2);
  workers[0]!.respond({ type: 'built', generation: 4, batches: [] });
  workers[1]!.respond({ type: 'built', generation: 4, batches: [] });
  await Promise.all([first, second]);
  expect(workers).toHaveLength(3);
  workers[2]!.respond({ type: 'built', generation: 4, batches: [] });
  await third;
  pool.dispose();
});

test('transfers every source buffer once', async () => {
  const worker = new FakeWorker();
  const pool = new ICEBatchWorkerPool({
    maxWorkers: 1,
    workerFactory: () => worker,
  });
  const input = request(1);

  const result = pool.run(input, new AbortController().signal);

  expect(worker.messages[0]!.transfer).toHaveLength(3);
  expect(new Set(worker.messages[0]!.transfer).size).toBe(3);
  pool.dispose();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});

test('removes an aborted job and ignores its late response', async () => {
  const worker = new FakeWorker();
  const pool = new ICEBatchWorkerPool({
    maxWorkers: 1,
    workerFactory: () => worker,
  });
  const controller = new AbortController();
  const result = pool.run(request(1), controller.signal);

  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  worker.respond({ type: 'built', generation: 1, batches: [] });
  expect(worker.terminated).toBe(true);
  pool.dispose();
});

test('returns a fallback response when worker construction fails', async () => {
  const pool = new ICEBatchWorkerPool({
    maxWorkers: 1,
    workerFactory: () => {
      throw new Error('blocked');
    },
  });

  await expect(pool.run(
    request(4),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'failed',
    generation: 4,
    message: expect.stringContaining('ICE3_RENDER_BATCH_WORKER_UNAVAILABLE'),
  });
  pool.dispose();
});
