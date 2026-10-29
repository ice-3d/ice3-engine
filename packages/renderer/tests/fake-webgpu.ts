export function fakeWebGPUEnvironment(options: {
  readonly adapterLimits?: Partial<Record<keyof GPUSupportedLimits, number>>;
  readonly adapter?: GPUAdapter | null;
  readonly pipelineFails?: boolean;
  readonly deviceRequestFails?: boolean;
  readonly contextAvailable?: boolean;
  readonly deviceLost?: boolean;
} = {}) {
  let destroyed = 0;
  const limits = {
    maxTextureDimension2D: 8192,
    maxBufferSize: 1 << 30,
    maxVertexBuffers: 8,
    maxBindGroups: 4,
    ...options.adapterLimits,
  };
  const device = {
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
        features: new Set(),
        requestDevice: async () => {
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
  readonly size: readonly [number, number];
  readonly usage: GPUTextureUsageFlags;
  destroyed: boolean;
};

export function fakeWebGPUDevice(options: {
  readonly pickPixel?: Uint8Array;
  readonly capturePixel?: readonly number[];
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
  let pickPixel = new Uint8Array(options.pickPixel ?? [0, 0, 0, 255]);
  let capturePixel = new Uint8Array(options.capturePixel ?? [0, 0, 0, 255]);

  const device = {
    limits: {
      maxTextureDimension2D: 8192,
    },
    createShaderModule() {
      return {};
    },
    createBindGroupLayout() {
      return {};
    },
    createPipelineLayout() {
      return {};
    },
    createRenderPipelineAsync: async (
      description: GPURenderPipelineDescriptor,
    ) => ({ label: description.label ?? '' }),
    createBindGroup() {
      return {};
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
          const data = new Uint8Array(256);
          data.set(pickPixel, 0);
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
        size: [width, height] as const,
        usage: description.usage,
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
            ) {
              draws.push({
                indexCount,
                instanceCount,
                firstIndex,
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
        },
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
    },
    lost: new Promise(() => {}),
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
  return {
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
    setPickPixel(value: Uint8Array) {
      pickPixel = value;
    },
    setCapturePixel(value: Uint8Array) {
      capturePixel = value;
    },
    mappedPixels: () => new Uint8Array(pickPixel),
    currentCapturePixel: () => new Uint8Array(capturePixel),
  };
}

export async function readyBackend(
  fake: ReturnType<typeof fakeWebGPUDevice>,
  callbacks: {
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  } = {},
): Promise<WebGPURendererBackend> {
  const backend = await WebGPURendererBackend.create(fake.context);
  backend.initialize({ canvas: fake.canvas(), ...callbacks });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);
  return backend;
}
import { WebGPURendererBackend } from '../src/WebGPURendererBackend';
