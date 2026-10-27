import { ICEEngineError } from '@ice3/core';
import type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICEFrame,
  ICEViewport,
} from './types.js';

export class FakeRendererBackend implements ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities> = {
    backend: 'fake',
    maxTextureSize: 4096,
  };
  readonly frames: ICEFrame[] = [];
  lastViewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  private disposed = false;
  private disposals = 0;

  initialize(): void {}

  resize(viewport: ICEViewport): void {
    this.assertActive();
    this.lastViewport = { ...viewport };
  }

  render(frame: ICEFrame): void {
    this.assertActive();
    this.frames.push(frame);
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
