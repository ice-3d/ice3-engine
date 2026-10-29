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
  type ICEFrameStageProfile,
  type ICEWebGPUOptimizationStats,
} from '@ice3/renderer';
import { benchmarkScene } from '../core/scenarios';
import { cloneBenchmarkScene } from '../core/cloneScene';
import type {
  ICEBenchmarkCpuStageSamples,
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
  readonly forceStorage?: boolean;
  readonly forceGpuDriven?: boolean;
};

export type ICEBenchmarkRun = {
  readonly backend: 'webgl2' | 'webgpu';
  readonly scenario: ICEBenchmarkScenarioId;
  readonly initializationMs: number;
  readonly cpuFrameMs: readonly number[];
  readonly cpuStages: ICEBenchmarkCpuStageSamples;
  readonly gpuFrameMs: readonly number[] | null;
  readonly gpuFrameTimeUnavailableReason?: string;
  readonly pickMs: readonly number[];
  readonly stats: Readonly<ICERendererStats>;
  readonly optimization?: ICEWebGPUOptimizationStats;
};

type ICEBenchmarkProfileBackend = ICERendererBackend & {
  enableProfiling(enabled: boolean): void;
  readonly frameProfile: ICEFrameStageProfile | null;
  readonly timestampProfilingAvailable?: boolean;
  readonly timestampProfilingUnavailableReason?: string;
  enableTimestampProfiling?(enabled: boolean): void;
  drainGpuTimings?(): Promise<readonly number[]>;
  readonly optimizationStats?: ICEWebGPUOptimizationStats;
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
    const backend = await createBackend(
      request.backend,
      request.forceStorage,
      request.forceGpuDriven,
    );
    backend.enableProfiling(true);
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
    const gpuFrameMs: number[] | null = backend.timestampProfilingAvailable
      ? []
      : null;
    for (let index = 0; index < request.warmup; index += 1) {
      frame.frameId += 1;
      backend.render(frame);
    }
    await backend.finish?.();
    backend.enableTimestampProfiling?.(true);
    if (gpuFrameMs) {
      await backend.drainGpuTimings?.();
    }
    const cpuFrameMs: number[] = [];
    const cpuStages = {
      collectMs: [] as number[],
      prepareAndUploadMs: [] as number[],
      encodeMs: [] as number[],
      submitMs: [] as number[],
    };
    for (let index = 0; index < request.frames; index += 1) {
      frame.frameId += 1;
      const frameStartedAt = performance.now();
      backend.render(frame);
      cpuFrameMs.push(performance.now() - frameStartedAt);
      const profile = backend.frameProfile;
      if (!profile) {
        throw new Error('ICE3_BENCHMARK_INVALID: frame profile is unavailable');
      }
      cpuStages.collectMs.push(profile.collectMs);
      cpuStages.prepareAndUploadMs.push(profile.prepareAndUploadMs);
      cpuStages.encodeMs.push(profile.encodeMs);
      cpuStages.submitMs.push(profile.submitMs);
      if ((index + 1) % 30 === 0) {
        await backend.finish?.();
        if (gpuFrameMs) {
          gpuFrameMs.push(...(await backend.drainGpuTimings?.() ?? []));
        }
      }
    }
    await backend.finish?.();
    if (gpuFrameMs) {
      gpuFrameMs.push(...(await backend.drainGpuTimings?.() ?? []));
    }
    const pickMs: number[] = [];
    for (let index = 0; index < benchmark.pickCount; index += 1) {
      const pickStartedAt = performance.now();
      await backend.pick?.(frame, { x: WIDTH / 2, y: HEIGHT / 2 });
      pickMs.push(performance.now() - pickStartedAt);
    }
    const gpuFrameTimeUnavailableReason = gpuFrameMs === null
      ? 'timestamp-query unavailable'
      : gpuFrameMs.length === 0
        ? backend.timestampProfilingUnavailableReason
          ?? 'timestamp samples unavailable'
        : undefined;
    return {
      backend: request.backend,
      scenario: request.scenario,
      initializationMs,
      cpuFrameMs,
      cpuStages,
      gpuFrameMs,
      ...(gpuFrameTimeUnavailableReason
        ? { gpuFrameTimeUnavailableReason }
        : {}),
      pickMs,
      stats: backend.stats ?? emptyStats(),
      ...(backend.optimizationStats
        ? { optimization: backend.optimizationStats }
        : {}),
    };
  } finally {
    disposeScene?.();
    engine?.destroy();
    host.remove();
  }
}

async function createBackend(
  backend: 'webgl2' | 'webgpu',
  forceStorage = false,
  forceGpuDriven = false,
): Promise<ICEBenchmarkProfileBackend> {
  if (backend === 'webgl2') return new WebGL2RendererBackend();
  const probe = await probeWebGPU({
    optionalFeatures: ['timestamp-query'],
  });
  if (!probe.supported) {
    throw new Error(`WEBGPU_UNSUPPORTED: ${probe.reason}`);
  }
  return WebGPURendererBackend.create(probe, {
    forceStoragePath: forceStorage,
    forceGpuDriven,
  });
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
  const scaled = benchmark.scale > 1
    ? cloneBenchmarkScene(handle.scene, benchmark.scale)
    : handle.scene;
  engine.setScene(scaled).start();
  engine.stop();
  return {
    scene: scaled,
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
    'instanced-50k',
    'culling-20k',
    'wastewater-mixed',
    'wastewater-1x',
    'wastewater-5x',
    'wastewater-20x',
  ].includes(value);
}
