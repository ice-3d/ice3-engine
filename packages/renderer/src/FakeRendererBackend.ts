import { ICEEngineError } from '@ice3/core';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICERendererStats,
  ICEViewport,
} from './types.js';

export class FakeRendererBackend implements ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  readonly stats: Readonly<ICERendererStats>;
  readonly frames: ICEFrame[] = [];
  lastViewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  lastBackgroundColor = '#09111f';
  pickResult: string | undefined;
  pickError: Error | undefined;
  private disposed = false;
  private disposals = 0;

  constructor(options: {
    readonly picking?: boolean;
    readonly stats?: ICERendererStats;
  } = {}) {
    this.capabilities = {
      backend: 'fake',
      maxTextureSize: 4096,
      picking: options.picking ?? false,
    };
    this.stats = options.stats ?? {
      drawCalls: 0,
      renderedMeshes: 0,
      renderedBatches: 0,
      instancingFallbacks: 0,
      gpuUploads: 0,
      gpuEvictions: 0,
      gpuBytes: 0,
    };
  }

  initialize(): void {}

  resize(viewport: ICEViewport): void {
    this.assertActive();
    this.lastViewport = { ...viewport };
  }

  setBackgroundColor(color: string): void {
    this.lastBackgroundColor = color;
  }

  prepareBatchGeometry(): void {}

  releaseBatchGeometry(): void {}

  render(frame: ICEFrame): void {
    this.assertActive();
    this.frames.push(frame);
  }

  async pick(): Promise<string | undefined> {
    if (this.pickError) {
      throw this.pickError;
    }
    return this.pickResult;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.frames.length = 0;
    this.disposed = true;
    this.disposals += 1;
  }

  get disposeCount(): number {
    return this.disposals;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ICEEngineError('ICE3_ENGINE_DESTROYED', 'Renderer is disposed');
    }
  }
}
