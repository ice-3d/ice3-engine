const WEBGPU_TIMEOUT_MS = 3000;

const REQUIRED_LIMITS = [
  ['maxTextureDimension2D', 4096],
  ['maxBufferSize', 268_435_456],
  ['maxVertexBuffers', 2],
  ['maxBindGroups', 2],
] as const satisfies readonly (readonly [
  keyof GPUSupportedLimits,
  number,
])[];

const PROBE_SHADER = `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}
`;

export type ICEWebGPUProbeFailureReason =
  | 'document-unavailable'
  | 'api-unavailable'
  | 'adapter-unavailable'
  | 'adapter-timeout'
  | 'feature-missing'
  | 'limit-too-low'
  | 'device-failed'
  | 'context-failed'
  | 'pipeline-failed'
  | 'device-lost';

export type ICEWebGPUProbeResult =
  | {
      readonly supported: true;
      readonly adapter: GPUAdapter;
      readonly device: GPUDevice;
      readonly format: GPUTextureFormat;
    }
  | {
      readonly supported: false;
      readonly reason: ICEWebGPUProbeFailureReason;
      readonly detail?: string;
    };

export type ICEWebGPUProbeOptions = {
  readonly gpu?: GPU;
  readonly timeoutMs?: number;
  readonly createCanvas?: () => OffscreenCanvas | HTMLCanvasElement;
};

const successfulProbes = new WeakMap<
  GPU,
  Promise<ICEWebGPUProbeResult>
>();

export function probeWebGPU(
  options: ICEWebGPUProbeOptions = {},
): Promise<ICEWebGPUProbeResult> {
  const gpu = options.gpu
    ?? (
      typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { readonly gpu?: GPU }).gpu
    );
  if (!gpu) {
    return Promise.resolve(failure(
      'api-unavailable',
      'navigator.gpu is unavailable',
    ));
  }

  const cached = successfulProbes.get(gpu);
  if (cached) return cached;

  const probe = executeProbe(gpu, options);
  successfulProbes.set(gpu, probe);
  void probe.then((result) => {
    if (!result.supported) successfulProbes.delete(gpu);
  });
  return probe;
}

async function executeProbe(
  gpu: GPU,
  options: ICEWebGPUProbeOptions,
): Promise<ICEWebGPUProbeResult> {
  const timeoutMs = options.timeoutMs ?? WEBGPU_TIMEOUT_MS;
  const timeout = Symbol('timeout');
  let adapter: GPUAdapter | null | typeof timeout;
  try {
    adapter = await Promise.race([
      gpu.requestAdapter({ powerPreference: 'high-performance' }),
      new Promise<typeof timeout>((resolve) => {
        setTimeout(() => resolve(timeout), timeoutMs);
      }),
    ]);
  } catch (error) {
    return failure('adapter-unavailable', errorMessage(error));
  }
  if (adapter === timeout) {
    return failure('adapter-timeout', `Adapter lookup exceeded ${timeoutMs}ms`);
  }
  if (!adapter) {
    return failure('adapter-unavailable', 'requestAdapter returned null');
  }

  for (const [name, minimum] of REQUIRED_LIMITS) {
    const value = adapter.limits[name];
    if (typeof value !== 'number' || value < minimum) {
      return failure(
        'limit-too-low',
        `${name} requires at least ${minimum}; received ${String(value)}`,
      );
    }
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return failure('device-failed', errorMessage(error));
  }

  const canvas = createProbeCanvas(options.createCanvas);
  if (!canvas) {
    device.destroy();
    return failure('document-unavailable', 'No Canvas implementation is available');
  }
  let context: GPUCanvasContext | null;
  try {
    context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  } catch (error) {
    device.destroy();
    return failure('context-failed', errorMessage(error));
  }
  if (!context) {
    device.destroy();
    return failure('context-failed', 'WebGPU canvas context is unavailable');
  }

  try {
    const format = gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });
    const module = device.createShaderModule({ code: PROBE_SHADER });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const texture = context.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);

    const lost = await Promise.race([
      device.lost.then((info) => info.message || info.reason),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 0);
      }),
    ]);
    if (lost) {
      device.destroy();
      return failure('device-lost', lost);
    }
    return {
      supported: true,
      adapter,
      device,
      format,
    };
  } catch (error) {
    device.destroy();
    return failure('pipeline-failed', errorMessage(error));
  }
}

function createProbeCanvas(
  createCanvas: ICEWebGPUProbeOptions['createCanvas'],
): OffscreenCanvas | HTMLCanvasElement | undefined {
  if (createCanvas) return createCanvas();
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(64, 64);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    return canvas;
  }
  return undefined;
}

function failure(
  reason: ICEWebGPUProbeFailureReason,
  detail?: string,
): ICEWebGPUProbeResult {
  return {
    supported: false,
    reason,
    ...(detail ? { detail } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
