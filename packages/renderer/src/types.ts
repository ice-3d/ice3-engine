import type {
  ICEGeometry,
  ICEGeometryBufferUpdate,
  ICEEngineError,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';

export type ICEViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ICEWebGPUOptimizationFailureReason =
  | 'limit-too-low'
  | 'pipeline-failed'
  | 'resource-failed'
  | 'runtime-failed'
  | 'threshold-not-met';

export type ICE3RendererPreference = 'auto' | 'webgpu' | 'webgl2';

export type ICE3RendererSelection = Readonly<{
  requested: ICE3RendererPreference | 'custom';
  selected: 'webgl2' | 'webgpu' | 'fake';
  fallback: boolean;
  experimental: boolean;
  probeDurationMs?: number;
  fallbackReason?: import('./WebGPUProbe.js').ICEWebGPUProbeFailureReason;
}>;

export type ICEScreenPoint = Readonly<{ x: number; y: number }>;

export type ICEFrame = {
  readonly frameId: number;
  readonly scene: ICEScene;
  readonly camera: ICEPerspectiveCamera;
  readonly viewport: ICEViewport;
  readonly dpr: number;
  readonly selection: readonly string[];
};

export interface ICERendererCapabilities {
  readonly backend: 'webgl2' | 'webgpu' | 'fake';
  readonly maxTextureSize: number;
  readonly picking: boolean;
}

export interface ICERendererStats {
  readonly drawCalls: number;
  /**
   * 实例化通道本帧提交的实例总数，不含单体通道与边线叠加。
   *
   * 存在的理由：实例化之后 `drawCalls` 与实际画了多少个网格脱钩，加一个网格可能
   * 一个 draw call 都不多。没有这个计数，调用方无法从诊断判断"改动到底画出来没有"。
   */
  readonly renderedInstances: number;
  readonly renderedMeshes: number;
  readonly renderedBatches: number;
  readonly instancingFallbacks: number;
  readonly gpuUploads: number;
  readonly gpuEvictions: number;
  readonly gpuBytes: number;
  readonly instanceUploads: number;
  readonly instanceUploadBytes: number;
}

export interface ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  readonly stats?: Readonly<ICERendererStats>;
  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
    readonly onError?: (error: ICEEngineError) => void;
    /** A deferred GPU upload (for example a base-colour texture) just landed. */
    readonly onUploadReady?: () => void;
    /** Directional-light shadows. On by default; pass false to skip the extra scene pass. */
    readonly shadows?: boolean;
  }): void;
  resize(viewport: ICEViewport, dpr: number): void;
  setBackgroundColor?(color: string): void;
  /** Clip plane `[nx, ny, nz, d]`: fragments with `dot(world, n) + d < 0` are discarded; `null` disables. */
  setClipPlane?(plane: readonly [number, number, number, number] | null): void;
  prepareBatchGeometry?(geometry: ICEGeometry): void;
  releaseBatchGeometry?(geometry: ICEGeometry): void;
  prepareGeometry?(
    geometry: ICEGeometry,
    update?: ICEGeometryBufferUpdate,
  ): void;
  releaseGeometry?(geometry: ICEGeometry): void;
  pick?(
    frame: ICEFrame,
    point: ICEScreenPoint,
  ): Promise<string | undefined>;
  render(frame: ICEFrame): void;
  finish?(): Promise<void>;
  capture?(): Promise<Blob>;
  dispose(): void;
}
