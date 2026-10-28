import type { ICEGeometry } from '@ice3/core';
import { WebGL2Program } from './WebGL2Program.js';

export interface GeometryEntry {
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
  private readonly entries = new Map<ICEGeometry, GeometryEntry>();
  private active = new Set<ICEGeometry>();
  private readonly pinned = new Set<ICEGeometry>();
  private gl: WebGL2RenderingContext | null = null;
  private uploads = 0;
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
    this.active.add(geometry);
    const existing = this.entries.get(geometry);
    if (existing) {
      existing.lastUsedFrame = this.frameId;
      return existing;
    }

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
    this.entries.set(geometry, entry);
    this.uploads += 1;
    return entry;
  }

  beginFrame(): void {
    this.frameId += 1;
    this.active = new Set();
  }

  pin(
    gl: WebGL2RenderingContext,
    geometry: ICEGeometry,
  ): Readonly<GeometryEntry> {
    this.pinned.add(geometry);
    return this.retain(gl, geometry);
  }

  unpin(geometry: ICEGeometry): void {
    this.pinned.delete(geometry);
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

  get evictionCount(): number {
    return this.evictions;
  }

  private deleteEntry(
    entry: GeometryEntry,
  ): void {
    if (!this.gl) return;
    this.gl.deleteBuffer(entry.positionBuffer);
    this.gl.deleteBuffer(entry.triangleIndexBuffer);
    this.gl.deleteBuffer(entry.edgeIndexBuffer);
    this.gl.deleteBuffer(entry.colorBuffer);
    this.gl.deleteBuffer(entry.semanticBuffer);
    this.gl.deleteVertexArray(entry.vertexArray);
    this.evictions += 1;
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
}
