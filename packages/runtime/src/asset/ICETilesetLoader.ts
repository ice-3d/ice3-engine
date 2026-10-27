import {
  ICEEventDispatcher,
  ICENode,
  ICEScene,
  type ICEGeometryBounds,
  type ICEMatrix4Tuple,
  type ICEPerspectiveCamera,
} from '@ice3/core';
import {
  readTileset,
  type ICETilesetSnapshot,
  type ICETilesetTile,
} from '@ice3/assets';
import type { ICE3 } from '../ICE3.js';
import { ICEAssetLoader, type ICEAssetHandle } from './ICEAssetLoader.js';

export type ICETilesetTileState =
  | 'pending'
  | 'loading'
  | 'loaded'
  | 'failed';

export interface ICETilesetStats {
  readonly total: number;
  readonly pending: number;
  readonly loading: number;
  readonly loaded: number;
  readonly failed: number;
}

export interface ICETilesetEvent {
  readonly stats: ICETilesetStats;
  readonly tileId?: string;
}

export interface ICETilesetLoaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly camera?: ICEPerspectiveCamera;
  readonly maxConcurrentTiles?: number;
}

export interface ICETilesetOpenOptions {
  readonly signal?: AbortSignal;
}

export class ICETilesetLoader {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly camera: ICEPerspectiveCamera | undefined;
  private readonly maxConcurrentTiles: number;

  constructor(
    private readonly engine: ICE3,
    options: ICETilesetLoaderOptions = {},
  ) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.camera = options.camera;
    this.maxConcurrentTiles = options.maxConcurrentTiles ?? 2;
    if (
      !Number.isInteger(this.maxConcurrentTiles)
      || this.maxConcurrentTiles < 1
    ) {
      throw new Error(
        'ICE3_TILESET_INVALID: maxConcurrentTiles must be a positive integer',
      );
    }
  }

  async open(
    url: string,
    options: ICETilesetOpenOptions = {},
  ): Promise<ICETilesetHandle> {
    throwIfAborted(options.signal);
    const absoluteUrl = typeof globalThis.location === 'undefined'
      ? url
      : new URL(url, globalThis.location.href).href;
    let response: Response;
    try {
      response = await this.fetcher(
        absoluteUrl,
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw abortedTilesetError();
      }
      throw new Error(
        `ICE3_TILESET_INVALID: Tileset request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new Error(`ICE3_TILESET_INVALID: HTTP ${response.status}`);
    }
    throwIfAborted(options.signal);
    const text = await response.text();
    throwIfAborted(options.signal);
    const snapshot = readTileset(text, absoluteUrl);
    const tiles = prioritizeTiles(snapshot.tiles, this.camera);
    const handle = new ICETilesetHandle(
      this.engine,
      snapshot,
      tiles,
      this.fetcher,
      this.maxConcurrentTiles,
      options.signal,
    );
    handle.start();
    return handle;
  }
}

export class ICETilesetHandle extends ICEEventDispatcher {
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  private readonly states = new Map<string, ICETilesetTileState>();
  private readonly assetLoader: ICEAssetLoader;
  private readonly abortController = new AbortController();
  private readonly readyPromise: Promise<void>;
  private readonly completePromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private resolveComplete!: () => void;
  private cursor = 0;
  private active = 0;
  private settled = 0;
  private readySettled = false;
  private completeSettled = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly engine: ICE3,
    private readonly snapshot: ICETilesetSnapshot,
    private readonly tiles: readonly ICETilesetTile[],
    fetch: typeof globalThis.fetch,
    private readonly maxConcurrentTiles: number,
    callerSignal?: AbortSignal,
  ) {
    super();
    this.scene = new ICEScene({ id: `${snapshot.assetId}:scene` });
    this.bounds = snapshot.bounds;
    this.assetLoader = new ICEAssetLoader(engine, {
      fetch: (input, init) => fetch(input, {
        ...(init ?? {}),
        signal: this.abortController.signal,
      }),
    });
    for (const tile of tiles) this.states.set(tile.id, 'pending');
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => {});
    this.completePromise = new Promise<void>((resolve) => {
      this.resolveComplete = resolve;
    });
    if (callerSignal) {
      if (callerSignal.aborted) this.abort();
      else callerSignal.addEventListener('abort', () => this.abort(), {
        once: true,
      });
    }
  }

  get stats(): ICETilesetStats {
    const values = [...this.states.values()];
    return Object.freeze({
      total: values.length,
      pending: values.filter((value) => value === 'pending').length,
      loading: values.filter((value) => value === 'loading').length,
      loaded: values.filter((value) => value === 'loaded').length,
      failed: values.filter((value) => value === 'failed').length,
    });
  }

  tileState(tileId: string): ICETilesetTileState | undefined {
    return this.states.get(tileId);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  whenComplete(): Promise<void> {
    return this.completePromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    for (const [id, state] of this.states) {
      if (state === 'loading') this.states.set(id, 'pending');
    }
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(abortedTilesetError());
    }
    if (!this.completeSettled) {
      this.completeSettled = true;
      this.resolveComplete();
    }
    this.scene.dispose();
    this.removeAllListeners();
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    queueMicrotask(() => {
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed) return;
    while (
      this.active < this.maxConcurrentTiles
      && this.cursor < this.tiles.length
    ) {
      const tile = this.tiles[this.cursor]!;
      this.cursor += 1;
      this.active += 1;
      void this.loadTile(tile).finally(() => {
        this.active -= 1;
        this.settled += 1;
        if (this.settled === this.tiles.length) {
          this.complete();
        } else {
          this.pump();
        }
      });
    }
  }

  private async loadTile(tile: ICETilesetTile): Promise<void> {
    if (this.disposed) return;
    this.states.set(tile.id, 'loading');
    this.emit('TILESET_TILE_LOADING', tile.id);
    let loaded: ICEAssetHandle | undefined;
    try {
      if (!tile.contentUri) {
        throw new Error('tile has no content URI');
      }
      loaded = await this.assetLoader.load(tile.contentUri, {
        signal: this.abortController.signal,
      });
      if (this.disposed) {
        loaded.dispose();
        return;
      }
      const moved = [...loaded.scene.children];
      for (const child of moved) {
        assertUniqueIDs(child, this.scene);
      }
      if (tile.transform) {
        const wrapper = new ICENode({
          id: `${this.snapshot.assetId}:tile:${tile.id}`,
          matrix: tile.transform as ICEMatrix4Tuple,
        });
        for (const child of moved) wrapper.addChild(child);
        this.scene.addChild(wrapper);
      } else {
        for (const child of moved) this.scene.addChild(child);
      }
      loaded.dispose();
      loaded = undefined;
      this.states.set(tile.id, 'loaded');
      this.engine.requestRender('tileset-tile-loaded');
      this.emit('TILESET_TILE_LOADED', tile.id);
      if (!this.readySettled) {
        this.readySettled = true;
        this.resolveReady();
        this.trigger<ICETilesetEvent>('TILESET_READY', {
          stats: this.stats,
        });
      }
    } catch (error) {
      loaded?.dispose();
      if (this.disposed || isAbortError(error)) return;
      this.states.set(tile.id, 'failed');
      this.engine.reportDiagnostic(
        'ICE3_TILESET_TILE_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      this.emit('TILESET_TILE_FAILED', tile.id);
      if (!this.readySettled) {
        this.readySettled = true;
        this.rejectReady(error);
      }
    }
  }

  private complete(): void {
    if (this.disposed || this.completeSettled) return;
    this.completeSettled = true;
    this.resolveComplete();
    this.trigger<ICETilesetEvent>('TILESET_COMPLETE', {
      stats: this.stats,
    });
  }

  private abort(): void {
    if (!this.disposed) this.dispose();
  }

  private emit(type: string, tileId: string): void {
    this.trigger<ICETilesetEvent>(type, {
      tileId,
      stats: this.stats,
    });
  }
}

function prioritizeTiles(
  tiles: readonly ICETilesetTile[],
  camera: ICEPerspectiveCamera | undefined,
): ICETilesetTile[] {
  if (!camera) return [...tiles];
  const target = camera.getTarget().toArray();
  return [...tiles].sort((left, right) => {
    const leftCenter = boundsCenter(left.bounds);
    const rightCenter = boundsCenter(right.bounds);
    const distance = (point: readonly number[]): number => Math.hypot(
      point[0]! - target[0]!,
      point[1]! - target[1]!,
      point[2]! - target[2]!,
    );
    return distance(leftCenter) - distance(rightCenter)
      || left.id.localeCompare(right.id, 'en');
  });
}

function boundsCenter(
  bounds: ICEGeometryBounds,
): readonly [number, number, number] {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function assertUniqueIDs(node: ICENode, root: ICENode): void {
  if (root.findByID(node.id)) {
    throw new Error(`ICE3_TILESET_DUPLICATE_ID: ${node.id}`);
  }
  for (const child of node.children) assertUniqueIDs(child, root);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedTilesetError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortedTilesetError(): Error {
  return new Error('ICE3_TILESET_ABORTED: Tileset loading was aborted');
}
