import type {
  ICEPreparedAssetSnapshot,
} from '@ice3/assets';
import {
  readPreparedGLB,
  verifyPreparedGLBIntegrity,
} from '@ice3/assets';
import type { ICEGeometryBounds, ICEScene } from '@ice3/core';
import type { ICE3 } from '../ICE3.js';
import { buildAssetScene } from './ICEAssetSceneBuilder.js';

export interface ICEAssetLoaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly verifyIntegrity?: boolean;
}

export interface ICEAssetLoadOptions {
  readonly signal?: AbortSignal;
}

export interface ICEAssetHandle {
  readonly id: string;
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  readonly stats: Readonly<{
    nodeCount: number;
    meshCount: number;
    triangleCount: number;
  }>;
  dispose(): void;
}

export class ICEAssetLoader {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly verifyIntegrity: boolean;
  private readonly cache = new Map<string, Promise<{
    readonly bytes: ArrayBuffer;
    readonly snapshot: ICEPreparedAssetSnapshot;
  }>>();

  constructor(
    private readonly engine: ICE3,
    options: ICEAssetLoaderOptions = {},
  ) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.verifyIntegrity = options.verifyIntegrity ?? false;
  }

  async load(
    url: string,
    options: ICEAssetLoadOptions = {},
  ): Promise<ICEAssetHandle> {
    assertNotAborted(options.signal);
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.fetchSnapshot(url, options.signal);
      this.cache.set(url, pending);
      pending.catch(() => {
        if (this.cache.get(url) === pending) {
          this.cache.delete(url);
        }
      });
    }
    const cached = await pending;
    assertNotAborted(options.signal);
    if (
      this.verifyIntegrity
      && !await verifyPreparedGLBIntegrity(cached.bytes)
    ) {
      throw new Error('ICE3_ASSET_INTEGRITY_FAILED: BIN digest does not match');
    }
    assertNotAborted(options.signal);
    const built = buildAssetScene(cached.snapshot);
    let disposed = false;
    return {
      id: cached.snapshot.assetId,
      scene: built.scene,
      bounds: built.bounds,
      stats: built.stats,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        built.scene.dispose();
        this.engine.requestRender('asset-disposed');
      },
    };
  }

  clear(): void {
    this.cache.clear();
  }

  private async fetchSnapshot(
    url: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly bytes: ArrayBuffer;
    readonly snapshot: ICEPreparedAssetSnapshot;
  }> {
    let response: Response;
    try {
      response = await this.fetcher(url, signal ? { signal } : undefined);
    } catch (error) {
      if (signal?.aborted) throw abortedError();
      throw new Error(
        `ICE3_ASSET_FETCH_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new Error(`ICE3_ASSET_FETCH_FAILED: HTTP ${response.status}`);
    }
    assertNotAborted(signal);
    const bytes = await response.arrayBuffer();
    assertNotAborted(signal);
    const snapshot = readPreparedGLB(bytes);
    assertNotAborted(signal);
    return { bytes, snapshot };
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortedError();
  }
}

function abortedError(): Error {
  return new Error('ICE3_ASSET_ABORTED: asset loading was aborted');
}
