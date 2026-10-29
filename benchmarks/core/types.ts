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
  | 'wastewater-mixed';

export type ICEBenchmarkScene = Readonly<{
  scene: ICEScene;
  camera: ICEPerspectiveCamera;
  meshCount: number;
  instanceCount: number;
  batchCount: number;
  trianglesPerBatch: number;
  selection: readonly string[];
  pickCount: number;
  assetUrl?: string;
}>;

export type ICEBenchmarkMetrics = Readonly<{
  initializationMs: number;
  cpuFrameMs: readonly number[];
  gpuFrameMs: readonly number[] | null;
  gpuFrameTimeUnavailableReason?: string;
  pickMs: readonly number[];
  stats: Readonly<ICERendererStats>;
}>;
