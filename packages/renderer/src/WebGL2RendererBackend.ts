import { ICEEngineError } from '@ice3/core';
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

  render(_frame: ICEFrame): void {
    if (!this.gl) {
      throw new ICEEngineError('ICE3_ENGINE_NOT_READY', 'Renderer is not initialized');
    }
    const gl = this.gl;
    gl.clearColor(0.035, 0.055, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener(
        'webglcontextrestored',
        this.handleContextRestored,
      );
    }
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
}
