import { ICEEngineError, ICEMatrix4 } from '@ice3/core';
import {
  BOX_INDICES,
  BOX_NORMALS,
  BOX_POSITIONS,
  collectRenderables,
  colorToRgba,
} from './WebGL2BoxBatch';
import { WebGL2Program } from './WebGL2Program';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEViewport,
} from './types';

export class WebGL2RendererBackend implements ICERendererBackend {
  capabilities: Readonly<ICERendererCapabilities> = {
    backend: 'webgl2',
    maxTextureSize: 0,
  };

  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private viewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  private dpr = 1;
  private onContextLost: (() => void) | undefined;
  private onContextRestored: (() => void) | undefined;
  private program: WebGL2Program | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private vertexArray: WebGLVertexArrayObject | null = null;
  private frameStats = { drawCalls: 0, renderedMeshes: 0, gpuBytes: 0 };
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.onContextLost?.();
  };
  private readonly handleContextRestored = (): void => {
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
    };
    this.createGeometry(gl);
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

  render(frame: ICEFrame): void {
    if (!this.gl || !this.program || !this.vertexArray) {
      throw new ICEEngineError('ICE3_ENGINE_NOT_READY', 'Renderer is not initialized');
    }
    const gl = this.gl;
    gl.clearColor(0.035, 0.055, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const mvp = new ICEMatrix4();
    this.frameStats = { drawCalls: 0, renderedMeshes: 0, gpuBytes: this.gpuBytes() };

    this.program.use();
    gl.bindVertexArray(this.vertexArray);
    const world = new ICEMatrix4();
    for (const renderable of collectRenderables(frame.scene)) {
      mvp.elements.set(viewProjection.elements);
      world.elements.set(renderable.worldMatrix);
      mvp.multiply(world);
      this.program.setMatrix(mvp);
      this.program.setColor(colorToRgba(renderable.mesh.material.color));
      gl.drawElements(gl.TRIANGLES, BOX_INDICES.length, gl.UNSIGNED_SHORT, 0);
      this.frameStats.drawCalls += 1;
      this.frameStats.renderedMeshes += 1;
    }
    gl.bindVertexArray(null);
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
    if (this.gl) {
      this.gl.deleteBuffer(this.vertexBuffer);
      this.gl.deleteBuffer(this.indexBuffer);
      this.gl.deleteVertexArray(this.vertexArray);
    }
    this.program = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.vertexArray = null;
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

  private createGeometry(gl: WebGL2RenderingContext): void {
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const program = new WebGL2Program(gl, 0, 1);
    if (!vertexArray || !vertexBuffer || !indexBuffer) {
      throw new ICEEngineError(
        'ICE3_GPU_RESOURCE_FAILED',
        'ICE3_GPU_RESOURCE_FAILED: geometry allocation failed',
      );
    }

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const data = new Float32Array(BOX_POSITIONS.length + BOX_NORMALS.length);
    for (let index = 0; index < BOX_POSITIONS.length / 3; index += 1) {
      data.set(BOX_POSITIONS.slice(index * 3, index * 3 + 3), index * 6);
      data.set(BOX_NORMALS.slice(index * 3, index * 3 + 3), index * 6 + 3);
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(program.positionLocation);
    gl.vertexAttribPointer(program.positionLocation, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(program.normalLocation);
    gl.vertexAttribPointer(program.normalLocation, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, BOX_INDICES, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.vertexArray = vertexArray;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.program = program;
  }

  private gpuBytes(): number {
    return (
      BOX_POSITIONS.byteLength
      + BOX_NORMALS.byteLength
      + BOX_INDICES.byteLength
    );
  }
}
