import {
  ICEEngineError,
  ICEMatrix4,
  type ICEGeometry,
} from '@ice3/core';
import {
  collectRenderables,
  selectionIdentity,
  type ICEGeometryRenderable,
} from './WebGL2GeometryBatch.js';
import {
  collectRenderBatches,
  type ICERenderBatchDraw,
} from './WebGL2RenderBatch.js';
import {
  collectInstanceBatches,
  WebGL2InstanceCache,
  type ICEInstanceBatch,
} from './WebGL2InstanceBatch.js';
import { WebGL2GeometryCache } from './WebGL2GeometryCache.js';
import { WebGL2Picker } from './WebGL2Picker.js';
import { WebGL2Program } from './WebGL2Program.js';
import { WebGL2SemanticProgram } from './WebGL2SemanticProgram.js';
import { colorToRgba } from './Color.js';
import {
  RendererProfiler,
  type ICEFrameStageProfile,
} from './RendererProfiler.js';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEScreenPoint,
  ICEViewport,
} from './types.js';

const EDGE_PIXEL_OFFSETS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const SELECTION_RGBA = [255 / 255, 208 / 255, 0] as const;
const SELECTION_TINT_ALPHA = 0.65;
export { colorToRgba } from './Color.js';

export class WebGL2RendererBackend implements ICERendererBackend {
  capabilities: Readonly<ICERendererCapabilities> = {
    backend: 'webgl2',
    maxTextureSize: 0,
    picking: true,
  };

  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private viewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  private dpr = 1;
  private onContextLost: (() => void) | undefined;
  private onContextRestored: (() => void) | undefined;
  private program: WebGL2Program | null = null;
  private semanticProgram: WebGL2SemanticProgram | null = null;
  private geometryCache: WebGL2GeometryCache | null = null;
  private instanceCache: WebGL2InstanceCache | null = null;
  private picker: WebGL2Picker | null = null;
  private readonly mvpScratch = new ICEMatrix4();
  private readonly worldScratch = new ICEMatrix4();
  private readonly renderablesScratch: ICEGeometryRenderable[] = [];
  private readonly batchesScratch: ICERenderBatchDraw[] = [];
  private readonly instancesScratch: ICEInstanceBatch[] = [];
  private readonly instancedMeshIds = new Set<string>();
  private readonly profiler = new RendererProfiler();
  private lastFrameProfile: ICEFrameStageProfile | null = null;
  private backgroundRgba: readonly [number, number, number, number] = [
    0.035,
    0.055,
    0.09,
    1,
  ];
  private frameStats = {
    drawCalls: 0,
    renderedMeshes: 0,
    renderedBatches: 0,
    instancingFallbacks: 0,
    gpuUploads: 0,
    gpuEvictions: 0,
    gpuBytes: 0,
  };
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.picker = null;
    this.program = null;
    this.geometryCache?.clear();
    this.geometryCache = null;
    this.instanceCache?.clear();
    this.instanceCache = null;
    this.onContextLost?.();
  };
  private readonly handleContextRestored = (): void => {
    if (this.gl) {
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.depthFunc(this.gl.LEQUAL);
      this.gl.enable(this.gl.POLYGON_OFFSET_FILL);
      this.gl.polygonOffset(2, 4);
      this.gl.viewport(
        this.viewport.x * this.dpr,
        this.viewport.y * this.dpr,
        this.viewport.width * this.dpr,
        this.viewport.height * this.dpr,
      );
      this.createProgram(this.gl);
    }
    this.onContextRestored?.();
  };

  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  }): void {
    const gl = options.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new ICEEngineError(
        'ICE3_WEBGL2_UNAVAILABLE',
        'ICE3_WEBGL2_UNAVAILABLE: ICE3 requires a WebGL2-capable canvas',
      );
    }

    this.canvas = options.canvas;
    this.gl = gl;
    this.onContextLost = options.onContextLost;
    this.onContextRestored = options.onContextRestored;
    this.capabilities = {
      backend: 'webgl2',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      picking: true,
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    this.createProgram(gl);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  resize(viewport: ICEViewport, dpr: number): void {
    if (!this.canvas || !this.gl) {
      throw new ICEEngineError('ICE3_ENGINE_NOT_READY', 'Renderer is not initialized');
    }
    this.viewport = { ...viewport };
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(viewport.width * dpr));
    this.canvas.height = Math.max(1, Math.round(viewport.height * dpr));
    this.gl.viewport(
      viewport.x * dpr,
      viewport.y * dpr,
      viewport.width * dpr,
      viewport.height * dpr,
    );
  }

  setBackgroundColor(color: string): void {
    this.backgroundRgba = colorToRgba(color);
  }

  prepareBatchGeometry(geometry: ICEGeometry): void {
    if (!this.gl || !this.geometryCache) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer is not initialized',
      );
    }
    this.geometryCache.pin(this.gl, geometry);
  }

  releaseBatchGeometry(geometry: ICEGeometry): void {
    this.geometryCache?.unpin(geometry);
  }

  render(frame: ICEFrame): void {
    if (
      !this.gl
      || !this.program
      || !this.geometryCache
    ) {
      throw new ICEEngineError('ICE3_ENGINE_NOT_READY', 'Renderer is not initialized');
    }
    this.profiler.begin();
    this.lastFrameProfile = null;
    const gl = this.gl;
    gl.clearColor(...this.backgroundRgba);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const mvp = this.mvpScratch;
    this.frameStats = {
      drawCalls: 0,
      renderedMeshes: 0,
      renderedBatches: 0,
      instancingFallbacks: 0,
      gpuUploads: 0,
      gpuEvictions: 0,
      gpuBytes: 0,
    };

    this.program.use();
    this.program.setClipOffset(0, 0);
    this.geometryCache.beginFrame();
    this.instanceCache!.beginFrame();
    this.instancedMeshIds.clear();
    const world = this.worldScratch;
    const clipPixelX = 2 / Math.max(1, frame.viewport.width * frame.dpr);
    const clipPixelY = 2 / Math.max(1, frame.viewport.height * frame.dpr);
    const renderables = collectRenderables(
      frame.scene,
      this.renderablesScratch,
    );
    const instances = collectInstanceBatches(
      renderables,
      this.instancesScratch,
    );
    const batches = collectRenderBatches(frame.scene, this.batchesScratch);
    this.profiler.mark('collect');
    this.program.setInstancing(true);
    this.profiler.mark('prepareAndUpload');
    for (const batch of instances) {
      const instance = this.instanceCache!.retain(
        gl,
        this.geometryCache,
        batch,
      );
      if (!instance) continue;
      for (const id of batch.meshIds) this.instancedMeshIds.add(id);
      mvp.elements.set(viewProjection.elements);
      this.program.setMatrix(mvp);
      this.program.setColor(colorToRgba(batch.material.color));
      this.program.setVertexColors(Boolean(batch.geometry.colors));
      gl.bindVertexArray(instance.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, instance.triangleIndexBuffer);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        instance.triangleCount,
        batch.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
        instance.instanceCount,
      );
      this.frameStats.drawCalls += 1;
      if (batch.material.edgeColor && instance.edgeCount > 0) {
        this.program.setVertexColors(false);
        this.program.setColor(colorToRgba(batch.material.edgeColor));
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, instance.edgeIndexBuffer);
        for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
          this.program.setClipOffset(
            offsetX * clipPixelX,
            offsetY * clipPixelY,
          );
          gl.drawElementsInstanced(
            gl.LINES,
            instance.edgeCount,
            batch.geometry.edgeIndices instanceof Uint16Array
              ? gl.UNSIGNED_SHORT
              : gl.UNSIGNED_INT,
            0,
            instance.instanceCount,
          );
          this.frameStats.drawCalls += 1;
        }
      }
    }
    this.program.setInstancing(false);
    this.program.setClipOffset(0, 0);
    for (const draw of batches) {
      this.program.setClipOffset(0, 0);
      mvp.elements.set(viewProjection.elements);
      world.elements.set(draw.worldMatrix);
      mvp.multiply(world);
      this.program.setMatrix(mvp);
      this.program.setColor(colorToRgba(draw.batch.material.color));
      const geometry = this.geometryCache.retain(gl, draw.batch.geometry);
      this.program.setVertexColors(Boolean(draw.batch.geometry.colors));
      gl.bindVertexArray(geometry.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        geometry.triangleCount,
        draw.batch.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
      this.frameStats.drawCalls += 1;
      this.frameStats.renderedBatches += 1;
      if (draw.batch.material.edgeColor) {
        this.program.setVertexColors(false);
        this.program.setColor(colorToRgba(draw.batch.material.edgeColor));
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.edgeIndexBuffer);
        for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
          this.program.setClipOffset(
            offsetX * clipPixelX,
            offsetY * clipPixelY,
          );
          gl.drawElements(
            gl.LINES,
            geometry.edgeCount,
            draw.batch.geometry.edgeIndices instanceof Uint16Array
              ? gl.UNSIGNED_SHORT
              : gl.UNSIGNED_INT,
            0,
          );
          this.frameStats.drawCalls += 1;
        }
      }
    }
    for (const renderable of renderables) {
      if (this.instancedMeshIds.has(renderable.id)) continue;
      this.program.setClipOffset(0, 0);
      mvp.elements.set(viewProjection.elements);
      world.elements.set(renderable.worldMatrix);
      mvp.multiply(world);
      this.program.setMatrix(mvp);
      this.program.setColor(colorToRgba(renderable.mesh.material.color));
      const geometry = this.geometryCache.retain(gl, renderable.mesh.geometry);
      this.program.setVertexColors(Boolean(renderable.mesh.geometry.colors));
      gl.bindVertexArray(geometry.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        geometry.triangleCount,
        renderable.mesh.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
      this.frameStats.drawCalls += 1;
      if (renderable.mesh.material.edgeColor) {
        this.program.setVertexColors(false);
        this.program.setColor(
          colorToRgba(renderable.mesh.material.edgeColor),
        );
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.edgeIndexBuffer);
        for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
          this.program.setClipOffset(
            offsetX * clipPixelX,
            offsetY * clipPixelY,
          );
          gl.drawElements(
            gl.LINES,
            geometry.edgeCount,
            renderable.mesh.geometry.edgeIndices instanceof Uint16Array
              ? gl.UNSIGNED_SHORT
              : gl.UNSIGNED_INT,
            0,
          );
          this.frameStats.drawCalls += 1;
        }
      }
      this.frameStats.renderedMeshes += 1;
    }
    if (frame.selection.length > 0) {
      const selected = new Set(frame.selection);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.program.setVertexColors(false);
      this.program.setColor([
        SELECTION_RGBA[0],
        SELECTION_RGBA[1],
        SELECTION_RGBA[2],
        SELECTION_TINT_ALPHA,
      ]);
      for (const renderable of renderables) {
        if (this.instancedMeshIds.has(renderable.id)) continue;
        if (!selected.has(selectionIdentity(renderable.mesh))) continue;
        mvp.elements.set(viewProjection.elements);
        world.elements.set(renderable.worldMatrix);
        mvp.multiply(world);
        this.program.setMatrix(mvp);
        this.program.setClipOffset(0, 0);
        const geometry = this.geometryCache.retain(gl, renderable.mesh.geometry);
        gl.bindVertexArray(geometry.vertexArray);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
        gl.drawElements(
          gl.TRIANGLES,
          geometry.triangleCount,
          renderable.mesh.geometry.indices instanceof Uint16Array
            ? gl.UNSIGNED_SHORT
            : gl.UNSIGNED_INT,
          0,
        );
      }
      this.program.setColor([
        SELECTION_RGBA[0],
        SELECTION_RGBA[1],
        SELECTION_RGBA[2],
        1,
      ]);
      for (const renderable of renderables) {
        if (this.instancedMeshIds.has(renderable.id)) continue;
        if (!selected.has(selectionIdentity(renderable.mesh))) continue;
        const geometry = this.geometryCache.retain(gl, renderable.mesh.geometry);
        if (!geometry.edgeIndexBuffer || !renderable.mesh.geometry.edgeIndices) {
          continue;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.edgeIndexBuffer);
        for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
          this.program.setClipOffset(
            offsetX * clipPixelX,
            offsetY * clipPixelY,
          );
          gl.drawElements(
            gl.LINES,
            geometry.edgeCount,
            renderable.mesh.geometry.edgeIndices instanceof Uint16Array
              ? gl.UNSIGNED_SHORT
              : gl.UNSIGNED_INT,
            0,
          );
        }
      }
      if (this.semanticProgram) {
        this.semanticProgram.use();
        this.semanticProgram.setInstancing(false);
        for (const draw of batches) {
          for (
            let semanticIndex = 0;
            semanticIndex < draw.batch.semanticSelectionIds.length;
            semanticIndex += 1
          ) {
            if (!selected.has(
              draw.batch.semanticSelectionIds[semanticIndex]!,
            )) {
              continue;
            }
            mvp.elements.set(viewProjection.elements);
            world.elements.set(draw.worldMatrix);
            mvp.multiply(world);
            this.semanticProgram.setMatrix(mvp);
            this.semanticProgram.setHighlight(semanticIndex);
            const geometry = this.geometryCache.retain(
              gl,
              draw.batch.geometry,
            );
            gl.bindVertexArray(geometry.vertexArray);
            gl.bindBuffer(
              gl.ELEMENT_ARRAY_BUFFER,
              geometry.triangleIndexBuffer,
            );
            gl.drawElements(
              gl.TRIANGLES,
              geometry.triangleCount,
              draw.batch.geometry.indices instanceof Uint16Array
                ? gl.UNSIGNED_SHORT
                : gl.UNSIGNED_INT,
              0,
            );
          }
        }
        this.semanticProgram.setInstancing(true);
        mvp.elements.set(viewProjection.elements);
        this.semanticProgram.setMatrix(mvp);
        for (const batch of instances) {
          const instance = this.instanceCache!.retain(
            gl,
            this.geometryCache,
            batch,
          );
          if (!instance) continue;
          for (
            let semanticIndex = 0;
            semanticIndex < batch.semanticIds.length;
            semanticIndex += 1
          ) {
            if (!selected.has(batch.semanticIds[semanticIndex]!)) continue;
            this.semanticProgram.setHighlight(semanticIndex);
            gl.bindVertexArray(instance.vertexArray);
            gl.drawElementsInstanced(
              gl.TRIANGLES,
              instance.triangleCount,
              batch.geometry.indices instanceof Uint16Array
                ? gl.UNSIGNED_SHORT
                : gl.UNSIGNED_INT,
              0,
              instance.instanceCount,
            );
          }
        }
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.program.use();
      this.program.setClipOffset(0, 0);
    }
    gl.bindVertexArray(null);
    this.geometryCache.endFrame();
    this.instanceCache!.endFrame();
    this.frameStats.instancingFallbacks = this.instanceCache!.fallbackCount;
    this.frameStats.gpuUploads = this.geometryCache.uploadCount;
    this.frameStats.gpuEvictions = this.geometryCache.evictionCount;
    this.frameStats.gpuBytes = this.geometryCache.totalBytes
      + this.instanceCache!.totalBytes;
    this.profiler.mark('encode');
    this.profiler.mark('submit');
    this.lastFrameProfile = this.profiler.end();
  }

  enableProfiling(enabled: boolean): void {
    this.profiler.enable(enabled);
    this.lastFrameProfile = null;
  }

  get frameProfile(): ICEFrameStageProfile | null {
    return this.lastFrameProfile;
  }

  async pick(
    frame: ICEFrame,
    point: ICEScreenPoint,
  ): Promise<string | undefined> {
    if (!this.picker || !this.geometryCache) {
      throw new ICEEngineError(
        'ICE3_PICK_UNAVAILABLE',
        'ICE3_PICK_UNAVAILABLE: picker is not initialized',
      );
    }
    const renderables = collectRenderables(
      frame.scene,
      this.renderablesScratch,
    );
    return this.picker.pick(
      { ...frame, point },
      this.geometryCache,
      renderables,
      collectRenderBatches(frame.scene, this.batchesScratch),
      collectInstanceBatches(
        renderables,
        this.instancesScratch,
      ),
      this.instanceCache!,
    );
  }

  async capture(): Promise<Blob> {
    if (!this.canvas) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer is not initialized',
      );
    }
    return new Promise<Blob>((resolve, reject) => {
      this.canvas!.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('ICE3_CAPTURE_UNAVAILABLE: PNG encoding failed'));
      }, 'image/png');
    });
  }

  async finish(): Promise<void> {
    this.gl?.finish();
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener(
        'webglcontextrestored',
        this.handleContextRestored,
      );
    }
    if (this.program) {
      this.program.dispose();
    }
    this.semanticProgram?.dispose();
    this.picker?.dispose();
    this.geometryCache?.dispose();
    this.instanceCache?.dispose();
    this.program = null;
    this.semanticProgram = null;
    this.geometryCache = null;
    this.instanceCache = null;
    this.picker = null;
    this.canvas = null;
    this.gl = null;
    this.onContextLost = undefined;
    this.onContextRestored = undefined;
  }

  getViewport(): ICEViewport {
    return { ...this.viewport };
  }

  getDevicePixelRatio(): number {
    return this.dpr;
  }

  get stats(): Readonly<typeof this.frameStats> {
    return this.frameStats;
  }

  private createProgram(gl: WebGL2RenderingContext): void {
    const program = new WebGL2Program(gl);
    gl.lineWidth(2);
    this.program = program;
    this.semanticProgram = new WebGL2SemanticProgram(gl);
    this.geometryCache = new WebGL2GeometryCache();
    this.instanceCache = new WebGL2InstanceCache();
    this.picker = new WebGL2Picker(gl);
  }
}
