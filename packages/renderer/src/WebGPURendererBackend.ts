import {
  ICEEngineError,
  ICEMatrix4,
  type ICEGeometry,
} from '@ice3/core';
import { colorToRgba } from './Color.js';
import { collectRenderables } from './Renderables.js';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEViewport,
} from './types.js';
import { WebGPUGeometryCache } from './WebGPUGeometryCache.js';
import {
  WebGPURenderPipeline,
  WEBGPU_UNIFORM_BYTES,
  WEBGPU_UNIFORM_STRIDE,
} from './WebGPURenderPipeline.js';

const VERTEX_USAGE = 32 | 8;
const UNIFORM_USAGE = 64 | 8;
const RENDER_ATTACHMENT_USAGE = 16;
const UNIFORM_BUFFER_INITIAL_DRAWS = 64;

export type WebGPUDeviceContext = Readonly<{
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}>;

export class WebGPURendererBackend implements ICERendererBackend {
  capabilities: Readonly<ICERendererCapabilities> = {
    backend: 'webgpu',
    maxTextureSize: 0,
    picking: true,
  };

  private readonly adapter: GPUAdapter;
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly pipeline: WebGPURenderPipeline;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private geometryCache: WebGPUGeometryCache | null = null;
  private identityInstances: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private depthTexture: GPUTexture | null = null;
  private uniformCapacity = UNIFORM_BUFFER_INITIAL_DRAWS;
  private viewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  private dpr = 1;
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
  private readonly renderablesScratch = [];
  private readonly mvpScratch = new ICEMatrix4();
  private readonly worldScratch = new ICEMatrix4();

  private constructor(
    context: WebGPUDeviceContext,
    pipeline: WebGPURenderPipeline,
  ) {
    this.adapter = context.adapter;
    this.device = context.device;
    this.format = context.format;
    this.pipeline = pipeline;
  }

  static async create(
    context: WebGPUDeviceContext,
  ): Promise<WebGPURendererBackend> {
    const pipeline = await WebGPURenderPipeline.create(
      context.device,
      context.format,
    );
    return new WebGPURendererBackend(context, pipeline);
  }

  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  }): void {
    const context = options.canvas.getContext('webgpu') as
      | GPUCanvasContext
      | null;
    if (!context) {
      throw new ICEEngineError(
        'ICE3_WEBGPU_UNAVAILABLE',
        'ICE3_WEBGPU_UNAVAILABLE: WebGPU canvas context is unavailable',
      );
    }
    context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
    this.canvas = options.canvas;
    this.context = context;
    this.geometryCache = new WebGPUGeometryCache({ device: this.device });
    this.capabilities = {
      backend: 'webgpu',
      maxTextureSize: this.device.limits.maxTextureDimension2D,
      picking: true,
    };
    this.identityInstances = this.device.createBuffer({
      label: 'ice3:identity-instances',
      size: 80,
      usage: VERTEX_USAGE,
    });
    const identity = new Float32Array(20);
    identity.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    this.device.queue.writeBuffer(this.identityInstances, 0, identity);
    this.ensureUniformCapacity(UNIFORM_BUFFER_INITIAL_DRAWS);
  }

  resize(viewport: ICEViewport, dpr: number): void {
    if (!this.canvas || !this.device) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer is not initialized',
      );
    }
    this.viewport = { ...viewport };
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(viewport.width * dpr));
    this.canvas.height = Math.max(1, Math.round(viewport.height * dpr));
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: 'ice3:depth',
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: RENDER_ATTACHMENT_USAGE,
    });
  }

  setBackgroundColor(color: string): void {
    this.backgroundRgba = colorToRgba(color);
  }

  prepareBatchGeometry(geometry: ICEGeometry): void {
    this.requireGeometryCache().pin(geometry);
  }

  releaseBatchGeometry(geometry: ICEGeometry): void {
    this.geometryCache?.unpin(geometry);
  }

  render(frame: ICEFrame): void {
    const context = this.context;
    const cache = this.requireGeometryCache();
    if (!context || !this.depthTexture || !this.identityInstances) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer is not initialized',
      );
    }
    this.frameStats = {
      drawCalls: 0,
      renderedMeshes: 0,
      renderedBatches: 0,
      instancingFallbacks: 0,
      gpuUploads: 0,
      gpuEvictions: 0,
      gpuBytes: 0,
    };
    cache.beginFrame();
    const renderables = collectRenderables(
      frame.scene,
      this.renderablesScratch,
    );
    this.ensureUniformCapacity(renderables.length);
    const uniforms = new Float32Array(renderables.length * 64);
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const world = this.worldScratch;
    const mvp = this.mvpScratch;
    for (let index = 0; index < renderables.length; index += 1) {
      const renderable = renderables[index]!;
      mvp.elements.set(viewProjection.elements);
      world.elements.set(renderable.worldMatrix);
      mvp.multiply(world);
      const offset = index * 64;
      uniforms.set(mvp.elements, offset);
      uniforms.set(colorToRgba(renderable.mesh.material.color), offset + 16);
      uniforms[offset + 20] = 0;
      uniforms[offset + 21] = 0;
      uniforms[offset + 22] = renderable.mesh.geometry.colors ? 1 : 0;
      uniforms[offset + 23] = 0;
    }
    if (uniforms.length > 0) {
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        uniforms as unknown as BufferSource,
      );
    }
    const bindGroup = this.device.createBindGroup({
      label: 'ice3:frame-uniforms',
      layout: this.pipeline.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer! },
      }],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: {
          r: this.backgroundRgba[0],
          g: this.backgroundRgba[1],
          b: this.backgroundRgba[2],
          a: this.backgroundRgba[3],
        },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline.triangle);
    for (let index = 0; index < renderables.length; index += 1) {
      const renderable = renderables[index]!;
      const geometry = cache.retain(renderable.mesh.geometry);
      pass.setBindGroup(0, bindGroup, [index * WEBGPU_UNIFORM_STRIDE]);
      pass.setVertexBuffer(0, geometry.vertexBuffer);
      pass.setVertexBuffer(1, this.identityInstances);
      pass.setIndexBuffer(geometry.triangleIndexBuffer, geometry.indexFormat);
      pass.drawIndexed(geometry.triangleCount);
      this.frameStats.drawCalls += 1;
      this.frameStats.renderedMeshes += 1;
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    cache.endFrame();
    this.frameStats.gpuUploads = cache.uploadCount;
    this.frameStats.gpuEvictions = cache.evictionCount;
    this.frameStats.gpuBytes = cache.totalBytes;
  }

  dispose(): void {
    this.geometryCache?.dispose();
    this.identityInstances?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.context?.unconfigure();
    this.geometryCache = null;
    this.identityInstances = null;
    this.uniformBuffer = null;
    this.depthTexture = null;
    this.context = null;
    this.canvas = null;
  }

  get stats(): Readonly<typeof this.frameStats> {
    return this.frameStats;
  }

  private requireGeometryCache(): WebGPUGeometryCache {
    if (!this.geometryCache) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer is not initialized',
      );
    }
    return this.geometryCache;
  }

  private ensureUniformCapacity(draws: number): void {
    if (draws <= this.uniformCapacity && this.uniformBuffer) return;
    let capacity = Math.max(UNIFORM_BUFFER_INITIAL_DRAWS, drawCountPowerOfTwo(draws));
    this.uniformBuffer?.destroy();
    this.uniformBuffer = this.device.createBuffer({
      label: 'ice3:frame-uniforms',
      size: capacity * WEBGPU_UNIFORM_STRIDE,
      usage: UNIFORM_USAGE,
    });
    this.uniformCapacity = capacity;
  }
}

function drawCountPowerOfTwo(value: number): number {
  let result = 1;
  while (result < Math.max(1, value)) result *= 2;
  return result;
}
