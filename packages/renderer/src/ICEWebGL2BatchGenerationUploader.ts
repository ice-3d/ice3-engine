import type { ICEGeometryBounds } from '@ice3/core';

export interface ICEBatchUploadBuffer {
  readonly id: string;
  readonly materialKey: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly semanticIndices: Uint32Array;
  readonly semanticIds: readonly string[];
  readonly semanticNodeIds: readonly string[];
  readonly semanticSelectionIds: readonly string[];
  readonly bounds: ICEGeometryBounds;
  readonly triangleCount: number;
  readonly byteLength: number;
}

export interface ICEBatchUploadOptions {
  readonly generation: number;
  readonly bytesPerFrame: number;
  readonly onUploaded: (generation: number) => void;
  readonly onFailed: (generation: number, error: unknown) => void;
  readonly upload?: (buffer: ICEBatchUploadBuffer) => unknown;
  readonly release?: (resource: unknown) => void;
  readonly onActivate?: (
    generation: number,
    resources: readonly unknown[],
  ) => void;
  readonly schedule?: (callback: FrameRequestCallback) => number;
  readonly cancelSchedule?: (id: number) => void;
  readonly isCurrent?: () => boolean;
}

export interface ICEBatchGenerationHandle {
  cancel(): void;
}

export function queueBatchGeneration(
  buffers: readonly ICEBatchUploadBuffer[],
  options: ICEBatchUploadOptions,
): ICEBatchGenerationHandle {
  if (
    !Number.isInteger(options.generation)
    || options.generation < 0
    || !Number.isInteger(options.bytesPerFrame)
    || options.bytesPerFrame < 1
    || buffers.some((buffer) => (
      !Number.isInteger(buffer.byteLength)
      || buffer.byteLength < 1
      || buffer.byteLength > options.bytesPerFrame
    ))
  ) {
    fail(options, new Error(
      'ICE3_RENDER_BATCH_UPLOAD_INVALID: upload options are invalid',
    ));
    return { cancel: () => undefined };
  }
  const schedule = options.schedule ?? globalThis.requestAnimationFrame;
  const cancelSchedule =
    options.cancelSchedule ?? globalThis.cancelAnimationFrame;
  const upload = options.upload ?? ((buffer) => buffer);
  const release = options.release ?? (() => undefined);
  const resources: unknown[] = [];
  let next = 0;
  let frame: number | undefined;
  let settled = false;

  const cleanup = (): void => {
    if (frame !== undefined) {
      cancelSchedule(frame);
      frame = undefined;
    }
    for (const resource of resources.splice(0)) release(resource);
  };
  const current = (): boolean => options.isCurrent?.() ?? true;
  const failNow = (error: unknown): void => {
    if (settled) return;
    settled = true;
    cleanup();
    options.onFailed(options.generation, error);
  };
  const pump = (): void => {
    frame = undefined;
    if (settled) return;
    if (!current()) {
      settled = true;
      cleanup();
      return;
    }
    let bytes = 0;
    try {
      while (next < buffers.length) {
        const buffer = buffers[next]!;
        if (resources.length > 0 && bytes + buffer.byteLength > options.bytesPerFrame) {
          break;
        }
        bytes += buffer.byteLength;
        next += 1;
        resources.push(upload(buffer));
      }
    } catch (error) {
      failNow(error);
      return;
    }
    if (next >= buffers.length) {
      if (!current()) {
        settled = true;
        cleanup();
        return;
      }
      settled = true;
      options.onActivate?.(options.generation, resources);
      options.onUploaded(options.generation);
      return;
    }
    frame = schedule(pump);
  };
  frame = schedule(pump);
  return {
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

function fail(options: ICEBatchUploadOptions, error: unknown): void {
  options.onFailed(options.generation, error);
}
