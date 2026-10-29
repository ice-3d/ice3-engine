import {
  ICEEngineError,
  ICEMatrix4,
  type ICEGeometry,
} from '@ice3/core';
import { colorToRgba } from './Color.js';
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
  RendererProfiler,
  type ICEFrameStageProfile,
} from './RendererProfiler.js';
import { WebGPUTimestampProfiler } from './WebGPUTimestampProfiler.js';
import {
  buildSelectionMask,
  WebGPUSelectionMaskBuffer,
  type ICESelectionMaskLayout,
} from './WebGPUSelectionMask.js';
import { WebGPUDrawStorage } from './WebGPUDrawStorage.js';
import { WebGPURenderPlanCache } from './WebGPURenderPlan.js';
import { WebGPUBundleCache } from './WebGPUBundleCache.js';
import {
  detectWebGPUAcceleration,
  type ICEWebGPUAcceleration,
  type ICEWebGPUOptimizationStats,
  WEBGPU_GPU_DRIVEN_DEFAULT,
  WEBGPU_INSTANCE_VISIBILITY_THRESHOLD,
  WEBGPU_STORAGE_DEFAULT,
} from './WebGPUCapabilities.js';
import {
  WebGPUInstanceStorage,
  type ICEInstanceStoragePage,
} from './WebGPUInstanceStorage.js';
import {
  WebGPUVisibilityEncoder,
  type ICEVisibilityEntry,
} from './WebGPUVisibility.js';
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
const EMPTY_SELECTION = new Uint32Array([0]);
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

export type WebGPURendererBackendOptions = Readonly<{
  readonly forceStoragePath?: boolean;
  readonly forceGpuDriven?: boolean;
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
  private storagePipeline: WebGPURenderPipeline | null;
  private gpuDrivenPipeline: WebGPURenderPipeline | null;
  private visibilityEncoder: WebGPUVisibilityEncoder | null;
  private storageCache: WebGPUInstanceStorage | null;
  private readonly acceleration: ICEWebGPUAcceleration;
  private readonly forceStoragePath: boolean;
  private readonly forceGpuDriven: boolean;
  private readonly releaseProbe: (() => void) | undefined;
  private onContextLost: (() => void) | undefined;
  private onContextRestored: (() => void) | undefined;
  private onError: ((error: ICEEngineError) => void) | undefined;
  private disposing = false;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private geometryCache: WebGPUGeometryCache | null = null;
  private instanceCache: WebGPUInstanceCache | null = null;
  private picker: WebGPUPicker | null = null;
  private selectionMaskBuffer: WebGPUSelectionMaskBuffer | null = null;
  private timestampProfiler: WebGPUTimestampProfiler | null = null;
  private timestampProfilingEnabled = false;
  private bundleCache: WebGPUBundleCache;
  private bundleActive = true;
  private frameBindGroup: GPUBindGroup | null = null;
  private frameBindGroupKey = '';
  private readonly storageBindGroups = new Map<
    GPUBuffer,
    {
      readonly key: string;
      readonly visibleBuffer?: GPUBuffer;
      readonly group: GPUBindGroup;
    }
  >();
  private uniformBufferGeneration = 0;
  private readonly optimizationWarnings = new Set<string>();
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
  private readonly renderPlan = new WebGPURenderPlanCache();
  private readonly drawListScratch: PendingDraw[] = [];
  private readonly selected = new Set<string>();
  private readonly drawStorage = new WebGPUDrawStorage();
  private readonly lastVisibilityEntries: Array<{
    readonly entry: ICEVisibilityEntry;
    readonly page: ICEInstanceStoragePage;
  }> = [];
  private readonly mvpScratch = new ICEMatrix4();
  private readonly worldScratch = new ICEMatrix4();
  private readonly profiler = new RendererProfiler();
  private lastFrameProfile: ICEFrameStageProfile | null = null;
  private optimizationFailureReason: string | null = null;
  private storageFailureReason: string | null = null;
  private visibilityFailureReason: string | null = null;

  private constructor(
    context: WebGPUDeviceContext,
    pipeline: WebGPURenderPipeline,
    storagePipeline: WebGPURenderPipeline | null,
    gpuDrivenPipeline: WebGPURenderPipeline | null,
    visibilityEncoder: WebGPUVisibilityEncoder | null,
    storageCache: WebGPUInstanceStorage | null,
    acceleration: ICEWebGPUAcceleration,
    forceStoragePath: boolean,
    forceGpuDriven: boolean,
    selectionMaskBuffer: WebGPUSelectionMaskBuffer | null,
    optimizationFailureReason: string | null,
    storageFailureReason: string | null,
    visibilityFailureReason: string | null,
  ) {
    this.adapter = context.adapter;
    this.device = context.device;
    this.format = context.format;
    this.pipeline = pipeline;
    this.storagePipeline = storagePipeline;
    this.gpuDrivenPipeline = gpuDrivenPipeline;
    this.visibilityEncoder = visibilityEncoder;
    this.storageCache = storageCache;
    this.acceleration = acceleration;
    this.forceStoragePath = forceStoragePath;
    this.forceGpuDriven = forceGpuDriven;
    this.bundleCache = new WebGPUBundleCache(
      context.device,
      context.format,
    );
    this.selectionMaskBuffer = selectionMaskBuffer;
    this.optimizationFailureReason = optimizationFailureReason;
    this.storageFailureReason = storageFailureReason;
    this.visibilityFailureReason = visibilityFailureReason;
    this.releaseProbe = context.release;
    this.watchDevice(this.device);
  }

  static async create(
    context: WebGPUDeviceContext,
    options: WebGPURendererBackendOptions = {},
  ): Promise<WebGPURendererBackend> {
    let selectionMaskBuffer: WebGPUSelectionMaskBuffer | null = null;
    let optimizationFailureReason: string | null = null;
    let pipeline: WebGPURenderPipeline;
    try {
      selectionMaskBuffer = new WebGPUSelectionMaskBuffer(context.device);
      selectionMaskBuffer.update(new Uint32Array([0]));
      pipeline = await WebGPURenderPipeline.create(
        context.device,
        context.format,
        { selectionMask: true },
      );
    } catch {
      selectionMaskBuffer?.dispose();
      selectionMaskBuffer = null;
      optimizationFailureReason = 'selection-mask';
      pipeline = await WebGPURenderPipeline.create(
        context.device,
        context.format,
      );
    }
    const acceleration = detectWebGPUAcceleration(context.device);
    const forceStoragePath = options.forceStoragePath
      ?? WEBGPU_STORAGE_DEFAULT;
    const forceGpuDriven = options.forceGpuDriven
      ?? WEBGPU_GPU_DRIVEN_DEFAULT;
    let storagePipeline: WebGPURenderPipeline | null = null;
    let gpuDrivenPipeline: WebGPURenderPipeline | null = null;
    let visibilityEncoder: WebGPUVisibilityEncoder | null = null;
    let storageCache: WebGPUInstanceStorage | null = null;
    let storageFailureReason: string | null = null;
    let visibilityFailureReason: string | null = null;
    if (forceStoragePath || forceGpuDriven) {
      if (!acceleration.storage) {
        storageFailureReason = 'limit-too-low';
      } else {
        try {
          storagePipeline = await WebGPURenderPipeline.create(
            context.device,
            context.format,
            {
              selectionMask: true,
              storageInstances: true,
            },
          );
          storageCache = new WebGPUInstanceStorage(context.device);
        } catch {
          storagePipeline = null;
          storageCache?.dispose();
          storageCache = null;
          storageFailureReason = 'pipeline-failed';
        }
      }
    }
    if (forceGpuDriven) {
      if (!storagePipeline || !storageCache) {
        visibilityFailureReason = storageFailureReason ?? 'limit-too-low';
      } else if (!acceleration.visibility) {
        visibilityFailureReason = 'limit-too-low';
      } else {
        try {
          gpuDrivenPipeline = await WebGPURenderPipeline.create(
            context.device,
            context.format,
            {
              selectionMask: true,
              storageInstances: true,
              indirectInstances: true,
            },
          );
          visibilityEncoder = await WebGPUVisibilityEncoder.create(
            context.device,
          );
        } catch {
          gpuDrivenPipeline = null;
          visibilityEncoder?.dispose();
          visibilityEncoder = null;
          visibilityFailureReason = 'pipeline-failed';
        }
      }
    }
    return new WebGPURendererBackend(
      context,
      pipeline,
      storagePipeline,
      gpuDrivenPipeline,
      visibilityEncoder,
      storageCache,
      acceleration,
      forceStoragePath,
      forceGpuDriven,
      selectionMaskBuffer,
      optimizationFailureReason,
      storageFailureReason,
      visibilityFailureReason,
    );
  }

  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
    readonly onError?: (error: ICEEngineError) => void;
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
    this.onError = options.onError;
    if (this.optimizationFailureReason) {
      const reason = this.optimizationFailureReason;
      this.optimizationFailureReason = null;
      this.reportOptimizationFailure('selection-mask', reason);
    }
    if (this.storageFailureReason) {
      const reason = this.storageFailureReason;
      this.storageFailureReason = null;
      this.reportOptimizationFailure('storage', reason);
    }
    if (this.visibilityFailureReason) {
      const reason = this.visibilityFailureReason;
      this.visibilityFailureReason = null;
      this.reportOptimizationFailure('visibility', reason);
    }
    this.geometryCache = new WebGPUGeometryCache({ device: this.device });
    this.instanceCache = new WebGPUInstanceCache(this.device);
    this.picker = new WebGPUPicker(this.device, this.format);
    this.timestampProfiler = this.device.features.has('timestamp-query')
      ? new WebGPUTimestampProfiler(this.device)
      : null;
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
    this.bundleCache.invalidate();
    this.frameBindGroup = null;
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
    this.profiler.begin();
    this.lastFrameProfile = null;
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
    this.storageCache?.beginFrame();
    const plan = this.renderPlan.get(frame.scene);
    const renderables = plan.renderables;
    const instances = plan.instances;
    const batches = plan.batches;
    this.profiler.mark('collect');
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const world = this.worldScratch;
    const mvp = this.mvpScratch;
    const drawList = this.drawListScratch;
    drawList.length = 0;
    this.lastVisibilityEntries.length = 0;
    this.drawStorage.begin(0);
    const instancedMeshIds = plan.instancedMeshIds;
    const selected = this.selected;
    selected.clear();
    for (const id of frame.selection) selected.add(id);
    const selectionMaskActive = this.selectionMaskBuffer !== null;
    const selectionMaskEnabled = selectionMaskActive
      && frame.selection.length > 0;
    let selectionEntryCount = 0;
    const selectionOverlays: string[] = [];
    const pushDraw = (
      draw: Omit<PendingDraw, 'selectionBase'>,
      matrix: Float32Array,
      selectionIds?: readonly string[],
    ): void => {
      const selectionBase = selectionMaskEnabled
        ? selectionEntryCount
        : 0;
      this.drawStorage.append({
        ...draw,
        matrix,
        selectionBase,
        useSelectionMask: Boolean(draw.useSelectionMask),
        pageBase: draw.storagePage?.firstInstance ?? 0,
        useIndirect: Boolean(draw.visibilityEntry),
      });
      drawList.push({
        ...draw,
        ...(selectionIds ? { selectionIds } : {}),
        selectionBase,
      });
      if (selectionMaskEnabled && selectionIds) {
        selectionEntryCount += selectionIds.length;
      }
    };
    const matrixFor = (source: ArrayLike<number>): Float32Array => {
      mvp.elements.set(viewProjection.elements);
      world.elements.set(source);
      mvp.multiply(world);
      return mvp.elements;
    };
    const pushEdgeDraws = (
      geometry: WebGPUGeometryEntry,
      instance: {
        readonly matrixBuffer: GPUBuffer;
        readonly semanticBuffer: GPUBuffer;
        readonly instanceCount: number;
        readonly storagePage?: ICEInstanceStoragePage;
      } | null,
      matrix: Float32Array,
      color: readonly [number, number, number, number],
      pipeline: GPURenderPipeline,
      selection?: {
        readonly selectionIds: readonly string[];
        readonly useSelectionMask: boolean;
        readonly useSemantic: boolean;
        readonly selectionScope: string;
      },
    ): void => {
      if (!geometry.edgeIndexBuffer || geometry.edgeCount === 0) return;
      if (selection) selectionOverlays.push(selection.selectionScope);
      const clipPixelX = 2 / Math.max(1, this.viewport.width * this.dpr);
      const clipPixelY = 2 / Math.max(1, this.viewport.height * this.dpr);
      for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
        pushDraw({
          geometry,
          instanceBuffer: instance?.matrixBuffer ?? this.identityInstances!,
          semanticBuffer: instance?.semanticBuffer ?? this.zeroSemantics!,
          instanceCount: instance?.instanceCount ?? 1,
          color,
          useVertexColor: false,
          useInstancing: instance !== null,
          pipeline,
          clipOffset: [offsetX * clipPixelX, offsetY * clipPixelY],
          edge: true,
          ...(selection ?? {}),
          ...(instance?.storagePage
            ? { storagePage: instance.storagePage }
            : {}),
          ...(instance?.storagePage
            && this.gpuDrivenActive
            && instance.storagePage.instanceCount
              >= WEBGPU_INSTANCE_VISIBILITY_THRESHOLD
            ? {
                visibilityEntry: this.visibilityEncoder!.retain(
                  instance.storagePage,
                  pipeline === this.gpuDrivenPipeline?.line
                    || pipeline === this.gpuDrivenPipeline?.selectionLine
                    ? geometry.edgeCount
                    : geometry.triangleCount,
                ),
              }
            : {}),
        }, matrix, selection?.selectionIds);
      }
    };

    for (const batch of instances) {
      const geometry = cache.retain(batch.geometry);
      if (
        this.storageActive
        && this.storageCache
        && this.storagePipeline
      ) {
        const storage = this.storageCache.retain(batch, batch.geometry);
        for (const page of storage.pages) {
          const useVisibility = (
            this.gpuDrivenActive
            && page.instanceCount >= WEBGPU_INSTANCE_VISIBILITY_THRESHOLD
          );
          const pagePipeline = useVisibility
            ? this.gpuDrivenPipeline!
            : this.storagePipeline;
          const visibilityEntry = useVisibility
            ? this.visibilityEncoder!.retain(page, geometry.triangleCount)
            : undefined;
          if (visibilityEntry) {
            this.lastVisibilityEntries.push({
              entry: visibilityEntry,
              page,
            });
          }
          const instance = {
            matrixBuffer: this.identityInstances,
            semanticBuffer: geometry.semanticBuffer ?? this.zeroSemantics,
            instanceCount: page.instanceCount,
            storagePage: page,
          };
          pushDraw({
            geometry,
            instanceBuffer: instance.matrixBuffer,
            semanticBuffer: instance.semanticBuffer,
            instanceCount: instance.instanceCount,
            color: colorToRgba(batch.material.color),
            useVertexColor: Boolean(batch.geometry.colors),
            useInstancing: true,
            pipeline: pagePipeline.triangle,
            useSelectionMask: selectionMaskEnabled,
            storagePage: page,
            ...(visibilityEntry ? { visibilityEntry } : {}),
          }, viewProjection.elements, batch.semanticIds);
          if (batch.material.edgeColor) {
            pushEdgeDraws(
              geometry,
              instance,
              viewProjection.elements,
              colorToRgba(batch.material.edgeColor),
              pagePipeline.line,
            );
          }
          if (
            selectionMaskEnabled
            && batch.material.edgeColor
            && batch.semanticIds.some((id) => selected.has(id))
          ) {
            pushEdgeDraws(
              geometry,
              instance,
              viewProjection.elements,
              SELECTION_RGBA,
              pagePipeline.selectionLine,
              {
                selectionIds: batch.semanticIds,
                useSelectionMask: true,
                useSemantic: true,
                selectionScope: batch.id,
              },
            );
          }
        }
      } else {
        const instance = instanceCache.retain(batch);
        pushDraw({
          geometry,
          instanceBuffer: instance.matrixBuffer,
          semanticBuffer: instance.semanticBuffer,
          instanceCount: instance.instanceCount,
          color: colorToRgba(batch.material.color),
          useVertexColor: Boolean(batch.geometry.colors),
          useInstancing: true,
          pipeline: this.pipeline.triangle,
          useSelectionMask: selectionMaskEnabled,
        }, viewProjection.elements, batch.semanticIds);
        if (batch.material.edgeColor) {
          pushEdgeDraws(
            geometry,
            instance,
            viewProjection.elements,
            colorToRgba(batch.material.edgeColor),
            this.pipeline.line,
          );
        }
        if (
          selectionMaskEnabled
          && batch.material.edgeColor
          && batch.semanticIds.some((id) => selected.has(id))
        ) {
          pushEdgeDraws(
            geometry,
            instance,
            viewProjection.elements,
            SELECTION_RGBA,
            this.pipeline.selectionLine,
            {
              selectionIds: batch.semanticIds,
              useSelectionMask: true,
              useSemantic: true,
              selectionScope: batch.id,
            },
          );
        } else if (!selectionMaskEnabled) {
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
      }
    }

    for (const draw of batches) {
      const geometry = cache.retain(draw.batch.geometry);
      const matrix = matrixFor(draw.worldMatrix);
      pushDraw({
        geometry,
        instanceBuffer: this.identityInstances,
        semanticBuffer: geometry.semanticBuffer ?? this.zeroSemantics,
        instanceCount: 1,
        color: colorToRgba(draw.batch.material.color),
        useVertexColor: Boolean(draw.batch.geometry.colors),
        useInstancing: false,
        pipeline: this.pipeline.triangle,
        useSelectionMask: selectionMaskEnabled,
      }, matrix, draw.batch.semanticSelectionIds);
      this.frameStats.renderedBatches += 1;
      if (draw.batch.material.edgeColor) {
        pushEdgeDraws(
          geometry,
          null,
          matrix,
          colorToRgba(draw.batch.material.edgeColor),
          this.pipeline.line,
        );
      }
      if (
        selectionMaskEnabled
        && draw.batch.material.edgeColor
        && draw.batch.semanticSelectionIds.some((id) => selected.has(id))
      ) {
        pushEdgeDraws(
          geometry,
          null,
          matrix,
          SELECTION_RGBA,
          this.pipeline.selectionLine,
          {
            selectionIds: draw.batch.semanticSelectionIds,
            useSelectionMask: true,
            useSemantic: true,
            selectionScope: draw.id,
          },
        );
      } else if (!selectionMaskEnabled) {
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
        useSelectionMask: selectionMaskEnabled,
      }, matrix, [renderable.mesh.selectionId]);
      this.frameStats.renderedMeshes += 1;
      if (renderable.mesh.material.edgeColor) {
        pushEdgeDraws(
          geometry,
          null,
          matrix,
          colorToRgba(renderable.mesh.material.edgeColor),
          this.pipeline.line,
        );
      }
      if (selected.has(renderable.mesh.selectionId)) {
        if (!selectionMaskEnabled) {
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
        }
        pushEdgeDraws(
          geometry,
          null,
          matrix,
          SELECTION_RGBA,
          this.pipeline.selectionLine,
          selectionMaskEnabled
            ? {
                selectionIds: [renderable.mesh.selectionId],
                useSelectionMask: true,
                useSemantic: true,
                selectionScope: renderable.id,
              }
            : undefined,
        );
      }
    }

    const selectionLayout = selectionMaskEnabled
      ? buildSelectionMask(
          drawList.map((draw) => draw.selectionIds ?? []),
          frame.selection,
        )
      : { words: EMPTY_SELECTION, bases: [] };
    this.selectionMaskBuffer?.update(selectionLayout.words);
    this.ensureUniformCapacity(this.drawStorage.drawCount);
    const uniforms = this.drawStorage.uniformData.subarray(
      0,
      this.drawStorage.drawCount * 64,
    );
    if (uniforms.length > 0) {
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        uniforms as unknown as BufferSource,
      );
    }
    this.profiler.mark('prepareAndUpload');
    const bindGroupKey = [
      this.uniformBufferGeneration,
      this.selectionMaskBuffer?.generation ?? 0,
      this.pipeline.selectionMask ? 1 : 0,
    ].join(':');
    if (!this.frameBindGroup || this.frameBindGroupKey !== bindGroupKey) {
      const bindGroupEntries: GPUBindGroupEntry[] = [{
        binding: 0,
        resource: {
          buffer: this.uniformBuffer!,
          offset: 0,
          size: WEBGPU_UNIFORM_BYTES,
        },
      }];
      if (selectionMaskActive && this.selectionMaskBuffer?.buffer) {
        bindGroupEntries.push({
          binding: 1,
          resource: {
            buffer: this.selectionMaskBuffer.buffer,
            offset: 0,
            size: this.selectionMaskBuffer.buffer.size,
          },
        });
      }
      this.frameBindGroup = this.device.createBindGroup({
        label: 'ice3:frame-uniforms',
        layout: this.pipeline.bindGroupLayout,
        entries: bindGroupEntries,
      });
      this.frameBindGroupKey = bindGroupKey;
    }
    const bindGroup = this.frameBindGroup!;
    const encodeDraws = (
      encoder: GPURenderPassEncoder | GPURenderBundleEncoder,
    ): void => {
      for (let index = 0; index < drawList.length; index += 1) {
        const draw = drawList[index]!;
        encoder.setPipeline(draw.pipeline);
        const drawBindGroup = draw.storagePage
          ? this.storageBindGroupFor(
              draw.storagePage,
              draw.visibilityEntry?.visibleBuffer,
            )
          : bindGroup;
        encoder.setBindGroup(0, drawBindGroup, [
          index * WEBGPU_UNIFORM_STRIDE,
        ]);
        encoder.setVertexBuffer(0, draw.geometry.vertexBuffer);
        if (draw.storagePage) {
          encoder.setVertexBuffer(1, draw.semanticBuffer);
        } else {
          encoder.setVertexBuffer(1, draw.instanceBuffer);
          encoder.setVertexBuffer(2, draw.semanticBuffer);
        }
        encoder.setIndexBuffer(
          draw.edge
            ? draw.geometry.edgeIndexBuffer!
            : draw.geometry.triangleIndexBuffer,
          draw.geometry.indexFormat,
        );
        if (draw.visibilityEntry) {
          encoder.drawIndexedIndirect(
            draw.visibilityEntry.indirectBuffer,
            0,
          );
        } else {
          encoder.drawIndexed(
            draw.edge ? draw.geometry.edgeCount : draw.geometry.triangleCount,
            draw.instanceCount,
            0,
            0,
            draw.storagePage?.firstInstance ?? 0,
          );
        }
      }
    };
    const bundleKey = [
      plan.revision,
      this.drawStorage.generation,
      cache.generation,
      instanceCache.generation,
      this.storageCache?.generation ?? 0,
      this.selectionMaskBuffer?.generation ?? 0,
      this.uniformBufferGeneration,
      this.format,
      selectionOverlays.join('|'),
    ].join(':');
    let bundle: GPURenderBundle | null = null;
    if (this.bundleActive && drawList.length > 0) {
      try {
        bundle = this.bundleCache.get(bundleKey, encodeDraws);
      } catch {
        this.bundleActive = false;
        this.bundleCache.invalidate();
        this.reportOptimizationFailure('bundle', 'resource-failed');
      }
    }
    const targetTexture = context.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    if (this.gpuDrivenActive) {
      const encodedVisibility = new Set<ICEVisibilityEntry>();
      for (let index = 0; index < drawList.length; index += 1) {
        const draw = drawList[index]!;
        if (
          !draw.visibilityEntry
          || !draw.storagePage
          || encodedVisibility.has(draw.visibilityEntry)
        ) {
          continue;
        }
        encodedVisibility.add(draw.visibilityEntry);
        this.visibilityEncoder!.encode(
          encoder,
          draw.visibilityEntry,
          draw.storagePage,
          this.uniformBuffer!,
          index * WEBGPU_UNIFORM_STRIDE,
        );
      }
    }
    const timestampProfiler = this.captureRequest || !this.timestampProfilingEnabled
      ? null
      : this.timestampProfiler;
    const timestampQuerySet = timestampProfiler?.querySetFor(frame.frameId);
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
      ...(timestampQuerySet
        ? {
            timestampWrites: {
              querySet: timestampQuerySet,
              beginningOfPassWriteIndex: 0,
              endOfPassWriteIndex: 1,
            },
          }
        : {}),
    });
    if (bundle) {
      try {
        pass.executeBundles([bundle]);
      } catch {
        this.bundleActive = false;
        this.bundleCache.invalidate();
        this.reportOptimizationFailure('bundle', 'runtime-failed');
        encodeDraws(pass);
      }
    } else {
      encodeDraws(pass);
    }
    this.frameStats.drawCalls += drawList.length;
    pass.end();
    if (timestampProfiler) {
      timestampProfiler.resolveFrame(encoder, frame.frameId);
    }
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
    const commandBuffer = encoder.finish();
    this.profiler.mark('encode');
    this.device.queue.submit([commandBuffer]);
    this.profiler.mark('submit');
    cache.endFrame();
    instanceCache.endFrame();
    this.storageCache?.endFrame();
    this.frameStats.gpuUploads = cache.uploadCount;
    this.frameStats.gpuEvictions = cache.evictionCount;
    this.frameStats.gpuBytes = cache.totalBytes
      + instanceCache.totalBytes
      + (this.storageCache?.totalBytes ?? 0);
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
    this.bundleCache.dispose();
    this.geometryCache?.dispose();
    this.renderPlan.dispose();
    this.picker?.dispose();
    this.selectionMaskBuffer?.dispose();
    this.storageCache?.dispose();
    this.visibilityEncoder?.dispose();
    this.timestampProfiler?.dispose();
    this.instanceCache?.dispose();
    this.identityInstances?.destroy();
    this.zeroSemantics?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.context?.unconfigure();
    this.geometryCache = null;
    this.picker = null;
    this.selectionMaskBuffer = null;
    this.storageCache = null;
    this.visibilityEncoder = null;
    this.gpuDrivenPipeline = null;
    this.timestampProfiler = null;
    this.instanceCache = null;
    this.identityInstances = null;
    this.zeroSemantics = null;
    this.uniformBuffer = null;
    this.depthTexture = null;
    this.context = null;
    this.canvas = null;
    this.frameBindGroup = null;
    this.device.destroy();
    this.releaseProbe?.();
    this.onContextLost = undefined;
    this.onContextRestored = undefined;
    this.onError = undefined;
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

  async drainGpuTimings(): Promise<readonly number[]> {
    return this.timestampProfiler?.drain() ?? [];
  }

  enableTimestampProfiling(enabled: boolean): void {
    this.timestampProfilingEnabled = enabled && this.timestampProfiler !== null;
  }

  get timestampProfilingAvailable(): boolean {
    return this.timestampProfiler !== null;
  }

  get timestampProfilingUnavailableReason(): string | undefined {
    return this.timestampProfiler
      ? this.timestampProfiler.unavailableReason
      : 'timestamp-query unavailable';
  }

  get stats(): Readonly<typeof this.frameStats> {
    return this.frameStats;
  }

  async readVisibilityStats(): Promise<Readonly<{
    visibleInstances: number;
    culledInstances: number;
    dispatchCount: number;
  }> | undefined> {
    if (!this.visibilityEncoder) {
      return undefined;
    }
    let visibleInstances = 0;
    let culledInstances = 0;
    let dispatchCount = 0;
    const seen = new Set<ICEVisibilityEntry>();
    for (const item of this.lastVisibilityEntries) {
      if (seen.has(item.entry)) continue;
      seen.add(item.entry);
      const result = await this.visibilityEncoder.readStats(
        item.entry,
        item.page,
      );
      visibleInstances += result.visibleInstances;
      culledInstances += result.culledInstances;
      dispatchCount += result.dispatchCount;
    }
    return { visibleInstances, culledInstances, dispatchCount };
  }

  get storageActive(): boolean {
    return (
      (this.forceStoragePath || this.forceGpuDriven)
      && this.storagePipeline !== null
      && this.storageCache !== null
    );
  }

  private get gpuDrivenActive(): boolean {
    return (
      this.forceGpuDriven
      && this.gpuDrivenPipeline !== null
      && this.visibilityEncoder !== null
      && this.storageCache !== null
    );
  }

  get optimizationStats(): ICEWebGPUOptimizationStats {
    return {
      tier: this.gpuDrivenActive
        ? 'gpu-driven'
        : this.storageActive
          ? 'storage'
          : 'baseline',
      selectionMaskActive: this.selectionMaskBuffer !== null,
      bundleActive: this.bundleActive,
      storageActive: this.storageActive,
      visibilityActive: this.gpuDrivenActive,
      instanceUploadBytes: this.storageCache?.totalUploadBytes ?? 0,
      bundleRecreations: this.bundleCache.bundleRecreations,
      ...(this.timestampProfilingUnavailableReason
        ? {
            timestampUnavailableReason:
              this.timestampProfilingUnavailableReason,
          }
        : {}),
    };
  }

  private storageBindGroupFor(
    page: ICEInstanceStoragePage,
    visibleBuffer?: GPUBuffer,
  ): GPUBindGroup {
    const key = [
      this.uniformBufferGeneration,
      this.selectionMaskBuffer?.generation ?? 0,
    ].join(':');
    const cached = this.storageBindGroups.get(page.buffer);
    if (
      cached?.key === key
      && cached.visibleBuffer === visibleBuffer
    ) {
      return cached.group;
    }
    const entries: GPUBindGroupEntry[] = [{
      binding: 0,
      resource: {
        buffer: this.uniformBuffer!,
        offset: 0,
        size: WEBGPU_UNIFORM_BYTES,
      },
    }];
    if (this.selectionMaskBuffer?.buffer) {
      entries.push({
        binding: 1,
        resource: {
          buffer: this.selectionMaskBuffer.buffer,
          offset: 0,
          size: this.selectionMaskBuffer.buffer.size,
        },
      });
    }
    entries.push({
      binding: 2,
      resource: {
        buffer: page.buffer,
        offset: 0,
        size: page.buffer.size,
      },
    });
    if (visibleBuffer) {
      entries.push({
        binding: 3,
        resource: {
          buffer: visibleBuffer,
          offset: 0,
          size: visibleBuffer.size,
        },
      });
    }
    const group = this.device.createBindGroup({
      label: 'ice3:storage-instance-pipeline',
      layout: visibleBuffer
        ? this.gpuDrivenPipeline!.bindGroupLayout
        : this.storagePipeline!.bindGroupLayout,
      entries,
    });
    this.storageBindGroups.set(page.buffer, {
      key,
      ...(visibleBuffer ? { visibleBuffer } : {}),
      group,
    });
    return group;
  }

  private reportOptimizationFailure(
    layer: string,
    reason: string,
  ): void {
    const key = `${layer}/${reason}`;
    if (this.optimizationWarnings.has(key)) return;
    this.optimizationWarnings.add(key);
    this.onError?.(new ICEEngineError(
      'ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE',
      `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE: ${key}`,
      { layer, reason },
    ));
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
    this.uniformBufferGeneration += 1;
    this.frameBindGroup = null;
    this.bundleCache.invalidate();
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
    this.bundleCache.dispose();
    this.instanceCache?.dispose();
    this.picker?.dispose();
    this.selectionMaskBuffer?.dispose();
    this.storageCache?.dispose();
    this.timestampProfiler?.dispose();
    this.identityInstances?.destroy();
    this.zeroSemantics?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.geometryCache = null;
    this.instanceCache = null;
    this.selectionMaskBuffer = null;
    this.storageCache = null;
    this.picker = null;
    this.timestampProfiler = null;
    this.identityInstances = null;
    this.zeroSemantics = null;
    this.uniformBuffer = null;
    this.depthTexture = null;
    this.uniformCapacity = 0;
    this.frameBindGroup = null;
    this.bundleActive = true;
    this.storagePipeline = null;
    this.storageBindGroups.clear();
    this.renderPlan.invalidate();
    try {
      const features: GPUFeatureName[] = this.device.features.has(
        'timestamp-query',
      )
        ? ['timestamp-query']
        : [];
      const device = await this.adapter.requestDevice({
        ...(features.length > 0 ? { requiredFeatures: features } : {}),
      });
      let selectionMaskBuffer: WebGPUSelectionMaskBuffer | null = null;
      let pipeline: WebGPURenderPipeline;
      try {
        selectionMaskBuffer = new WebGPUSelectionMaskBuffer(device);
        selectionMaskBuffer.update(new Uint32Array([0]));
        pipeline = await WebGPURenderPipeline.create(
          device,
          this.format,
          { selectionMask: true },
        );
      } catch {
        selectionMaskBuffer?.dispose();
        selectionMaskBuffer = null;
        pipeline = await WebGPURenderPipeline.create(device, this.format);
      }
      if (this.disposing) {
        selectionMaskBuffer?.dispose();
        device.destroy();
        return;
      }
      this.device = device;
      this.pipeline = pipeline;
      this.selectionMaskBuffer = selectionMaskBuffer;
      this.bundleCache = new WebGPUBundleCache(device, this.format);
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
        this.resize(this.viewport, this.dpr);
      }
      this.onContextRestored?.();
    } catch (error) {
      if (this.disposing) return;
      this.onError?.(new ICEEngineError(
        'ICE3_WEBGPU_DEVICE_LOST',
        `ICE3_WEBGPU_DEVICE_LOST: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      ));
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
  readonly selectionBase: number;
  readonly color: readonly [number, number, number, number];
  readonly useVertexColor: boolean;
  readonly useInstancing: boolean;
  readonly semanticHighlight?: number;
  readonly useSemantic?: boolean;
  readonly selectionIds?: readonly string[];
  readonly useSelectionMask?: boolean;
  readonly storagePage?: ICEInstanceStoragePage;
  readonly visibilityEntry?: ICEVisibilityEntry;
  readonly clipOffset?: readonly [number, number];
  readonly edge?: boolean;
};
