import type {
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';
import type { ICERendererStats } from '@ice3/renderer';

export type ICEBenchmarkScenarioId =
  | 'unique-meshes'
  | 'instanced-grid'
  | 'static-batches'
  | 'selection'
  | 'picking'
  | 'instanced-50k'
  | 'culling-20k'
  | 'wastewater-mixed'
  | 'wastewater-1x'
  | 'wastewater-5x'
  | 'wastewater-20x';

export type ICEBenchmarkScene = Readonly<{
  scene: ICEScene;
  camera: ICEPerspectiveCamera;
  meshCount: number;
  instanceCount: number;
  batchCount: number;
  trianglesPerBatch: number;
  selection: readonly string[];
  pickCount: number;
  scale: number;
  visibleInstanceHint?: number;
  assetUrl?: string;
}>;

export type ICEBenchmarkMetrics = Readonly<{
  initializationMs: number;
  cpuFrameMs: readonly number[];
  cpuStages: ICEBenchmarkCpuStageSamples;
  gpuFrameMs: readonly number[] | null;
  gpuFrameTimeUnavailableReason?: string;
  pickMs: readonly number[];
  stats: Readonly<ICERendererStats>;
}>;

export type ICEBenchmarkCpuStageSamples = Readonly<{
  collectMs: readonly number[];
  prepareAndUploadMs: readonly number[];
  encodeMs: readonly number[];
  submitMs: readonly number[];
}>;
