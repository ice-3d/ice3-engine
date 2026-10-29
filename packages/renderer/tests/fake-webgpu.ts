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
