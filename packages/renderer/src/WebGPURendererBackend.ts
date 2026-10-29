import {
  ICEEngineError,
  ICEMatrix4,
  type ICEGeometry,
} from '@ice3/core';
import { colorToRgba } from './Color.js';
import {
  collectRenderables,
  type ICEGeometryRenderable,
} from './Renderables.js';
import {
  collectRenderBatches,
  type ICERenderBatchDraw,
} from './RenderBatch.js';
import {
  collectInstanceBatches,
  type ICEInstanceBatch,
} from './InstanceBatch.js';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEViewport,
} from './types.js';
import {
  WebGPUGeometryCache,
  type WebGPUGeometryEntry,
} from './WebGPUGeometryCache.js';
import {
  WebGPUInstanceCache,
  type WebGPUInstanceEntry,
} from './WebGPUInstanceCache.js';
import {
  WebGPURenderPipeline,
  WEBGPU_UNIFORM_BYTES,
  WEBGPU_UNIFORM_STRIDE,
} from './WebGPURenderPipeline.js';
import {
  collectWebGPUPickIds,
  WebGPUPicker,
} from './WebGPUPicker.js';
import type { ICEScreenPoint } from './types.js';

const VERTEX_USAGE = 32 | 8;
const UNIFORM_USAGE = 64 | 8;
const RENDER_ATTACHMENT_USAGE = 16;
const UNIFORM_BUFFER_INITIAL_DRAWS = 64;
const SELECTION_RGBA = [1, 208 / 255, 0, 1] as const;
const SELECTION_TINT_RGBA = [1, 208 / 255, 0, 0.65] as const;
const EDGE_PIXEL_OFFSETS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

export type WebGPUDeviceContext = Readonly<{
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
  release?: () => void;
}>;

export class WebGPURendererBackend implements ICERendererBackend {
  capabilities: Readonly<ICERendererCapabilities> = {
    backend: 'webgpu',
    maxTextureSize: 0,
    picking: true,
  };

  private readonly adapter: GPUAdapter;
  private device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private pipeline: WebGPURenderPipeline;
  private readonly releaseProbe: (() => void) | undefined;
  private onContextLost: (() => void) | undefined;
  private onContextRestored: (() => void) | undefined;
  private disposing = false;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private geometryCache: WebGPUGeometryCache | null = null;
  private instanceCache: WebGPUInstanceCache | null = null;
  private picker: WebGPUPicker | null = null;
  private identityInstances: GPUBuffer | null = null;
  private zeroSemantics: GPUBuffer | null = null;
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
  private lastFrame: ICEFrame | null = null;
  private captureRequest: {
    readonly buffer: GPUBuffer;
    readonly bytesPerRow: number;
  } | null = null;
  private readonly renderablesScratch: ICEGeometryRenderable[] = [];
  private readonly batchesScratch: ICERenderBatchDraw[] = [];
  private readonly instancesScratch: ICEInstanceBatch[] = [];
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
    this.releaseProbe = context.release;
    this.watchDevice(this.device);
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
      usage: RENDER_ATTACHMENT_USAGE | 1,
    });
    this.canvas = options.canvas;
    this.context = context;
    this.onContextLost = options.onContextLost;
    this.onContextRestored = options.onContextRestored;
    this.geometryCache = new WebGPUGeometryCache({ device: this.device });
    this.instanceCache = new WebGPUInstanceCache(this.device);
    this.picker = new WebGPUPicker(this.device, this.format);
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
    this.zeroSemantics = this.device.createBuffer({
      label: 'ice3:zero-semantic',
      size: 4,
      usage: VERTEX_USAGE,
    });
    this.device.queue.writeBuffer(
      this.zeroSemantics,
      0,
      new Uint32Array([0]),
    );
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
    this.picker?.resize(this.canvas.width, this.canvas.height);
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
    this.lastFrame = frame;
    const context = this.context;
    const cache = this.requireGeometryCache();
    const instanceCache = this.instanceCache;
    if (
      !context
      || !this.depthTexture
      || !this.identityInstances
      || !this.zeroSemantics
      || !instanceCache
    ) {
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
    instanceCache.beginFrame();
    const renderables = collectRenderables(
      frame.scene,
      this.renderablesScratch,
    );
    const instances = collectInstanceBatches(
      renderables,
      this.instancesScratch,
    );
    const batches = collectRenderBatches(frame.scene, this.batchesScratch);
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const world = this.worldScratch;
    const mvp = this.mvpScratch;
    const drawList: PendingDraw[] = [];
    const instancedMeshIds = new Set<string>();
    const selected = new Set(frame.selection);
    const pushDraw = (
      draw: Omit<PendingDraw, 'matrix'>,
      matrix: Float32Array,
    ): void => {
      drawList.push({ ...draw, matrix: new Float32Array(matrix) });
    };
    const matrixFor = (source: ArrayLike<number>): Float32Array => {
      mvp.elements.set(viewProjection.elements);
      world.elements.set(source);
      mvp.multiply(world);
      return mvp.elements;
    };

    for (const batch of instances) {
      const instance = instanceCache.retain(batch);
      const geometry = cache.retain(batch.geometry);
      for (const id of batch.meshIds) instancedMeshIds.add(id);
      pushDraw({
        geometry,
        instanceBuffer: instance.matrixBuffer,
        semanticBuffer: instance.semanticBuffer,
        instanceCount: instance.instanceCount,
        color: colorToRgba(batch.material.color),
        useVertexColor: Boolean(batch.geometry.colors),
        useInstancing: true,
        pipeline: this.pipeline.triangle,
      }, viewProjection.elements);
      if (batch.material.edgeColor) {
        this.pushEdgeDraws(
          drawList,
          geometry,
          instance,
          viewProjection.elements,
          colorToRgba(batch.material.edgeColor),
          this.pipeline.line,
        );
      }
      for (
        let semanticIndex = 0;
        semanticIndex < batch.semanticIds.length;
        semanticIndex += 1
      ) {
        if (!selected.has(batch.semanticIds[semanticIndex]!)) continue;
        pushDraw({
          geometry,
          instanceBuffer: instance.matrixBuffer,
          semanticBuffer: instance.semanticBuffer,
          instanceCount: instance.instanceCount,
          color: [...SELECTION_RGBA] as [number, number, number, number],
          useVertexColor: false,
          useInstancing: true,
          pipeline: this.pipeline.selectionTriangle,
          semanticHighlight: semanticIndex,
          useSemantic: true,
        }, viewProjection.elements);
      }
    }

    for (const draw of batches) {
      const geometry = cache.retain(draw.batch.geometry);
      const matrix = matrixFor(draw.worldMatrix);
      pushDraw({
        geometry,
        instanceBuffer: this.identityInstances,
        semanticBuffer: this.zeroSemantics,
        instanceCount: 1,
        color: colorToRgba(draw.batch.material.color),
        useVertexColor: Boolean(draw.batch.geometry.colors),
        useInstancing: false,
        pipeline: this.pipeline.triangle,
      }, matrix);
      this.frameStats.renderedBatches += 1;
      if (draw.batch.material.edgeColor) {
        this.pushEdgeDraws(
          drawList,
          geometry,
          null,
          matrix,
          colorToRgba(draw.batch.material.edgeColor),
          this.pipeline.line,
        );
      }
      for (
        let semanticIndex = 0;
        semanticIndex < draw.batch.semanticSelectionIds.length;
        semanticIndex += 1
      ) {
        if (!selected.has(draw.batch.semanticSelectionIds[semanticIndex]!)) {
          continue;
        }
        pushDraw({
          geometry,
          instanceBuffer: this.identityInstances,
          semanticBuffer: geometry.semanticBuffer ?? this.zeroSemantics,
          instanceCount: 1,
          color: [...SELECTION_RGBA] as [number, number, number, number],
          useVertexColor: false,
          useInstancing: false,
          pipeline: this.pipeline.selectionTriangle,
          semanticHighlight: semanticIndex,
          useSemantic: true,
        }, matrix);
      }
    }

    for (const renderable of renderables) {
      if (instancedMeshIds.has(renderable.id)) continue;
      const geometry = cache.retain(renderable.mesh.geometry);
      const matrix = matrixFor(renderable.worldMatrix);
      pushDraw({
        geometry,
        instanceBuffer: this.identityInstances,
        semanticBuffer: this.zeroSemantics,
        instanceCount: 1,
        color: colorToRgba(renderable.mesh.material.color),
        useVertexColor: Boolean(renderable.mesh.geometry.colors),
        useInstancing: false,
        pipeline: this.pipeline.triangle,
      }, matrix);
      this.frameStats.renderedMeshes += 1;
      if (renderable.mesh.material.edgeColor) {
        this.pushEdgeDraws(
          drawList,
          geometry,
          null,
          matrix,
          colorToRgba(renderable.mesh.material.edgeColor),
          this.pipeline.line,
        );
      }
      if (selected.has(renderable.mesh.selectionId)) {
        pushDraw({
          geometry,
          instanceBuffer: this.identityInstances,
          semanticBuffer: this.zeroSemantics,
          instanceCount: 1,
          color: [...SELECTION_TINT_RGBA] as [
            number,
            number,
            number,
            number,
          ],
          useVertexColor: false,
          useInstancing: false,
          pipeline: this.pipeline.selectionTriangle,
        }, matrix);
        this.pushEdgeDraws(
          drawList,
          geometry,
          null,
          matrix,
          SELECTION_RGBA,
          this.pipeline.selectionLine,
        );
      }
    }

    this.ensureUniformCapacity(drawList.length);
    const uniforms = new Float32Array(drawList.length * 64);
    for (let index = 0; index < drawList.length; index += 1) {
      const draw = drawList[index]!;
      const offset = index * 64;
      uniforms.set(draw.matrix, offset);
      uniforms.set(draw.color, offset + 16);
      uniforms[offset + 20] = draw.clipOffset?.[0] ?? 0;
      uniforms[offset + 21] = draw.clipOffset?.[1] ?? 0;
      uniforms[offset + 22] = draw.useVertexColor ? 1 : 0;
      uniforms[offset + 23] = draw.useInstancing ? 1 : 0;
      uniforms[offset + 24] = draw.semanticHighlight ?? 0;
      uniforms[offset + 25] = draw.useSemantic ? 1 : 0;
      uniforms[offset + 26] = 0;
      uniforms[offset + 27] = 0;
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
        resource: {
          buffer: this.uniformBuffer!,
          offset: 0,
          size: WEBGPU_UNIFORM_BYTES,
        },
      }],
    });
    const targetTexture = context.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetTexture.createView(),
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
    for (let index = 0; index < drawList.length; index += 1) {
      const draw = drawList[index]!;
      pass.setPipeline(draw.pipeline);
      pass.setBindGroup(0, bindGroup, [index * WEBGPU_UNIFORM_STRIDE]);
      pass.setVertexBuffer(0, draw.geometry.vertexBuffer);
      pass.setVertexBuffer(1, draw.instanceBuffer);
      pass.setVertexBuffer(2, draw.semanticBuffer);
      pass.setIndexBuffer(
        draw.edge
          ? draw.geometry.edgeIndexBuffer!
          : draw.geometry.triangleIndexBuffer,
        draw.geometry.indexFormat,
      );
      pass.drawIndexed(
        draw.edge ? draw.geometry.edgeCount : draw.geometry.triangleCount,
        draw.instanceCount,
      );
      this.frameStats.drawCalls += 1;
    }
    pass.end();
    if (this.captureRequest) {
      encoder.copyTextureToBuffer(
        { texture: targetTexture },
        {
          buffer: this.captureRequest.buffer,
          bytesPerRow: this.captureRequest.bytesPerRow,
          rowsPerImage: this.canvas!.height,
        },
        {
          width: this.canvas!.width,
          height: this.canvas!.height,
          depthOrArrayLayers: 1,
        },
      );
      this.captureRequest = null;
    }
    this.device.queue.submit([encoder.finish()]);
    cache.endFrame();
    instanceCache.endFrame();
    this.frameStats.gpuUploads = cache.uploadCount;
    this.frameStats.gpuEvictions = cache.evictionCount;
    this.frameStats.gpuBytes = cache.totalBytes + instanceCache.totalBytes;
  }

  async pick(
    frame: ICEFrame,
    point: ICEScreenPoint,
  ): Promise<string | undefined> {
    if (!this.picker) {
      throw new ICEEngineError(
        'ICE3_WEBGPU_PICK_UNAVAILABLE',
        'ICE3_WEBGPU_PICK_UNAVAILABLE: picker is not initialized',
      );
    }
    try {
      return await this.picker.pick(
        { ...frame, point },
        this.requireGeometryCache(),
        collectWebGPUPickIds(frame),
      );
    } catch (error) {
      if (
        error instanceof ICEEngineError
        && error.code === 'ICE3_WEBGPU_PICK_UNAVAILABLE'
      ) {
        throw error;
      }
      throw new ICEEngineError(
        'ICE3_WEBGPU_PICK_UNAVAILABLE',
        'ICE3_WEBGPU_PICK_UNAVAILABLE: exact pick failed',
        { cause: error },
      );
    }
  }

  dispose(): void {
    this.disposing = true;
    this.geometryCache?.dispose();
    this.picker?.dispose();
    this.instanceCache?.dispose();
    this.identityInstances?.destroy();
    this.zeroSemantics?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.context?.unconfigure();
    this.geometryCache = null;
    this.picker = null;
    this.instanceCache = null;
    this.identityInstances = null;
    this.zeroSemantics = null;
    this.uniformBuffer = null;
    this.depthTexture = null;
    this.context = null;
    this.canvas = null;
    this.device.destroy();
    this.releaseProbe?.();
    this.onContextLost = undefined;
    this.onContextRestored = undefined;
  }

  async capture(): Promise<Blob> {
    if (!this.context || !this.canvas || !this.lastFrame) {
      throw new ICEEngineError(
        'ICE3_ENGINE_NOT_READY',
        'Renderer has no frame to capture',
      );
    }
    const width = this.canvas.width;
    const height = this.canvas.height;
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const readback = this.device.createBuffer({
      label: 'ice3:capture-readback',
      size: bytesPerRow * height,
      usage: 1 | 8,
    });
    this.captureRequest = { buffer: readback, bytesPerRow };
    try {
      this.render(this.lastFrame);
    } catch (error) {
      this.captureRequest = null;
      readback.destroy();
      throw error;
    }
    let bytes: Uint8Array;
    try {
      await readback.mapAsync(1);
      bytes = new Uint8Array(readback.getMappedRange()).slice();
    } finally {
      readback.unmap();
      readback.destroy();
    }
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (this.format === 'bgra8unorm' || this.format === 'bgra8unorm-srgb') {
        [bytes[offset], bytes[offset + 2]] = [
          bytes[offset + 2]!,
          bytes[offset]!,
        ];
      }
    }
    const imageBytes = new Uint8Array(width * height * 4);
    const rowBytes = width * 4;
    for (let row = 0; row < height; row += 1) {
      imageBytes.set(
        bytes.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes),
        row * rowBytes,
      );
    }
    return pixelsToPng(imageBytes, width, height);
  }

  async finish(): Promise<void> {
    await this.device.queue.onSubmittedWorkDone?.();
  }

  private pushEdgeDraws(
    output: PendingDraw[],
    geometry: WebGPUGeometryEntry,
    instance: WebGPUInstanceEntry | null,
    matrix: Float32Array,
    color: readonly [number, number, number, number],
    pipeline: GPURenderPipeline,
  ): void {
    if (!geometry.edgeIndexBuffer || geometry.edgeCount === 0) return;
    const clipPixelX = 2 / Math.max(1, this.viewport.width * this.dpr);
    const clipPixelY = 2 / Math.max(1, this.viewport.height * this.dpr);
    for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
      output.push({
        geometry,
        instanceBuffer: instance?.matrixBuffer ?? this.identityInstances!,
        semanticBuffer: instance?.semanticBuffer ?? this.zeroSemantics!,
        instanceCount: instance?.instanceCount ?? 1,
        matrix: new Float32Array(matrix),
        color,
        useVertexColor: false,
        useInstancing: instance !== null,
        pipeline,
        clipOffset: [offsetX * clipPixelX, offsetY * clipPixelY],
        edge: true,
      });
    }
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

  private watchDevice(device: GPUDevice): void {
    void device.lost.then((info) => {
      if (
        this.disposing
        || device !== this.device
        || info.reason === 'destroyed'
      ) {
        return;
      }
      void this.recoverDevice();
    });
  }

  private async recoverDevice(): Promise<void> {
    this.releaseProbe?.();
    this.onContextLost?.();
    this.geometryCache?.dispose();
    this.instanceCache?.dispose();
    this.picker?.dispose();
    this.identityInstances?.destroy();
    this.zeroSemantics?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.geometryCache = null;
    this.instanceCache = null;
    this.picker = null;
    this.identityInstances = null;
    this.zeroSemantics = null;
    this.uniformBuffer = null;
    this.depthTexture = null;
    this.uniformCapacity = 0;
    try {
      const device = await this.adapter.requestDevice();
      const pipeline = await WebGPURenderPipeline.create(device, this.format);
      this.device = device;
      this.pipeline = pipeline;
      this.watchDevice(device);
      if (this.canvas) {
        this.initialize({
          canvas: this.canvas,
          ...(this.onContextLost
            ? { onContextLost: this.onContextLost }
            : {}),
          ...(this.onContextRestored
            ? { onContextRestored: this.onContextRestored }
            : {}),
        });
      }
      this.onContextRestored?.();
    } catch {
      // The Engine receives Device Lost and can rebuild the scene.
    }
  }
}

function drawCountPowerOfTwo(value: number): number {
  let result = 1;
  while (result < Math.max(1, value)) result *= 2;
  return result;
}

async function pixelsToPng(
  bytes: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  const pixels = new Uint8ClampedArray(
    bytes.buffer,
    bytes.byteOffset,
    width * height * 4,
  ).slice();
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('ICE3_GPU_RESOURCE_FAILED: 2D context');
    const image = typeof ImageData === 'undefined'
      ? { data: pixels, width, height } as ImageData
      : new ImageData(pixels, width, height);
    context.putImageData(
      image,
      0,
      0,
    );
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ICE3_GPU_RESOURCE_FAILED: 2D context');
  const image = typeof ImageData === 'undefined'
    ? { data: pixels, width, height } as ImageData
    : new ImageData(pixels, width, height);
  context.putImageData(
    image,
    0,
    0,
  );
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('ICE3_GPU_RESOURCE_FAILED: PNG encoding failed'));
    }, 'image/png');
  });
}

type PendingDraw = {
  readonly pipeline: GPURenderPipeline;
  readonly geometry: WebGPUGeometryEntry;
  readonly instanceBuffer: GPUBuffer;
  readonly semanticBuffer: GPUBuffer;
  readonly instanceCount: number;
  readonly matrix: Float32Array;
  readonly color: readonly [number, number, number, number];
  readonly useVertexColor: boolean;
  readonly useInstancing: boolean;
  readonly semanticHighlight?: number;
  readonly useSemantic?: boolean;
  readonly clipOffset?: readonly [number, number];
  readonly edge?: boolean;
};
