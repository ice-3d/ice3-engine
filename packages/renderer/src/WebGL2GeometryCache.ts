import type {
  ICEGeometry,
  ICEGeometryBufferUpdate,
} from '@ice3/core';
import { WebGL2Program } from './WebGL2Program.js';

export interface GeometryEntry {
  geometry: ICEGeometry;
  readonly geometryId: string;
  readonly attributeDigest: string;
  readonly topologyDigest: string;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly positionBuffer: WebGLBuffer;
  readonly triangleIndexBuffer: WebGLBuffer;
  readonly edgeIndexBuffer: WebGLBuffer | null;
  readonly colorBuffer: WebGLBuffer | null;
  readonly semanticBuffer: WebGLBuffer | null;
  readonly triangleCount: number;
  readonly edgeCount: number;
  readonly bytes: number;
  lastUsedFrame: number;
}

export interface WebGL2GeometryCacheOptions {
  readonly inactiveGraceFrames?: number;
  readonly maxBytes?: number;
}

export class WebGL2GeometryCache {
  private readonly entries = new Map<string, GeometryEntry>();
  private active = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly objectKeys = new WeakMap<object, string>();
  private readonly legacyKeys = new WeakMap<object, string>();
  private objectKeySequence = 0;
  private gl: WebGL2RenderingContext | null = null;
  private uploads = 0;
  private updatedBytes = 0;
  private evictions = 0;
  private frameId = 0;
  private readonly inactiveGraceFrames: number;
  private readonly maxBytes: number;

  constructor(options: WebGL2GeometryCacheOptions = {}) {
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

  retain(
    gl: WebGL2RenderingContext,
    geometry: ICEGeometry,
  ): Readonly<GeometryEntry> {
    this.gl = gl;
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

    const next = this.createEntry(gl, geometry, key);
    if (existing) {
      this.deleteEntry(existing, false);
    }
    this.entries.set(key, next);
    this.uploads += 1;
    return next;
  }

  private createEntry(
    gl: WebGL2RenderingContext,
    geometry: ICEGeometry,
    key: string,
  ): GeometryEntry {
    const vertexArray = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const triangleIndexBuffer = gl.createBuffer();
    const edgeIndexBuffer = geometry.edgeIndices ? gl.createBuffer() : null;
    const colorBuffer = geometry.colors ? gl.createBuffer() : null;
    const semanticBuffer = geometry.semanticIndices ? gl.createBuffer() : null;
    if (
      !vertexArray
      || !positionBuffer
      || !triangleIndexBuffer
      || (geometry.edgeIndices && !edgeIndexBuffer)
      || (geometry.colors && !colorBuffer)
      || (geometry.semanticIndices && !semanticBuffer)
    ) {
      gl.deleteVertexArray(vertexArray);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(triangleIndexBuffer);
      gl.deleteBuffer(edgeIndexBuffer);
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(semanticBuffer);
      throw new Error('ICE3_GPU_RESOURCE_FAILED: geometry buffers are unavailable');
    }
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(WebGL2Program.POSITION_ATTRIBUTE);
    gl.vertexAttribPointer(
      WebGL2Program.POSITION_ATTRIBUTE,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    if (colorBuffer && geometry.colors) {
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.colors, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(WebGL2Program.COLOR_ATTRIBUTE);
      gl.vertexAttribPointer(
        WebGL2Program.COLOR_ATTRIBUTE,
        3,
        gl.FLOAT,
        false,
        0,
        0,
      );
    }
    if (semanticBuffer && geometry.semanticIndices) {
      gl.bindBuffer(gl.ARRAY_BUFFER, semanticBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.semanticIndices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.UNSIGNED_INT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangleIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
    if (edgeIndexBuffer && geometry.edgeIndices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        geometry.edgeIndices,
        gl.STATIC_DRAW,
      );
    }
    gl.bindVertexArray(null);

    const entry: GeometryEntry = {
      geometry,
      geometryId: geometry.identity?.geometryId ?? key,
      attributeDigest: geometry.identity?.attributeDigest ?? '',
      topologyDigest: geometry.identity?.topologyDigest ?? '',
      vertexArray,
      positionBuffer,
      triangleIndexBuffer,
      edgeIndexBuffer,
      colorBuffer,
      semanticBuffer,
      triangleCount: geometry.indices.length,
      edgeCount: geometry.edgeIndices?.length ?? 0,
      bytes:
        geometry.positions.byteLength
        + geometry.indices.byteLength
        + (geometry.edgeIndices?.byteLength ?? 0)
        + (geometry.colors?.byteLength ?? 0)
        + (geometry.semanticIndices?.byteLength ?? 0),
      lastUsedFrame: this.frameId,
    };
    return entry;
  }

  beginFrame(): void {
    this.frameId += 1;
    this.active = new Set();
  }

  pin(
    gl: WebGL2RenderingContext,
    geometry: ICEGeometry,
    update?: ICEGeometryBufferUpdate,
  ): Readonly<GeometryEntry> {
    const key = this.keyFor(geometry);
    this.pinned.add(key);
    const existing = this.entries.get(key);
    if (existing && update && this.sameTopology(existing, geometry)) {
      this.gl = gl;
      this.applyPositionUpdate(gl, existing, geometry, update);
      return existing;
    }
    const entry = this.retain(gl, geometry);
    this.enforceBudget();
    if (this.totalBytes > this.maxBytes) {
      this.pinned.delete(key);
      this.deleteEntry(entry, false);
      this.entries.delete(key);
      throw new Error(
        'ICE3_GPU_RESOURCE_FAILED: geometry exceeds the GPU residency budget',
      );
    }
    return entry;
  }

  unpin(geometry: ICEGeometry): void {
    this.pinned.delete(this.keyFor(geometry));
  }

  endFrame(): void {
    for (const [geometry, entry] of this.entries) {
      if (this.active.has(geometry) || this.pinned.has(geometry)) {
        continue;
      }
      if (
        this.frameId - entry.lastUsedFrame
        < this.inactiveGraceFrames
      ) {
        continue;
      }
      this.deleteEntry(entry);
      this.entries.delete(geometry);
    }
    this.enforceBudget();
  }

  clear(): void {
    this.entries.clear();
    this.active.clear();
    this.pinned.clear();
    this.gl = null;
  }

  dispose(): void {
    if (this.gl) {
      for (const entry of this.entries.values()) {
        this.deleteEntry(entry);
      }
    }
    this.clear();
  }

  get totalBytes(): number {
    return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
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

  private deleteEntry(
    entry: GeometryEntry,
    eviction = true,
  ): void {
    if (!this.gl) return;
    this.gl.deleteBuffer(entry.positionBuffer);
    this.gl.deleteBuffer(entry.triangleIndexBuffer);
    this.gl.deleteBuffer(entry.edgeIndexBuffer);
    this.gl.deleteBuffer(entry.colorBuffer);
    this.gl.deleteBuffer(entry.semanticBuffer);
    this.gl.deleteVertexArray(entry.vertexArray);
    if (eviction) {
      this.evictions += 1;
    }
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
      this.entries.delete(geometry);
      total -= entry.bytes;
    }
  }

  private applyPositionUpdate(
    gl: WebGL2RenderingContext,
    entry: GeometryEntry,
    geometry: ICEGeometry,
    update: ICEGeometryBufferUpdate,
  ): void {
    let updated = 0;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positionBuffer);
      for (const range of update.positionRanges) {
        if (
          range.byteOffset % 4 !== 0
          || range.byteLength % 4 !== 0
          || range.byteOffset + range.byteLength > geometry.positions.byteLength
        ) {
          throw new Error('invalid position range');
        }
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          range.byteOffset,
          new Uint8Array(
            geometry.positions.buffer,
            geometry.positions.byteOffset + range.byteOffset,
            range.byteLength,
          ),
        );
        updated += range.byteLength;
      }
    } catch (error) {
      throw new Error('ICE3_GPU_RESOURCE_FAILED: geometry update failed', {
        cause: error,
      });
    }
    entry.geometry = geometry;
    entry.lastUsedFrame = this.frameId;
    this.updatedBytes += updated;
  }

  private canReuse(existing: GeometryEntry, geometry: ICEGeometry): boolean {
    if (existing.geometry === geometry) {
      return true;
    }
    if (!this.sameTopology(existing, geometry)) {
      return false;
    }
    const existingDigest = existing.attributeDigest;
    const nextDigest = geometry.identity?.attributeDigest ?? '';
    return (
      existing.geometry.positions === geometry.positions
      && existing.geometry.colors === geometry.colors
      && existing.geometry.semanticIndices === geometry.semanticIndices
    ) || (existingDigest !== '' && existingDigest === nextDigest);
  }

  private sameTopology(existing: GeometryEntry, geometry: ICEGeometry): boolean {
    const existingDigest = existing.topologyDigest;
    const nextDigest = geometry.identity?.topologyDigest ?? '';
    return (
      existing.geometry.indices.constructor === geometry.indices.constructor
      && existing.geometry.indices.length === geometry.indices.length
      && (
        existing.geometry.indices === geometry.indices
        || (existingDigest !== '' && existingDigest === nextDigest)
        || equalTypedArrays(existing.geometry.indices, geometry.indices)
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

function equalTypedArrays(
  left: Uint16Array | Uint32Array,
  right: Uint16Array | Uint32Array,
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
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
