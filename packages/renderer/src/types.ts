import type {
  ICEGeometry,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';

export type ICEViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

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
  readonly backend: 'webgl2' | 'fake';
  readonly maxTextureSize: number;
  readonly picking: boolean;
}

export interface ICERendererStats {
  readonly drawCalls: number;
  readonly renderedMeshes: number;
  readonly renderedBatches: number;
  readonly instancingFallbacks: number;
  readonly gpuUploads: number;
  readonly gpuEvictions: number;
  readonly gpuBytes: number;
}

export interface ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  readonly stats?: Readonly<ICERendererStats>;
  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  }): void;
  resize(viewport: ICEViewport, dpr: number): void;
  setBackgroundColor?(color: string): void;
  prepareBatchGeometry?(geometry: ICEGeometry): void;
  releaseBatchGeometry?(geometry: ICEGeometry): void;
  pick?(frame: ICEFrame, point: ICEScreenPoint): string | undefined;
  render(frame: ICEFrame): void;
  capture?(): Promise<Blob>;
  dispose(): void;
}
