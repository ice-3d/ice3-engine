import {
  ICE3,
  ICETilesetLoader,
  type ICEPerspectiveCamera,
  type ICEScene,
} from 'ice3';
import {
  WebGL2RendererBackend,
  WebGPURendererBackend,
  probeWebGPU,
  type ICERendererBackend,
  type ICERendererStats,
} from '@ice3/renderer';
import { benchmarkScene } from '../core/scenarios';
import type {
  ICEBenchmarkScenarioId,
  ICEBenchmarkScene,
} from '../core/types';

const WIDTH = 1280;
const HEIGHT = 720;

export type ICEBenchmarkRunRequest = {
  readonly backend: 'webgl2' | 'webgpu';
  readonly scenario: ICEBenchmarkScenarioId;
  readonly warmup: number;
  readonly frames: number;
};

export type ICEBenchmarkRun = {
  readonly backend: 'webgl2' | 'webgpu';
  readonly scenario: ICEBenchmarkScenarioId;
  readonly initializationMs: number;
  readonly cpuFrameMs: readonly number[];
  readonly gpuFrameMs: readonly number[] | null;
  readonly gpuFrameTimeUnavailableReason: string;
  readonly pickMs: readonly number[];
  readonly stats: Readonly<ICERendererStats>;
};

async function run(
  request: ICEBenchmarkRunRequest,
): Promise<ICEBenchmarkRun> {
  if (
    !Number.isInteger(request.warmup)
    || request.warmup < 0
    || !Number.isInteger(request.frames)
    || request.frames < 1
  ) {
    throw new Error('ICE3_BENCHMARK_INVALID: frame counts are invalid');
  }
  const startedAt = performance.now();
  const host = document.createElement('div');
  host.style.cssText = `position:relative;width:${WIDTH}px;height:${HEIGHT}px`;
  document.querySelector('#stage')!.appendChild(host);
  let engine: ICE3 | undefined;
  let disposeScene: (() => void) | undefined;
  try {
    const backend = await createBackend(request.backend);
    engine = new ICE3({ backend });
    engine.init(host);
    backend.resize({ x: 0, y: 0, width: WIDTH, height: HEIGHT }, 1);
    const initializationMs = performance.now() - startedAt;
    const benchmark = await resolveScene(engine, request.scenario);
    disposeScene = benchmark.dispose;
    engine.setScene(benchmark.scene).setCamera(benchmark.camera);
    const frame = {
      frameId: 0,
      scene: benchmark.scene,
      camera: benchmark.camera,
      viewport: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      dpr: 1,
      selection: benchmark.selection,
    };
    for (let index = 0; index < request.warmup; index += 1) {
      frame.frameId += 1;
      backend.render(frame);
    }
    const cpuFrameMs: number[] = [];
    for (let index = 0; index < request.frames; index += 1) {
      frame.frameId += 1;
      const frameStartedAt = performance.now();
      backend.render(frame);
      cpuFrameMs.push(performance.now() - frameStartedAt);
    }
    const pickMs: number[] = [];
    for (let index = 0; index < benchmark.pickCount; index += 1) {
      const pickStartedAt = performance.now();
      await backend.pick?.(frame, { x: WIDTH / 2, y: HEIGHT / 2 });
      pickMs.push(performance.now() - pickStartedAt);
    }
    return {
      backend: request.backend,
      scenario: request.scenario,
      initializationMs,
      cpuFrameMs,
      gpuFrameMs: null,
      gpuFrameTimeUnavailableReason:
        'ICE3 Renderer API does not expose portable GPU timestamps',
      pickMs,
      stats: backend.stats ?? emptyStats(),
    };
  } finally {
    disposeScene?.();
    engine?.destroy();
    host.remove();
  }
}

async function createBackend(
  backend: 'webgl2' | 'webgpu',
): Promise<ICERendererBackend> {
  if (backend === 'webgl2') return new WebGL2RendererBackend();
  const probe = await probeWebGPU();
  if (!probe.supported) {
    throw new Error(`WEBGPU_UNSUPPORTED: ${probe.reason}`);
  }
  return WebGPURendererBackend.create(probe);
}

async function resolveScene(
  engine: ICE3,
  scenarioId: ICEBenchmarkScenarioId,
): Promise<{
  scene: ICEScene;
  camera: ICEPerspectiveCamera;
  selection: readonly string[];
  pickCount: number;
  dispose: () => void;
}> {
  const benchmark: ICEBenchmarkScene = benchmarkScene(scenarioId);
  if (!benchmark.assetUrl) {
    return {
      scene: benchmark.scene,
      camera: benchmark.camera,
      selection: benchmark.selection,
      pickCount: benchmark.pickCount,
      dispose: () => undefined,
    };
  }
  engine.setCamera(benchmark.camera);
  engine.setScene(benchmark.scene).start();
  const loader = new ICETilesetLoader(engine, { camera: benchmark.camera });
  const handle = await loader.open(benchmark.assetUrl);
  await handle.whenIdle();
  engine.stop();
  return {
    scene: handle.scene,
    camera: benchmark.camera,
    selection: benchmark.selection,
    pickCount: benchmark.pickCount,
    dispose: () => handle.dispose(),
  };
}

function emptyStats(): ICERendererStats {
  return {
    drawCalls: 0,
    renderedMeshes: 0,
    renderedBatches: 0,
    instancingFallbacks: 0,
    gpuUploads: 0,
    gpuEvictions: 0,
    gpuBytes: 0,
  };
}

window.__ice3Benchmark = { run };

const params = new URLSearchParams(location.search);
const backend = params.get('backend');
const scenario = params.get('scenario');
if (
  (backend === 'webgl2' || backend === 'webgpu')
  && scenario
  && isScenario(scenario)
) {
  const status = document.querySelector<HTMLOutputElement>('#status')!;
  const result = document.querySelector<HTMLPreElement>('#result')!;
  void run({
    backend,
    scenario,
    warmup: Number(params.get('warmup') ?? 60),
    frames: Number(params.get('frames') ?? 300),
  }).then((value) => {
    status.textContent = 'Complete';
    result.textContent = JSON.stringify(value, null, 2);
  }).catch((error) => {
    status.textContent = 'Failed';
    result.textContent = error instanceof Error
      ? error.stack ?? error.message
      : String(error);
  });
}

function isScenario(value: string): value is ICEBenchmarkScenarioId {
  return [
    'unique-meshes',
    'instanced-grid',
    'static-batches',
    'selection',
    'picking',
    'wastewater-mixed',
  ].includes(value);
}
