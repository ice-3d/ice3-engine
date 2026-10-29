import {
  ICEEngineError,
  type ICEGeometry,
} from '@ice3/core';
import {
  createGPUDataBuffer,
  WEBGPU_BUFFER_USAGE,
} from './WebGPUResources.js';

export interface WebGPUGeometryEntry {
  readonly vertexBuffer: GPUBuffer;
  readonly triangleIndexBuffer: GPUBuffer;
  readonly edgeIndexBuffer: GPUBuffer | null;
  readonly semanticBuffer: GPUBuffer | null;
  readonly triangleCount: number;
  readonly edgeCount: number;
  readonly indexFormat: GPUIndexFormat;
  readonly vertexCount: number;
  readonly bytes: number;
  lastUsedFrame: number;
}

export interface WebGPUGeometryCacheOptions {
  readonly device: GPUDevice;
  readonly inactiveGraceFrames?: number;
  readonly maxBytes?: number;
}

export class WebGPUGeometryCache {
  private readonly device: GPUDevice;
  private readonly entries = new Map<ICEGeometry, WebGPUGeometryEntry>();
  private active = new Set<ICEGeometry>();
  private readonly pinned = new Set<ICEGeometry>();
  private readonly inactiveGraceFrames: number;
  private readonly maxBytes: number;
  private uploads = 0;
  private evictions = 0;
  private frameId = 0;

  constructor(options: WebGPUGeometryCacheOptions) {
    this.device = options.device;
    this.inactiveGraceFrames = options.inactiveGraceFrames ?? 60;
    this.maxBytes = options.maxBytes ?? 768 * 1024 * 1024;
    if (
      !Number.isInteger(this.inactiveGraceFrames)
      || this.inactiveGraceFrames < 0
      || !Number.isInteger(this.maxBytes)
      || this.maxBytes < 1
    ) {
      throw new Error('ICE3_GPU_CACHE_INVALID: cache options are invalid');
    }
  }

  retain(geometry: ICEGeometry): WebGPUGeometryEntry {
    this.active.add(geometry);
    const existing = this.entries.get(geometry);
    if (existing) {
      existing.lastUsedFrame = this.frameId;
      return existing;
    }

    const buffers: GPUBuffer[] = [];
    try {
      const vertexCount = geometry.positions.length / 3;
      const vertices = new Float32Array(vertexCount * 6);
      const colorStride = geometry.colors
        ? geometry.colors.length / vertexCount
        : 0;
      for (let index = 0; index < vertexCount; index += 1) {
        vertices[index * 6] = geometry.positions[index * 3]!;
        vertices[index * 6 + 1] = geometry.positions[index * 3 + 1]!;
        vertices[index * 6 + 2] = geometry.positions[index * 3 + 2]!;
        vertices[index * 6 + 3] = geometry.colors?.[index * colorStride] ?? 1;
        vertices[index * 6 + 4] =
          geometry.colors?.[index * colorStride + 1] ?? 1;
        vertices[index * 6 + 5] =
          geometry.colors?.[index * colorStride + 2] ?? 1;
      }
      const vertexBuffer = createGPUDataBuffer(
        this.device,
        vertices,
        WEBGPU_BUFFER_USAGE.vertex,
        `${geometry.typeId}:vertices`,
      );
      buffers.push(vertexBuffer);
      const triangleIndexBuffer = createGPUDataBuffer(
        this.device,
        geometry.indices,
        WEBGPU_BUFFER_USAGE.index,
        `${geometry.typeId}:triangle-indices`,
      );
      buffers.push(triangleIndexBuffer);
      const edgeIndexBuffer = geometry.edgeIndices
        ? createGPUDataBuffer(
            this.device,
            geometry.edgeIndices,
            WEBGPU_BUFFER_USAGE.index,
            `${geometry.typeId}:edge-indices`,
          )
        : null;
      if (edgeIndexBuffer) buffers.push(edgeIndexBuffer);
      const semanticBuffer = geometry.semanticIndices
        ? createGPUDataBuffer(
            this.device,
            geometry.semanticIndices,
            WEBGPU_BUFFER_USAGE.vertex,
            `${geometry.typeId}:semantic`,
          )
        : null;
      if (semanticBuffer) buffers.push(semanticBuffer);

      const entry: WebGPUGeometryEntry = {
        vertexBuffer,
        triangleIndexBuffer,
        edgeIndexBuffer,
        semanticBuffer,
        triangleCount: geometry.indices.length,
        edgeCount: geometry.edgeIndices?.length ?? 0,
        indexFormat: geometry.indices instanceof Uint16Array
          ? 'uint16'
          : 'uint32',
        vertexCount,
        bytes: buffers.reduce((sum, buffer) => sum + buffer.size, 0),
        lastUsedFrame: this.frameId,
      };
      this.entries.set(geometry, entry);
      this.uploads += buffers.length;
      return entry;
    } catch (error) {
      for (const buffer of buffers) buffer.destroy();
      if (error instanceof ICEEngineError) throw error;
      throw new ICEEngineError(
        'ICE3_GPU_RESOURCE_FAILED',
        'ICE3_GPU_RESOURCE_FAILED: geometry upload failed',
        { cause: error },
      );
    }
  }

  pin(geometry: ICEGeometry): WebGPUGeometryEntry {
    this.pinned.add(geometry);
    const entry = this.retain(geometry);
    this.enforceBudget();
    if (this.totalBytes > this.maxBytes) {
      this.pinned.delete(geometry);
      this.deleteEntry(geometry, entry);
      throw new ICEEngineError(
        'ICE3_GPU_RESOURCE_FAILED',
        'ICE3_GPU_RESOURCE_FAILED: geometry exceeds the GPU residency budget',
      );
    }
    return entry;
  }

  unpin(geometry: ICEGeometry): void {
    this.pinned.delete(geometry);
  }

  beginFrame(): void {
    this.frameId += 1;
    this.active = new Set();
  }

  endFrame(): void {
    for (const [geometry, entry] of this.entries) {
      if (this.active.has(geometry) || this.pinned.has(geometry)) continue;
      if (this.frameId - entry.lastUsedFrame < this.inactiveGraceFrames) {
        continue;
      }
      this.deleteEntry(geometry, entry);
    }
    this.enforceBudget();
  }

  clear(): void {
    for (const [geometry, entry] of this.entries) {
      this.deleteEntry(geometry, entry);
    }
    this.active.clear();
    this.pinned.clear();
  }

  dispose(): void {
    this.clear();
  }

  get totalBytes(): number {
    return [...this.entries.values()]
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  get uploadCount(): number {
    return this.uploads;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  private enforceBudget(): void {
    let total = this.totalBytes;
    if (total <= this.maxBytes) return;
    const candidates = [...this.entries]
      .filter(([geometry]) => !this.pinned.has(geometry))
      .sort((left, right) => (
        left[1].lastUsedFrame - right[1].lastUsedFrame
      ));
    for (const [geometry, entry] of candidates) {
      if (total <= this.maxBytes) break;
      this.deleteEntry(geometry, entry);
      total -= entry.bytes;
    }
  }

  private deleteEntry(
    geometry: ICEGeometry,
    entry: WebGPUGeometryEntry,
  ): void {
    entry.vertexBuffer.destroy();
    entry.triangleIndexBuffer.destroy();
    entry.edgeIndexBuffer?.destroy();
    entry.semanticBuffer?.destroy();
    this.entries.delete(geometry);
    this.evictions += 1;
  }
}
