import type {
  ICEBasicMaterial,
  ICEGeometry,
} from '@ice3/core';
import { WebGL2GeometryCache } from './WebGL2GeometryCache.js';
import type { ICEGeometryRenderable } from './WebGL2GeometryBatch.js';
import { WebGL2Program } from './WebGL2Program.js';

export type { ICEGeometryRenderable } from './WebGL2GeometryBatch.js';

export interface ICEInstanceBatch {
  readonly id: string;
  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  readonly instanceMatrices: Float32Array;
  readonly semanticIds: readonly string[];
  readonly semanticIndices: Uint32Array;
  readonly meshIds: readonly string[];
  readonly materialKey: string;
}

export interface WebGL2InstanceEntry {
  readonly vertexArray: WebGLVertexArrayObject;
  readonly matrixBuffer: WebGLBuffer;
  readonly semanticBuffer: WebGLBuffer;
  readonly triangleIndexBuffer: WebGLBuffer;
  readonly edgeIndexBuffer: WebGLBuffer | null;
  readonly triangleCount: number;
  readonly edgeCount: number;
  readonly instanceCount: number;
  readonly bytes: number;
}

export class WebGL2InstanceCache {
  private readonly entries = new Map<string, WebGL2InstanceEntry>();
  private active = new Set<string>();
  private gl: WebGL2RenderingContext | null = null;
  private fallbacks = 0;

  retain(
    gl: WebGL2RenderingContext,
    geometryCache: WebGL2GeometryCache,
    batch: ICEInstanceBatch,
  ): Readonly<WebGL2InstanceEntry> | undefined {
    this.gl = gl;
    this.active.add(batch.id);
    const geometry = geometryCache.retain(gl, batch.geometry);
    const existing = this.entries.get(batch.id);
    if (existing) {
      gl.bindBuffer(gl.ARRAY_BUFFER, existing.matrixBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        batch.instanceMatrices,
        gl.DYNAMIC_DRAW,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, existing.semanticBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        batch.semanticIndices,
        gl.DYNAMIC_DRAW,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      return existing;
    }

    const vertexArray = gl.createVertexArray();
    const matrixBuffer = gl.createBuffer();
    const semanticBuffer = gl.createBuffer();
    if (!vertexArray || !matrixBuffer || !semanticBuffer) {
      gl.deleteVertexArray(vertexArray);
      gl.deleteBuffer(matrixBuffer);
      gl.deleteBuffer(semanticBuffer);
      this.fallbacks += 1;
      return undefined;
    }
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.positionBuffer);
    gl.enableVertexAttribArray(WebGL2Program.POSITION_ATTRIBUTE);
    gl.vertexAttribPointer(
      WebGL2Program.POSITION_ATTRIBUTE,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    if (geometry.colorBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.colorBuffer);
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);

    gl.bindBuffer(gl.ARRAY_BUFFER, matrixBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.instanceMatrices, gl.DYNAMIC_DRAW);
    for (let column = 0; column < 4; column += 1) {
      const location = WebGL2Program.INSTANCE_MATRIX_ATTRIBUTE + column;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        4,
        gl.FLOAT,
        false,
        64,
        column * 16,
      );
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, semanticBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.semanticIndices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(WebGL2Program.INSTANCE_SEMANTIC_ATTRIBUTE);
    gl.vertexAttribPointer(
      WebGL2Program.INSTANCE_SEMANTIC_ATTRIBUTE,
      1,
      gl.UNSIGNED_INT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(WebGL2Program.INSTANCE_SEMANTIC_ATTRIBUTE, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const entry: WebGL2InstanceEntry = {
      vertexArray,
      matrixBuffer,
      semanticBuffer,
      triangleIndexBuffer: geometry.triangleIndexBuffer,
      edgeIndexBuffer: geometry.edgeIndexBuffer,
      triangleCount: geometry.triangleCount,
      edgeCount: geometry.edgeCount,
      instanceCount: batch.semanticIds.length,
      bytes: batch.instanceMatrices.byteLength
        + batch.semanticIndices.byteLength,
    };
    this.entries.set(batch.id, entry);
    return entry;
  }

  beginFrame(): void {
    this.active = new Set();
    this.fallbacks = 0;
  }

  endFrame(): void {
    for (const [id, entry] of this.entries) {
      if (this.active.has(id)) continue;
      this.deleteEntry(entry);
      this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
    this.active.clear();
    this.gl = null;
    this.fallbacks = 0;
  }

  dispose(): void {
    if (this.gl) {
      for (const entry of this.entries.values()) {
        this.deleteEntry(entry);
      }
    }
    this.clear();
  }

  get fallbackCount(): number {
    return this.fallbacks;
  }

  get totalBytes(): number {
    return [...this.entries.values()]
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  private deleteEntry(entry: WebGL2InstanceEntry): void {
    if (!this.gl) return;
    this.gl.deleteBuffer(entry.matrixBuffer);
    this.gl.deleteBuffer(entry.semanticBuffer);
    this.gl.deleteVertexArray(entry.vertexArray);
  }
}

export function collectInstanceBatches(
  renderables: readonly ICEGeometryRenderable[],
  output: ICEInstanceBatch[] = [],
): readonly ICEInstanceBatch[] {
  output.length = 0;
  const byGeometry = new Map<
    ICEGeometry,
    Map<ICEBasicMaterial, ICEGeometryRenderable[]>
  >();
  for (const renderable of renderables) {
    const byMaterial = byGeometry.get(renderable.mesh.geometry)
      ?? new Map<ICEBasicMaterial, ICEGeometryRenderable[]>();
    const group = byMaterial.get(renderable.mesh.material) ?? [];
    group.push(renderable);
    byMaterial.set(renderable.mesh.material, group);
    byGeometry.set(renderable.mesh.geometry, byMaterial);
  }
  for (const [geometry, byMaterial] of byGeometry) {
    for (const [material, group] of byMaterial) {
      if (group.length < 2) continue;
      const instanceMatrices = new Float32Array(group.length * 16);
      const semanticIndices = new Uint32Array(group.length);
      for (let index = 0; index < group.length; index += 1) {
        instanceMatrices.set(group[index]!.worldMatrix, index * 16);
        semanticIndices[index] = index;
      }
      output.push({
        id: `instance:${group[0]!.id}`,
        geometry,
        material,
        instanceMatrices,
        semanticIds: group.map((renderable) => renderable.mesh.selectionId),
        semanticIndices,
        meshIds: group.map((renderable) => renderable.id),
        materialKey: `${material.color}:${material.edgeColor ?? ''}`,
      });
    }
  }
  return output;
}
