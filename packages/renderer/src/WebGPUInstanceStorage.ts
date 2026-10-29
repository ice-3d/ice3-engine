import type {
  ICEGeometry,
} from '@ice3/core';
import type { ICEInstanceBatch } from './InstanceBatch.js';
import {
  createEmptyGPUDataBuffer,
  writeGPUData,
} from './WebGPUResources.js';

const STORAGE_USAGE = 128 | 8;
export const INSTANCE_RECORD_BYTES = 96;

export type ICEInstanceStoragePagePlan = Readonly<{
  firstInstance: number;
  instanceCount: number;
}>;

export type ICEInstanceStoragePage = ICEInstanceStoragePagePlan & {
  readonly buffer: GPUBuffer;
};

export type ICEInstanceStorageEntry = Readonly<{
  pages: readonly ICEInstanceStoragePage[];
  generation: number;
  bytes: number;
}>;

type CachedEntry = ICEInstanceStorageEntry & {
  readonly geometry: ICEGeometry;
  readonly matrixSource: Float32Array;
  readonly semanticSource: Uint32Array;
};

export type WebGPUInstanceStorageOptions = {
  readonly maxBindingBytes: number;
  readonly minOffsetAlignment: number;
};

export class WebGPUInstanceStorage {
  private readonly entries = new Map<string, CachedEntry>();
  private active = new Set<string>();
  private resourceGeneration = 0;
  private uploadBytes = 0;
  private readonly maxBindingBytes: number;
  private readonly minOffsetAlignment: number;

  constructor(
    private readonly device: GPUDevice,
    options?: Partial<WebGPUInstanceStorageOptions>,
  ) {
    this.maxBindingBytes = options?.maxBindingBytes
      ?? device.limits.maxStorageBufferBindingSize
      ?? 0;
    this.minOffsetAlignment = options?.minOffsetAlignment
      ?? device.limits.minStorageBufferOffsetAlignment
      ?? 256;
    if (
      this.maxBindingBytes < INSTANCE_RECORD_BYTES
      || this.minOffsetAlignment < 4
    ) {
      throw new Error('ICE3_STORAGE_INVALID: limits are too low');
    }
  }

  plan(
    instanceCount: number,
    recordBytes = INSTANCE_RECORD_BYTES,
  ): readonly ICEInstanceStoragePagePlan[] {
    if (
      !Number.isInteger(instanceCount)
      || instanceCount < 0
      || !Number.isInteger(recordBytes)
      || recordBytes < 1
    ) {
      throw new Error('ICE3_STORAGE_INVALID: page input');
    }
    if (instanceCount === 0) return [];
    const stride = Math.ceil(recordBytes / 16) * 16;
    const perPage = Math.max(1, Math.floor(this.maxBindingBytes / stride));
    const pages: ICEInstanceStoragePagePlan[] = [];
    for (let first = 0; first < instanceCount; first += perPage) {
      pages.push({
        firstInstance: first,
        instanceCount: Math.min(perPage, instanceCount - first),
      });
    }
    return pages;
  }

  retain(
    batch: ICEInstanceBatch,
    geometry: ICEGeometry,
  ): ICEInstanceStorageEntry {
    this.active.add(batch.id);
    const existing = this.entries.get(batch.id);
    if (
      existing
      && existing.geometry === geometry
      && existing.matrixSource === batch.instanceMatrices
      && existing.semanticSource === batch.semanticIndices
    ) {
      return existing;
    }
    if (existing) this.delete(existing);

    const bounds = geometry.getBounds();
    const radius = Math.hypot(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ) / 2;
    const center = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ] as const;
    const plans = this.plan(batch.semanticIds.length);
    const pages = plans.map((page) => {
      const data = new ArrayBuffer(page.instanceCount * INSTANCE_RECORD_BYTES);
      const floats = new Float32Array(data);
      const words = new Uint32Array(data);
      for (let local = 0; local < page.instanceCount; local += 1) {
        const source = page.firstInstance + local;
        const offset = local * 24;
        floats.set(
          batch.instanceMatrices.subarray(source * 16, source * 16 + 16),
          offset,
        );
        floats.set([
          center[0],
          center[1],
          center[2],
          radius,
        ], offset + 16);
        words[offset + 20] = batch.semanticIndices[source] ?? source;
      }
      const buffer = createEmptyGPUDataBuffer(
        this.device,
        data.byteLength,
        STORAGE_USAGE,
        `ice3:instance-records:${batch.id}:${page.firstInstance}`,
      );
      writeGPUData(this.device, buffer, floats);
      this.uploadBytes += data.byteLength;
      return { ...page, buffer };
    });
    const entry: CachedEntry = {
      pages,
      generation: ++this.resourceGeneration,
      bytes: pages.reduce((sum, page) => sum + page.buffer.size, 0),
      geometry,
      matrixSource: batch.instanceMatrices,
      semanticSource: batch.semanticIndices,
    };
    this.entries.set(batch.id, entry);
    return entry;
  }

  beginFrame(): void {
    this.active = new Set();
  }

  endFrame(): void {
    for (const [id, entry] of this.entries) {
      if (this.active.has(id)) continue;
      this.delete(entry);
      this.entries.delete(id);
    }
  }

  get generation(): number {
    return this.resourceGeneration;
  }

  get totalBytes(): number {
    return [...this.entries.values()]
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  get totalUploadBytes(): number {
    return this.uploadBytes;
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.delete(entry);
    this.entries.clear();
    this.active.clear();
  }

  private delete(entry: ICEInstanceStorageEntry): void {
    for (const page of entry.pages) page.buffer.destroy();
    this.resourceGeneration += 1;
  }
}
