import type { ICEPerspectiveCamera, ICEScene } from '@ice3/core';

export type ICEViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ICEFrame = {
  readonly frameId: number;
  readonly scene: ICEScene;
  readonly camera: ICEPerspectiveCamera;
  readonly viewport: ICEViewport;
  readonly dpr: number;
};

export interface ICERendererCapabilities {
  readonly backend: 'webgl2' | 'fake';
  readonly maxTextureSize: number;
}

export interface ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  }): void;
  resize(viewport: ICEViewport, dpr: number): void;
  setBackgroundColor?(color: string): void;
  render(frame: ICEFrame): void;
  capture?(): Promise<Blob>;
  dispose(): void;
}
