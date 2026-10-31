import {
  ICEEngineError,
  type ICEGeometry,
  type ICEGeometryBufferUpdate,
} from '@ice3/core';
import {
  createGPUDataBuffer,
  WEBGPU_BUFFER_USAGE,
} from './WebGPUResources.js';

export interface WebGPUGeometryEntry {
  geometry: ICEGeometry;
  readonly geometryId: string;
  readonly attributeDigest: string;
  readonly topologyDigest: string;
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
  private readonly entries = new Map<string, WebGPUGeometryEntry>();
  private active = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly objectKeys = new WeakMap<object, string>();
  private readonly legacyKeys = new WeakMap<object, string>();
  private objectKeySequence = 0;
  private readonly inactiveGraceFrames: number;
  private readonly maxBytes: number;
  private uploads = 0;
  private updatedBytes = 0;
  private evictions = 0;
  private frameId = 0;
  private resourceGeneration = 0;

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
    const key = this.keyFor(geometry);
    this.active.add(key);
    const existing = this.entries.get(key);
    if (existing) {
      if (
        this.canReuse(existing, geometry)
        || (!existing.geometry.identity && !geometry.identity)
      ) {
        existing.lastUsedFrame = this.frameId;
        return existing;
      }
    }

    const next = this.createEntry(geometry, key);
    if (existing) {
      this.deleteEntry(existing, false);
    }
    this.entries.set(key, next);
    return next;
  }

  private createEntry(
    geometry: ICEGeometry,
    key: string,
  ): WebGPUGeometryEntry {
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
        geometry,
        geometryId: geometry.identity?.geometryId ?? key,
        attributeDigest: geometry.identity?.attributeDigest ?? '',
        topologyDigest: geometry.identity?.topologyDigest ?? '',
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
      this.uploads += buffers.length;
      this.resourceGeneration += 1;
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

  pin(
    geometry: ICEGeometry,
    update?: ICEGeometryBufferUpdate,
  ): WebGPUGeometryEntry {
    const key = this.keyFor(geometry);
    this.pinned.add(key);
    const existing = this.entries.get(key);
    if (existing && update && this.sameTopology(existing, geometry)) {
      this.applyPositionUpdate(existing, geometry, update);
      return existing;
    }
    const entry = this.retain(geometry);
    this.enforceBudget();
    if (this.totalBytes > this.maxBytes) {
      this.pinned.delete(key);
      this.deleteEntry(entry);
      throw new ICEEngineError(
        'ICE3_GPU_RESOURCE_FAILED',
        'ICE3_GPU_RESOURCE_FAILED: geometry exceeds the GPU residency budget',
      );
    }
    return entry;
  }

  unpin(geometry: ICEGeometry): void {
    this.pinned.delete(this.keyFor(geometry));
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
      this.deleteEntry(entry);
    }
    this.enforceBudget();
  }

  clear(): void {
    for (const [geometry, entry] of this.entries) {
      this.deleteEntry(entry);
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

  get updateBytes(): number {
    return this.updatedBytes;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  get generation(): number {
    return this.resourceGeneration;
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
      this.deleteEntry(entry);
      total -= entry.bytes;
    }
  }

  private deleteEntry(entry: WebGPUGeometryEntry, eviction = true): void {
    entry.vertexBuffer.destroy();
    entry.triangleIndexBuffer.destroy();
    entry.edgeIndexBuffer?.destroy();
    entry.semanticBuffer?.destroy();
    for (const [key, candidate] of this.entries) {
      if (candidate === entry) {
        this.entries.delete(key);
        break;
      }
    }
    if (eviction) {
      this.evictions += 1;
    }
    this.resourceGeneration += 1;
  }

  private applyPositionUpdate(
    entry: WebGPUGeometryEntry,
    geometry: ICEGeometry,
    update: ICEGeometryBufferUpdate,
  ): void {
    let updated = 0;
    try {
      for (const range of update.positionRanges) {
        if (
          range.byteOffset % 12 !== 0
          || range.byteLength % 12 !== 0
          || range.byteOffset + range.byteLength > geometry.positions.byteLength
        ) {
          throw new Error('invalid position range');
        }
        const vertexOffset = range.byteOffset / 12;
        const vertexCount = range.byteLength / 12;
        const vertices = new Float32Array(vertexCount * 6);
        const totalVertices = geometry.positions.length / 3;
        const colorStride = geometry.colors
          ? geometry.colors.length / totalVertices
          : 0;
        for (let index = 0; index < vertexCount; index += 1) {
          const sourceVertex = vertexOffset + index;
          vertices[index * 6] = geometry.positions[sourceVertex * 3]!;
          vertices[index * 6 + 1] = geometry.positions[sourceVertex * 3 + 1]!;
          vertices[index * 6 + 2] = geometry.positions[sourceVertex * 3 + 2]!;
          vertices[index * 6 + 3] =
            geometry.colors?.[sourceVertex * colorStride] ?? 1;
          vertices[index * 6 + 4] =
            geometry.colors?.[sourceVertex * colorStride + 1] ?? 1;
          vertices[index * 6 + 5] =
            geometry.colors?.[sourceVertex * colorStride + 2] ?? 1;
        }
        this.device.queue.writeBuffer(
          entry.vertexBuffer,
          range.byteOffset * 2,
          vertices,
        );
        updated += range.byteLength;
      }
    } catch (error) {
      throw new ICEEngineError(
        'ICE3_GPU_RESOURCE_FAILED',
        'ICE3_GPU_RESOURCE_FAILED: geometry update failed',
        { cause: error },
      );
    }
    entry.geometry = geometry;
    entry.lastUsedFrame = this.frameId;
    this.updatedBytes += updated;
  }

  private canReuse(
    existing: WebGPUGeometryEntry,
    geometry: ICEGeometry,
  ): boolean {
    if (existing.geometry === geometry) {
      return true;
    }
    if (!this.sameTopology(existing, geometry)) {
      return false;
    }
    return (
      existing.geometry.positions === geometry.positions
      && existing.geometry.colors === geometry.colors
      && existing.geometry.semanticIndices === geometry.semanticIndices
    ) || (
      existing.attributeDigest !== ''
      && existing.attributeDigest === geometry.identity?.attributeDigest
    );
  }

  private sameTopology(
    existing: WebGPUGeometryEntry,
    geometry: ICEGeometry,
  ): boolean {
    return (
      existing.geometry.indices.constructor === geometry.indices.constructor
      && existing.geometry.indices.length === geometry.indices.length
      && (
        existing.geometry.indices === geometry.indices
        || (
          existing.topologyDigest !== ''
          && existing.topologyDigest === geometry.identity?.topologyDigest
        )
      )
    );
  }

  private keyFor(geometry: ICEGeometry): string {
    const identity = geometry.identity?.geometryId;
    if (identity) {
      return `identity:${identity}`;
    }
    const id = (geometry as ICEGeometry & { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) {
      const cached = this.legacyKeys.get(geometry);
      if (cached) return cached;
      const key = [
        'content',
        geometry.positions.length,
        geometry.indices.length,
        contentFingerprint(geometry.positions),
        contentFingerprint(geometry.indices),
        geometry.colors ? contentFingerprint(geometry.colors) : 0,
        geometry.edgeIndices ? contentFingerprint(geometry.edgeIndices) : 0,
        geometry.semanticIndices
          ? contentFingerprint(geometry.semanticIndices)
          : 0,
      ].join(':');
      this.legacyKeys.set(geometry, key);
      return key;
    }
    const existing = this.objectKeys.get(geometry);
    if (existing) {
      return existing;
    }
    const key = `object:${this.objectKeySequence}`;
    this.objectKeySequence += 1;
    this.objectKeys.set(geometry, key);
    return key;
  }
}

function contentFingerprint(
  values: Uint16Array | Uint32Array | Float32Array,
): number {
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  );
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
