export function fakeWebGPUEnvironment(options: {
  readonly adapterLimits?: Partial<Record<keyof GPUSupportedLimits, number>>;
  readonly adapterFeatures?: readonly GPUFeatureName[];
  readonly adapter?: GPUAdapter | null;
  readonly pipelineFails?: boolean;
  readonly deviceRequestFails?: boolean;
  readonly contextAvailable?: boolean;
  readonly deviceLost?: boolean;
} = {}) {
  let destroyed = 0;
  const deviceRequests: GPUDeviceDescriptor[] = [];
  const features = new Set<GPUFeatureName>(options.adapterFeatures ?? []);
  const enabledFeatures = new Set<GPUFeatureName>();
  const limits = {
    maxTextureDimension2D: 8192,
    maxBufferSize: 1 << 30,
    maxVertexBuffers: 8,
    maxBindGroups: 4,
    ...options.adapterLimits,
  };
  const device = {
    features: enabledFeatures,
    destroy() {
      destroyed += 1;
    },
    lost: options.deviceLost
      ? Promise.resolve({ reason: 'unknown', message: 'lost during probe' })
      : new Promise(() => {}),
    createShaderModule() {
      return {};
    },
    createRenderPipelineAsync: async () => {
      if (options.pipelineFails) throw new Error('pipeline failed');
      return {};
    },
    createCommandEncoder() {
      return {
        beginRenderPass() {
          return {
            setPipeline() {},
            draw() {},
            end() {},
          };
        },
        finish() {
          return {};
        },
      };
    },
    queue: {
      submit() {},
    },
  } as unknown as GPUDevice;
  const context = {
    configure() {},
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const canvas = {
    width: 64,
    height: 64,
    getContext: () => options.contextAvailable === false ? null : context,
  } as unknown as HTMLCanvasElement;
  let adapterRequests = 0;
  const adapter = options.adapter === undefined
    ? {
        limits,
        features,
        requestDevice: async (descriptor?: GPUDeviceDescriptor) => {
          if (descriptor) deviceRequests.push(descriptor);
          enabledFeatures.clear();
          for (const feature of descriptor?.requiredFeatures ?? []) {
            enabledFeatures.add(feature);
          }
          if (options.deviceRequestFails) {
            throw new Error('device failed');
          }
          return device;
        },
      } as unknown as GPUAdapter
    : options.adapter;
  const gpu = {
    requestAdapter: async () => {
      adapterRequests += 1;
      return adapter;
    },
    getPreferredCanvasFormat: () => 'bgra8unorm' as GPUTextureFormat,
  } as unknown as GPU;
  return {
    adapter,
    device,
    deviceRequests,
    gpu,
    canvas,
    adapterRequestCount: () => adapterRequests,
    destroyCount: () => destroyed,
  };
}

type FakeBuffer = GPUBuffer & {
  readonly size: number;
  readonly usage: GPUBufferUsageFlags;
  readonly label: string;
  destroyed: boolean;
};

type FakeTexture = GPUTexture & {
  readonly label: string;
  readonly size: readonly [number, number];
  readonly usage: GPUTextureUsageFlags;
  readonly format: GPUTextureFormat;
  destroyed: boolean;
};

export function fakeWebGPUDevice(options: {
  readonly pickPixel?: Uint8Array;
  readonly capturePixel?: readonly number[];
  readonly replacementFails?: boolean;
  readonly features?: readonly GPUFeatureName[];
  readonly timestampValues?: readonly number[];
  readonly timestampMapFails?: boolean;
  readonly selectionMaskLayoutFails?: boolean;
  readonly bundleCreationFails?: boolean;
  readonly bundleExecutionFails?: boolean;
  readonly limits?: Partial<Record<keyof GPUSupportedLimits, number>>;
  readonly storagePipelineFails?: boolean;
} = {}) {
  const buffers: FakeBuffer[] = [];
  const writes: Array<{
    readonly buffer: FakeBuffer;
    readonly offset: number;
    readonly size: number;
    readonly data: Uint8Array;
  }> = [];
  const depthTextures: FakeTexture[] = [];
  const submissions: GPUCommandBuffer[][] = [];
  const renderPasses: any[] = [];
  const draws: any[] = [];
  const selectionDraws: any[] = [];
  const contexts: any[] = [];
  const copyCalls: any[] = [];
  const deviceRequests: GPUDeviceDescriptor[] = [];
  const querySets: Array<{
    readonly type: GPUQueryType;
    readonly count: number;
    destroyed: boolean;
    destroy(): void;
  }> = [];
  const bundleEncoders: any[] = [];
  const executedBundles: GPURenderBundle[][] = [];
  let pickPixel = new Uint8Array(options.pickPixel ?? [0, 0, 0, 255]);
  let capturePixel = new Uint8Array(options.capturePixel ?? [0, 0, 0, 255]);
  let timestampValues = [...(options.timestampValues
    ?? [1_000_000_000, 1_002_000_000])];
  let captureCopies = 0;
  let mappedBytes = new Uint8Array();
  let submittedWorkWaits = 0;
  let resolveLost!: (info: GPUDeviceLostInfo) => void;
  let resolveReplacement!: (device: GPUDevice) => void;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });
  const replacement = new Promise<GPUDevice>((resolve) => {
    resolveReplacement = resolve;
  });

  const device = {
    features: new Set<GPUFeatureName>(options.features ?? []),
    limits: {
      maxTextureDimension2D: 8192,
      ...options.limits,
    },
    createShaderModule() {
      return {};
    },
    createBindGroupLayout(description?: GPUBindGroupLayoutDescriptor) {
      if (
        options.selectionMaskLayoutFails
        && (description?.entries.length ?? 0) > 1
      ) {
        throw new Error('selection mask layout failed');
      }
      return {};
    },
    createPipelineLayout() {
      return {};
    },
    createRenderPipelineAsync: async (
      description: GPURenderPipelineDescriptor,
    ) => {
      if (
        options.storagePipelineFails
        && description.label?.includes(':storage')
      ) {
        throw new Error('storage pipeline failed');
      }
      return { label: description.label ?? '' };
    },
    createBindGroup() {
      return {};
    },
    createQuerySet(description: GPUQuerySetDescriptor) {
      const querySet = {
        type: description.type,
        count: description.count,
        destroyed: false,
        destroy() {
          querySet.destroyed = true;
        },
      };
      querySets.push(querySet);
      return querySet as unknown as GPUQuerySet;
    },
    createRenderBundleEncoder(
      description: GPURenderBundleEncoderDescriptor,
    ) {
      if (options.bundleCreationFails) {
        throw new Error('bundle creation failed');
      }
      const calls: string[] = [];
      const bundleDraws: any[] = [];
      let currentPipeline: { readonly label?: string } | undefined;
      const encoder = {
        description,
        calls,
        setPipeline(pipeline: { readonly label?: string }) {
          currentPipeline = pipeline;
          calls.push('setPipeline');
        },
        setBindGroup: () => calls.push('setBindGroup'),
        setVertexBuffer: () => calls.push('setVertexBuffer'),
        setIndexBuffer: () => calls.push('setIndexBuffer'),
        drawIndexed(
          indexCount: number,
          instanceCount = 1,
          firstIndex = 0,
          baseVertex = 0,
          firstInstance = 0,
        ) {
          calls.push('drawIndexed');
          bundleDraws.push({
            indexCount,
            instanceCount,
            firstIndex,
            baseVertex,
            firstInstance,
            pipeline: currentPipeline?.label,
          });
        },
        finish: () => ({ calls, draws: bundleDraws }),
      };
      bundleEncoders.push(encoder);
      return encoder;
    },
    createBuffer(description: GPUBufferDescriptor) {
      const buffer = {
        size: description.size,
        usage: description.usage,
        label: description.label ?? '',
        destroyed: false,
        destroy() {
          buffer.destroyed = true;
        },
        async mapAsync() {},
        getMappedRange() {
          const data = new Uint8Array(buffer.size);
          if (buffer.label.includes('timestamp-resolve')) {
            if (options.timestampMapFails) {
              throw new Error('timestamp map failed');
            }
            const values = new BigUint64Array(
              timestampValues.map((value) => BigInt(value)),
            );
            data.set(new Uint8Array(
              values.buffer,
              values.byteOffset,
              values.byteLength,
            ));
          } else {
            data.set(
              buffer.label.includes('capture') ? capturePixel : pickPixel,
              0,
            );
          }
          mappedBytes = data.slice();
          return data.buffer;
        },
        unmap() {},
      } as FakeBuffer;
      buffers.push(buffer);
      return buffer;
    },
    createTexture(description: GPUTextureDescriptor) {
      const width = typeof description.size === 'number'
        ? description.size
        : description.size[0];
      const height = typeof description.size === 'number'
        ? description.size
        : description.size[1];
      const texture = {
        label: description.label ?? '',
        size: [width, height] as const,
        usage: description.usage,
        format: description.format,
        destroyed: false,
        createView: () => ({ texture }),
        destroy() {
          texture.destroyed = true;
        },
      } as unknown as FakeTexture;
      depthTextures.push(texture);
      return texture;
    },
    createCommandEncoder() {
      return {
        beginRenderBundleEncoder(
          description: GPURenderBundleEncoderDescriptor,
        ) {
          if (options.bundleCreationFails) {
            throw new Error('bundle creation failed');
          }
          const calls: string[] = [];
          const encoder = {
            description,
            calls,
            setPipeline: () => calls.push('setPipeline'),
            setBindGroup: () => calls.push('setBindGroup'),
            setVertexBuffer: () => calls.push('setVertexBuffer'),
            setIndexBuffer: () => calls.push('setIndexBuffer'),
            drawIndexed: () => calls.push('drawIndexed'),
            finish: () => ({ calls }),
          };
          bundleEncoders.push(encoder);
          return encoder;
        },
        beginRenderPass(description: GPURenderPassDescriptor) {
          const attachment = description.colorAttachments[0]!;
          let currentPipeline: { readonly label?: string } | undefined;
          let lastSelectionLabel: string | undefined;
          const pass = {
            description,
            clearValue: attachment.clearValue,
            draws,
            setPipeline(pipeline: { readonly label?: string }) {
              currentPipeline = pipeline;
              if (
                pipeline.label?.startsWith('selection:')
                && pipeline.label !== lastSelectionLabel
              ) {
                selectionDraws.push(pipeline);
                lastSelectionLabel = pipeline.label;
              }
            },
            setBindGroup() {},
            setVertexBuffer() {},
            setIndexBuffer() {},
            executeBundles(bundles: GPURenderBundle[]) {
              if (options.bundleExecutionFails) {
                throw new Error('bundle execution failed');
              }
              executedBundles.push(bundles);
              for (const bundle of bundles) {
                draws.push(...((bundle as any).draws ?? []));
              }
            },
            draw(indexCount: number, instanceCount = 1) {
              draws.push({
                indexCount,
                instanceCount,
                pipeline: currentPipeline?.label,
              });
            },
            drawIndexed(
              indexCount: number,
              instanceCount = 1,
              firstIndex = 0,
              baseVertex = 0,
              firstInstance = 0,
            ) {
              draws.push({
                indexCount,
                instanceCount,
                firstIndex,
                baseVertex,
                firstInstance,
                pipeline: currentPipeline?.label,
              });
            },
            end() {},
          };
          renderPasses.push(pass);
          return pass;
        },
        copyTextureToBuffer(
          source: GPUTexelCopyTextureInfo,
          destination: GPUTexelCopyBufferInfo,
          extent: GPUExtent3DStrict,
        ) {
          copyCalls.push({
            source,
            destination,
            ...extent,
            origin: source.origin,
          });
          if (
            (destination.buffer as FakeBuffer).label.includes('capture')
          ) {
            captureCopies += 1;
          }
        },
        resolveQuerySet() {},
        finish() {
          return {};
        },
      };
    },
    queue: {
      writeBuffer(
        buffer: FakeBuffer,
        offset: number,
        data: ArrayBufferView,
      ) {
        const bytes = data instanceof Uint8Array
          ? data.slice()
          : new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            ).slice();
        writes.push({ buffer, offset, size: bytes.byteLength, data: bytes });
      },
      submit(commands: GPUCommandBuffer[]) {
        submissions.push(commands);
      },
      async onSubmittedWorkDone() {
        submittedWorkWaits += 1;
      },
    },
    lost,
    destroy() {},
  } as unknown as GPUDevice;

  const context = {
    adapter: undefined as GPUAdapter | undefined,
    device,
    format: 'bgra8unorm' as GPUTextureFormat,
    configuration: undefined as GPUCanvasConfiguration | undefined,
    configure(configuration: GPUCanvasConfiguration) {
      context.configuration = configuration;
      contexts.push(context);
    },
    unconfigure() {
      context.configuration = undefined;
    },
    getCurrentTexture: () => ({
      createView: () => ({}),
    }),
    currentTexture: {
      createView: () => ({}),
    },
  };
  const canvas = {
    width: 320,
    height: 180,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const adapter = {
    limits: {
      maxTextureDimension2D: 8192,
      maxBufferSize: 1 << 30,
    },
    features: new Set(),
    requestDevice: async (descriptor?: GPUDeviceDescriptor) => {
      if (descriptor) deviceRequests.push(descriptor);
      if (options.replacementFails) {
        throw new Error('replacement failed');
      }
      return replacement;
    },
  } as unknown as GPUAdapter;
  context.adapter = adapter;
  return {
    adapter,
    device,
    context,
    canvas: () => canvas,
    buffers,
    writes,
    submissions,
    renderPasses,
    draws,
    selectionDraws,
    contexts,
    copyCalls,
    depthTextures,
    deviceRequests,
    querySets,
    bundleEncoders,
    executedBundles,
    setPickPixel(value: Uint8Array) {
      pickPixel = value;
    },
    setCapturePixel(value: Uint8Array) {
      capturePixel = value;
    },
    setTimestampValues(values: readonly number[]) {
      timestampValues = [...values];
    },
    mappedPixels: () => new Uint8Array(pickPixel),
    currentCapturePixel: () => new Uint8Array(capturePixel),
    captureCopyCount: () => captureCopies,
    lastMappedBytes: () => mappedBytes.slice(),
    submittedWorkWaitCount: () => submittedWorkWaits,
    async loseDevice(reason: GPUDeviceLostReason) {
      resolveLost({ reason, message: `lost:${reason}` });
      await Promise.resolve();
    },
    async completeReplacementDevice() {
      const next = Object.assign({}, device, {
        lost: new Promise<GPUDeviceLostInfo>(() => {}),
      }) as GPUDevice;
      resolveReplacement(next);
      await Promise.resolve();
    },
  };
}

export async function readyBackend(
  fake: ReturnType<typeof fakeWebGPUDevice>,
  callbacks: {
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
    readonly onError?: (error: Error) => void;
  } = {},
  options: {
    readonly forceStoragePath?: boolean;
  } = {},
): Promise<WebGPURendererBackend> {
  const backend = await WebGPURendererBackend.create(
    fake.context,
    options,
  );
  backend.initialize({ canvas: fake.canvas(), ...callbacks });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);
  return backend;
}
import { WebGPURendererBackend } from '../src/WebGPURendererBackend';
