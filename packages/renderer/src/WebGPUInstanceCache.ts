import {
  createEmptyGPUDataBuffer,
  writeGPUData,
  WEBGPU_BUFFER_USAGE,
} from './WebGPUResources.js';
import type { ICEInstanceBatch } from './InstanceBatch.js';

export interface WebGPUInstanceEntry {
  readonly matrixBuffer: GPUBuffer;
  readonly semanticBuffer: GPUBuffer;
  instanceCount: number;
  readonly bytes: number;
  readonly generation: number;
}

interface CachedInstanceEntry extends WebGPUInstanceEntry {
  matrixCapacity: number;
  semanticCapacity: number;
  matrixBytes?: Uint8Array;
  semanticBytes?: Uint8Array;
  matrixSource?: Float32Array;
  semanticSource?: Uint32Array;
}

export class WebGPUInstanceCache {
  private readonly entries = new Map<string, CachedInstanceEntry>();
  private active = new Set<string>();
  private bufferGeneration = 0;

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
        generation: ++this.bufferGeneration,
        matrixCapacity: Math.max(4, Math.ceil(matrixSize / 4) * 4),
        semanticCapacity: Math.max(4, Math.ceil(semanticSize / 4) * 4),
      };
      this.entries.set(batch.id, entry);
    }
    if (entry.matrixSource !== batch.instanceMatrices) {
      const matrixBytes = toBytes(batch.instanceMatrices);
      if (
        !entry.matrixBytes
        || !sameBytes(entry.matrixBytes, matrixBytes)
      ) {
        writeGPUData(this.device, entry.matrixBuffer, batch.instanceMatrices);
      }
      entry.matrixBytes = matrixBytes;
      entry.matrixSource = batch.instanceMatrices;
    }
    if (entry.semanticSource !== batch.semanticIndices) {
      const semanticBytes = toBytes(batch.semanticIndices);
      if (
        !entry.semanticBytes
        || !sameBytes(entry.semanticBytes, semanticBytes)
      ) {
        writeGPUData(
          this.device,
          entry.semanticBuffer,
          batch.semanticIndices,
        );
      }
      entry.semanticBytes = semanticBytes;
      entry.semanticSource = batch.semanticIndices;
    }
    entry.instanceCount = batch.semanticIds.length;
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

  get generation(): number {
    return this.bufferGeneration;
  }

  private deleteEntry(entry: WebGPUInstanceEntry): void {
    entry.matrixBuffer.destroy();
    entry.semanticBuffer.destroy();
    this.bufferGeneration += 1;
  }
}

function toBytes(data: Float32Array | Uint32Array): Uint8Array {
  return new Uint8Array(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).slice();
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
