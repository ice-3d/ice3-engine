import type {
  ICEPreparedAssetSnapshot,
  ICEPreparedContract,
  ICEPreparedStats,
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
  readonly stats: ICEPreparedStats;
  readonly contract: ICEPreparedContract;
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
      pending = this.fetchSnapshot(url);
      this.cache.set(url, pending);
      pending.catch(() => {
        if (this.cache.get(url) === pending) {
          this.cache.delete(url);
        }
      });
    }
    const cached = await awaitWithAbort(pending, options.signal);
    assertNotAborted(options.signal);
    if (cached.snapshot.contract.status === 'legacy') {
      this.engine.reportDiagnostic(
        'ICE3_ASSET_CONTRACT_MISSING',
        'Prepared asset has no collaboration contract; using legacy statistics',
        'warning',
      );
    }
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
      contract: cached.snapshot.contract,
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
  ): Promise<{
    readonly bytes: ArrayBuffer;
    readonly snapshot: ICEPreparedAssetSnapshot;
  }> {
    let response: Response;
    try {
      response = await this.fetcher(url);
    } catch (error) {
      throw new Error(
        `ICE3_ASSET_FETCH_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new Error(`ICE3_ASSET_FETCH_FAILED: HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const snapshot = readPreparedGLB(bytes);
    return { bytes, snapshot };
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortedError();
  }
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  assertNotAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(abortedError());
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

function abortedError(): Error {
  return new Error('ICE3_ASSET_ABORTED: asset loading was aborted');
}
