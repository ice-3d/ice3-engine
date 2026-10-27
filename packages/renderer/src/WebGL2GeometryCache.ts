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
}

export class WebGL2GeometryCache {
  private readonly entries = new Map<ICEGeometry, GeometryEntry>();
  private active = new Set<ICEGeometry>();
  private gl: WebGL2RenderingContext | null = null;

  retain(
    gl: WebGL2RenderingContext,
    geometry: ICEGeometry,
  ): Readonly<GeometryEntry> {
    this.gl = gl;
    this.active.add(geometry);
    const existing = this.entries.get(geometry);
    if (existing) {
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
    };
    this.entries.set(geometry, entry);
    return entry;
  }

  beginFrame(): void {
    this.active = new Set();
  }

  endFrame(): void {
    for (const [geometry, entry] of this.entries) {
      if (this.active.has(geometry)) {
        continue;
      }
      this.deleteEntry(entry);
      this.entries.delete(geometry);
    }
  }

  clear(): void {
    this.entries.clear();
    this.active.clear();
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
  }
}
