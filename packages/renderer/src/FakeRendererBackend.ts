import { ICEEngineError } from '@ice3/core';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEViewport,
} from './types.js';

export class FakeRendererBackend implements ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  readonly frames: ICEFrame[] = [];
  lastViewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  lastBackgroundColor = '#09111f';
  pickResult: string | undefined;
  pickError: Error | undefined;
  private disposed = false;
  private disposals = 0;

  constructor(options: { readonly picking?: boolean } = {}) {
    this.capabilities = {
      backend: 'fake',
      maxTextureSize: 4096,
      picking: options.picking ?? false,
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

  render(frame: ICEFrame): void {
    this.assertActive();
    this.frames.push(frame);
  }

  pick(): string | undefined {
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
