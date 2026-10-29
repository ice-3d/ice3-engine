import {
  ICEEngineError,
  ICEMatrix4,
} from '@ice3/core';
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
import {
  decodeSelectionIndex,
} from './WebGL2PickCodec.js';
import { WebGPUGeometryCache } from './WebGPUGeometryCache.js';
import { WebGPUInstanceCache } from './WebGPUInstanceCache.js';
import {
  WebGPURenderPipeline,
  WEBGPU_UNIFORM_BYTES,
  WEBGPU_UNIFORM_STRIDE,
} from './WebGPURenderPipeline.js';
import type {
  ICEFrame,
  ICEScreenPoint,
} from './types.js';

type ICEPickFrame = ICEFrame & {
  readonly point: ICEScreenPoint;
};

const VERTEX_USAGE = 32 | 8;
const UNIFORM_USAGE = 64 | 8;
const PICK_TEXTURE_USAGE = 16 | 1;
const DEPTH_USAGE = 16;
const MAP_READ = 1;
const COPY_DST = 8;

export class WebGPUPicker {
  private readonly pipelinePromise: Promise<WebGPURenderPipeline>;
  private readonly instanceCache: WebGPUInstanceCache;
  private readonly identityInstances: GPUBuffer;
  private readonly zeroSemantics: GPUBuffer;
  private readonly renderables: ICEGeometryRenderable[] = [];
  private readonly batches: ICERenderBatchDraw[] = [];
  private readonly instances: ICEInstanceBatch[] = [];
  private target: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    pipeline?: WebGPURenderPipeline,
  ) {
    this.pipelinePromise = pipeline
      ? Promise.resolve(pipeline)
      : WebGPURenderPipeline.create(device, format);
    this.instanceCache = new WebGPUInstanceCache(device);
    this.identityInstances = device.createBuffer({
      label: 'ice3:pick-identity-instances',
      size: 80,
      usage: VERTEX_USAGE,
    });
    const identity = new Float32Array(20);
    identity.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    device.queue.writeBuffer(this.identityInstances, 0, identity);
    this.zeroSemantics = device.createBuffer({
      label: 'ice3:pick-zero-semantic',
      size: 4,
      usage: VERTEX_USAGE,
    });
    device.queue.writeBuffer(this.zeroSemantics, 0, new Uint32Array([0]));
  }

  async pick(
    frame: ICEPickFrame,
    geometryCache: WebGPUGeometryCache,
    pickIds: Readonly<Record<number, string>>,
  ): Promise<string | undefined> {
    if (this.disposed) {
      throw new ICEEngineError(
        'ICE3_ENGINE_DESTROYED',
        'WebGPU picker is disposed',
      );
    }
    const width = Math.max(
      1,
      Math.round(frame.viewport.width * frame.dpr),
    );
    const height = Math.max(
      1,
      Math.round(frame.viewport.height * frame.dpr),
    );
    this.ensureTarget(width, height);
    const pipeline = await this.pipelinePromise;
    this.instanceCache.beginFrame();
    geometryCache.beginFrame();
    const renderables = collectRenderables(frame.scene, this.renderables);
    const instances = collectInstanceBatches(renderables, this.instances);
    const batches = collectRenderBatches(frame.scene, this.batches);
    const instancedIds = new Set<string>();
    const idBySelection = new Map<string, number>();
    for (const [key, value] of Object.entries(pickIds)) {
      idBySelection.set(value, Number(key));
    }
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const mvp = new ICEMatrix4();
    const world = new ICEMatrix4();
    const draws: Array<{
      matrix: Float32Array;
      base: number;
      useInstancing: boolean;
      instanceCount: number;
      geometry: ReturnType<WebGPUGeometryCache['retain']>;
      instanceBuffer: GPUBuffer;
      semanticBuffer: GPUBuffer;
    }> = [];
    const matrixFor = (matrix: ArrayLike<number>): Float32Array => {
      mvp.elements.set(viewProjection.elements);
      world.elements.set(matrix);
      mvp.multiply(world);
      return new Float32Array(mvp.elements);
    };
    for (const batch of instances) {
      const ids = batch.semanticIds
        .map((id) => idBySelection.get(id))
        .filter((id): id is number => id !== undefined);
      if (ids.length === 0) continue;
      const instance = this.instanceCache.retain(batch);
      for (const id of batch.meshIds) instancedIds.add(id);
      draws.push({
        matrix: new Float32Array(viewProjection.elements),
        base: Math.min(...ids) - 1,
        useInstancing: true,
        instanceCount: instance.instanceCount,
        geometry: geometryCache.retain(batch.geometry),
        instanceBuffer: instance.matrixBuffer,
        semanticBuffer: instance.semanticBuffer,
      });
    }
    for (const draw of batches) {
      const ids = draw.batch.semanticSelectionIds
        .map((id) => idBySelection.get(id))
        .filter((id): id is number => id !== undefined);
      if (ids.length === 0) continue;
      draws.push({
        matrix: matrixFor(draw.worldMatrix),
        base: Math.min(...ids) - 1,
        useInstancing: false,
        instanceCount: 1,
        geometry: geometryCache.retain(draw.batch.geometry),
        instanceBuffer: this.identityInstances,
        semanticBuffer:
          geometryCache.retain(draw.batch.geometry).semanticBuffer
          ?? this.zeroSemantics,
      });
    }
    for (const renderable of renderables) {
      if (instancedIds.has(renderable.id)) continue;
      const id = idBySelection.get(renderable.mesh.selectionId);
      if (id === undefined) continue;
      draws.push({
        matrix: matrixFor(renderable.worldMatrix),
        base: id - 1,
        useInstancing: false,
        instanceCount: 1,
        geometry: geometryCache.retain(renderable.mesh.geometry),
        instanceBuffer: this.identityInstances,
        semanticBuffer: this.zeroSemantics,
      });
    }
    this.ensureUniformBuffer(draws.length);
    const uniforms = new Float32Array(draws.length * 64);
    for (let index = 0; index < draws.length; index += 1) {
      const draw = draws[index]!;
      const offset = index * 64;
      uniforms.set(draw.matrix, offset);
      uniforms[offset + 16] = 1;
      uniforms[offset + 17] = 1;
      uniforms[offset + 18] = 1;
      uniforms[offset + 19] = 1;
      uniforms[offset + 23] = draw.useInstancing ? 1 : 0;
      uniforms[offset + 26] = 1;
      uniforms[offset + 27] = draw.base;
    }
    if (uniforms.length > 0) {
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        uniforms as unknown as BufferSource,
      );
    }
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.uniformBuffer!,
          offset: 0,
          size: WEBGPU_UNIFORM_BYTES,
        },
      }],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.target!.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depth!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline.triangle);
    for (let index = 0; index < draws.length; index += 1) {
      const draw = draws[index]!;
      pass.setBindGroup(0, bindGroup, [index * WEBGPU_UNIFORM_STRIDE]);
      pass.setVertexBuffer(0, draw.geometry.vertexBuffer);
      pass.setVertexBuffer(1, draw.instanceBuffer);
      pass.setVertexBuffer(2, draw.semanticBuffer);
      pass.setIndexBuffer(
        draw.geometry.triangleIndexBuffer,
        draw.geometry.indexFormat,
      );
      pass.drawIndexed(
        draw.geometry.triangleCount,
        draw.instanceCount,
      );
    }
    pass.end();
    const pixelX = Math.max(
      0,
      Math.min(this.width - 1, Math.floor(frame.point.x * frame.dpr)),
    );
    const pixelY = Math.max(
      0,
      Math.min(this.height - 1, Math.floor(frame.point.y * frame.dpr)),
    );
    const readback = this.device.createBuffer({
      label: 'ice3:pick-readback',
      size: 256,
      usage: COPY_DST | MAP_READ,
    });
    encoder.copyTextureToBuffer(
      {
        texture: this.target!,
        origin: {
          x: pixelX,
          y: pixelY,
          z: 0,
        },
      },
      {
        buffer: readback,
        bytesPerRow: 256,
        rowsPerImage: 1,
      },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    let pixel: Uint8Array | undefined;
    try {
      await readback.mapAsync(MAP_READ);
      pixel = new Uint8Array(readback.getMappedRange(), 0, 4).slice();
      if (this.format === 'bgra8unorm' || this.format === 'bgra8unorm-srgb') {
        [pixel[0], pixel[2]] = [pixel[2]!, pixel[0]!];
      }
    } catch (error) {
      throw new ICEEngineError(
        'ICE3_WEBGPU_PICK_UNAVAILABLE',
        'ICE3_WEBGPU_PICK_UNAVAILABLE: readback failed',
        { cause: error },
      );
    } finally {
      readback.unmap();
      readback.destroy();
      this.instanceCache.endFrame();
      geometryCache.endFrame();
    }
    const index = pixel ? decodeSelectionIndex(pixel) : undefined;
    return index === undefined ? undefined : pickIds[index];
  }

  resize(width: number, height: number): void {
    this.ensureTarget(width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target?.destroy();
    this.depth?.destroy();
    this.uniformBuffer?.destroy();
    this.identityInstances.destroy();
    this.zeroSemantics.destroy();
    this.instanceCache.dispose();
    this.target = null;
    this.depth = null;
    this.uniformBuffer = null;
  }

  private ensureTarget(width: number, height: number): void {
    if (this.target && this.depth && this.width === width && this.height === height) {
      return;
    }
    this.target?.destroy();
    this.depth?.destroy();
    this.target = this.device.createTexture({
      label: 'ice3:pick-target',
      size: [width, height],
      format: this.format,
      usage: PICK_TEXTURE_USAGE,
    });
    this.depth = this.device.createTexture({
      label: 'ice3:pick-depth',
      size: [width, height],
      format: 'depth24plus',
      usage: DEPTH_USAGE,
    });
    this.width = width;
    this.height = height;
  }

  private ensureUniformBuffer(draws: number): void {
    const capacity = Math.max(1, draws);
    if (capacity <= this.uniformBufferDraws()) return;
    this.uniformBuffer?.destroy();
    this.uniformBuffer = this.device.createBuffer({
      label: 'ice3:pick-uniforms',
      size: capacity * WEBGPU_UNIFORM_STRIDE,
      usage: UNIFORM_USAGE,
    });
    this.uniformBufferCapacity = capacity;
  }

  private uniformBufferCapacity = 0;

  private uniformBufferDraws(): number {
    return this.uniformBufferCapacity;
  }
}

export function collectWebGPUPickIds(
  frame: ICEFrame,
): Readonly<Record<number, string>> {
  const pickIds: Record<number, string> = {};
  const seen = new Set<string>();
  let next = 1;
  const add = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    pickIds[next] = id;
    next += 1;
  };
  const renderables = collectRenderables(frame.scene);
  const instances = collectInstanceBatches(renderables);
  for (const instance of instances) {
    for (const id of instance.semanticIds) add(id);
  }
  const instancedIds = new Set(instances.flatMap((item) => item.meshIds));
  for (const batch of collectRenderBatches(frame.scene)) {
    for (const id of batch.batch.semanticSelectionIds) add(id);
  }
  for (const renderable of renderables) {
    if (!instancedIds.has(renderable.id)) add(renderable.mesh.selectionId);
  }
  return pickIds;
}
