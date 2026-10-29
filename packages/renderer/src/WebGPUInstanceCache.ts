import {
  createEmptyGPUDataBuffer,
  writeGPUData,
  WEBGPU_BUFFER_USAGE,
} from './WebGPUResources.js';
import type { ICEInstanceBatch } from './InstanceBatch.js';

export interface WebGPUInstanceEntry {
  readonly matrixBuffer: GPUBuffer;
  readonly semanticBuffer: GPUBuffer;
  readonly instanceCount: number;
  readonly bytes: number;
}

interface CachedInstanceEntry extends WebGPUInstanceEntry {
  matrixCapacity: number;
  semanticCapacity: number;
}

export class WebGPUInstanceCache {
  private readonly entries = new Map<string, CachedInstanceEntry>();
  private active = new Set<string>();

  constructor(private readonly device: GPUDevice) {}

  retain(batch: ICEInstanceBatch): WebGPUInstanceEntry {
    this.active.add(batch.id);
    const matrixSize = batch.instanceMatrices.byteLength;
    const semanticSize = batch.semanticIndices.byteLength;
    let entry = this.entries.get(batch.id);
    if (
      !entry
      || entry.matrixCapacity < matrixSize
      || entry.semanticCapacity < semanticSize
    ) {
      if (entry) this.deleteEntry(entry);
      entry = {
        matrixBuffer: createEmptyGPUDataBuffer(
          this.device,
          matrixSize,
          WEBGPU_BUFFER_USAGE.vertex,
          `${batch.id}:matrices`,
        ),
        semanticBuffer: createEmptyGPUDataBuffer(
          this.device,
          semanticSize,
          WEBGPU_BUFFER_USAGE.vertex,
          `${batch.id}:semantic`,
        ),
        instanceCount: batch.semanticIds.length,
        bytes: Math.ceil(matrixSize / 4) * 4
          + Math.ceil(semanticSize / 4) * 4,
        matrixCapacity: Math.max(4, Math.ceil(matrixSize / 4) * 4),
        semanticCapacity: Math.max(4, Math.ceil(semanticSize / 4) * 4),
      };
      this.entries.set(batch.id, entry);
    }
    writeGPUData(this.device, entry.matrixBuffer, batch.instanceMatrices);
    writeGPUData(this.device, entry.semanticBuffer, batch.semanticIndices);
    return entry;
  }

  beginFrame(): void {
    this.active = new Set();
  }

  endFrame(): void {
    for (const [id, entry] of this.entries) {
      if (this.active.has(id)) continue;
      this.deleteEntry(entry);
      this.entries.delete(id);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.deleteEntry(entry);
    }
    this.active.clear();
  }

  dispose(): void {
    this.clear();
  }

  get totalBytes(): number {
    return [...this.entries.values()]
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  private deleteEntry(entry: WebGPUInstanceEntry): void {
    entry.matrixBuffer.destroy();
    entry.semanticBuffer.destroy();
  }
}
