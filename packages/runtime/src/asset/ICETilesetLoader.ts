import {
  ICEEventDispatcher,
  ICEMesh,
  ICENode,
  ICEScene,
  type ICEGeometry,
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
import {
  ICETilesetScheduler,
  type ICETilesetWorkSet,
} from './ICETilesetScheduler.js';

export type ICETilesetTileState =
  | 'pending'
  | 'loading'
  | 'loaded'
  | 'failed'
  | 'evicted';

export interface ICETilesetStats {
  readonly total: number;
  readonly pending: number;
  readonly loading: number;
  readonly loaded: number;
  readonly failed: number;
  readonly evicted: number;
  readonly visible: number;
  readonly resident: number;
  readonly residentBytes: number;
}

export interface ICETilesetEvent {
  readonly stats: ICETilesetStats;
  readonly tileId?: string;
}

export interface ICETilesetLoaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly camera: ICEPerspectiveCamera;
  readonly maxConcurrentTiles?: number;
  readonly maxResidentTiles?: number;
  readonly maxResidentBytes?: number;
  readonly prefetchMarginRatio?: number;
  readonly unloadMarginRatio?: number;
  readonly maxCommitsPerFrame?: number;
}

export interface ICETilesetOpenOptions {
  readonly signal?: AbortSignal;
}

export class ICETilesetLoader {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly camera: ICEPerspectiveCamera;
  private readonly maxConcurrentTiles: number;
  private readonly maxCommitsPerFrame: number;
  private readonly scheduler: ICETilesetScheduler;

  constructor(
    private readonly engine: ICE3,
    options: ICETilesetLoaderOptions,
  ) {
    if (!options.camera) {
      throw new Error(
        'ICE3_TILESET_CAMERA_REQUIRED: Tileset scheduling requires a camera',
      );
    }
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.camera = options.camera;
    this.maxConcurrentTiles = options.maxConcurrentTiles ?? 2;
    this.maxCommitsPerFrame = options.maxCommitsPerFrame ?? 1;
    if (
      !Number.isInteger(this.maxConcurrentTiles)
      || this.maxConcurrentTiles < 1
      || !Number.isInteger(this.maxCommitsPerFrame)
      || this.maxCommitsPerFrame < 1
    ) {
      throw new Error(
        'ICE3_TILESET_INVALID: concurrency and commit limits must be positive integers',
      );
    }
    this.scheduler = new ICETilesetScheduler({
      maxResidentTiles: options.maxResidentTiles ?? 24,
      maxResidentBytes: options.maxResidentBytes ?? 268_435_456,
      prefetchMarginRatio: options.prefetchMarginRatio ?? 0.10,
      unloadMarginRatio: options.unloadMarginRatio ?? 0.20,
    });
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
    const handle = new ICETilesetHandle(
      this.engine,
      snapshot,
      this.camera,
      this.scheduler,
      this.fetcher,
      this.maxConcurrentTiles,
      this.maxCommitsPerFrame,
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
  private readonly resident = new Map<string, ICEResidentTile>();
  private readonly candidates = new Map<string, ICETileCandidate>();
  private readonly activeIds = new Set<string>();
  private readonly idleWaiters: ICEIdleWaiter[] = [];
  private readonly assetLoader: ICEAssetLoader;
  private readonly abortController = new AbortController();
  private readonly readyPromise: Promise<void>;
  private requestQueue: ICETilesetTile[] = [];
  private commitQueue: string[] = [];
  private workSet: ICETilesetWorkSet | undefined;
  private residentBytes = 0;
  private activeRequests = 0;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private readySettled = false;
  private started = false;
  private disposed = false;
  private removeCallerAbort: (() => void) | undefined;
  private workSetUpdateScheduled = false;
  private workSetDirty = true;
  private lastSignature = '';
  private commitScheduled = false;
  private budgetWarningActive = false;
  private idleEmitted = false;

  constructor(
    private readonly engine: ICE3,
    private readonly snapshot: ICETilesetSnapshot,
    private readonly camera: ICEPerspectiveCamera,
    private readonly scheduler: ICETilesetScheduler,
    fetch: typeof globalThis.fetch,
    private readonly maxConcurrentTiles: number,
    private readonly maxCommitsPerFrame: number,
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
    for (const tile of snapshot.tiles) this.states.set(tile.id, 'pending');
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => {});
    if (callerSignal) {
      if (callerSignal.aborted) this.abort();
      else {
        const abort = (): void => this.abort();
        callerSignal.addEventListener('abort', abort, { once: true });
        this.removeCallerAbort = () => {
          callerSignal.removeEventListener('abort', abort);
        };
      }
    }
  }

  get stats(): ICETilesetStats {
    const values = [...this.states.values()];
    return Object.freeze({
      total: this.states.size,
      pending: values.filter((value) => value === 'pending').length,
      loading: values.filter((value) => value === 'loading').length,
      loaded: this.resident.size,
      failed: values.filter((value) => value === 'failed').length,
      evicted: values.filter((value) => value === 'evicted').length,
      visible: this.workSet?.visible.length ?? 0,
      resident: this.resident.size,
      residentBytes: this.residentBytes,
    });
  }

  tileState(tileId: string): ICETilesetTileState | undefined {
    return this.states.get(tileId);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  whenIdle(): Promise<void> {
    const pending = new Set([
      ...this.requestQueue.map((tile) => tile.id),
      ...this.commitQueue,
      ...[...this.states]
        .filter(([, state]) => state === 'pending' || state === 'loading')
        .map(([id]) => id),
    ]);
    if (pending.size === 0 && !this.workSetUpdateScheduled) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push({ watchedIds: pending, resolve });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeCallerAbort?.();
    this.removeCallerAbort = undefined;
    this.engine.off('AFTER_RENDER', this.handleAfterRender);
    this.abortController.abort();
    for (const [id, state] of this.states) {
      if (state === 'pending' || state === 'loading') {
        this.states.set(id, 'evicted');
      }
    }
    for (const candidate of this.candidates.values()) {
      candidate.container.dispose();
      this.assetLoader.clear(candidate.contentUri);
    }
    this.candidates.clear();
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(abortedTilesetError());
    }
    for (const waiter of this.idleWaiters.splice(0)) waiter.resolve();
    this.resident.clear();
    this.residentBytes = 0;
    const sceneIds = new Set<string>();
    collectNodeIDs(this.scene, sceneIds);
    if (this.engine.getSelection().some((id) => sceneIds.has(id))) {
      this.engine.setSelection([]);
    }
    this.scene.dispose();
    this.assetLoader.clear();
    this.removeAllListeners();
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.engine.on('AFTER_RENDER', this.handleAfterRender);
    this.requestWorkSetUpdate();
  }

  private readonly handleAfterRender = (): void => {
    this.requestWorkSetUpdate();
  };

  private requestWorkSetUpdate(): void {
    if (this.disposed) return;
    this.workSetDirty = true;
    if (this.workSetUpdateScheduled) return;
    this.workSetUpdateScheduled = true;
    queueMicrotask(() => {
      this.workSetUpdateScheduled = false;
      if (!this.workSetDirty || this.disposed) return;
      this.workSetDirty = false;
      this.updateWorkSet();
    });
  }

  private updateWorkSet(): void {
    if (this.disposed) return;
    const viewport = this.engine.getDiagnostics().viewport;
    const aspect = viewport.width / Math.max(1, viewport.height);
    const viewProjection = this.camera.getViewProjectionMatrix(aspect);
    const signature = [
      viewport.width,
      viewport.height,
      ...viewProjection.elements,
    ].join(':');
    if (signature === this.lastSignature) {
      this.settleIdleWaiters();
      return;
    }
    this.lastSignature = signature;
    const workSet = this.scheduler.update({
      assetBounds: this.bounds,
      tiles: this.snapshot.tiles,
      camera: this.camera,
      viewport,
      residentBytes: new Map(
        [...this.resident].map(([id, tile]) => [id, tile.bytes]),
      ),
    });
    this.workSet = workSet;
    this.idleEmitted = false;

    for (const id of [...this.resident.keys()]) {
      if (!workSet.retainIds.has(id)) this.unloadTile(id);
    }
    for (const id of [...this.candidates.keys()]) {
      if (!workSet.retainIds.has(id)) this.discardCandidate(id);
    }

    this.enforceResidentBudget();
    const desired = this.residentBudgetReached()
      ? workSet.visible
      : workSet.ordered;
    const desiredIds = new Set(desired.map((tile) => tile.id));
    const pending: ICETilesetTile[] = [];
    for (const tile of this.snapshot.tiles) {
      if (this.activeIds.has(tile.id)) {
        this.states.set(
          tile.id,
          desiredIds.has(tile.id) ? 'loading' : 'evicted',
        );
        continue;
      }
      if (
        this.resident.has(tile.id)
        || this.candidates.has(tile.id)
      ) {
        continue;
      }
      if (this.states.get(tile.id) === 'failed') continue;
      if (desiredIds.has(tile.id)) {
        this.states.set(tile.id, 'pending');
        pending.push(tile);
      } else {
        this.states.set(tile.id, 'evicted');
      }
    }
    for (const tileId of this.activeIds) {
      if (!desiredIds.has(tileId) && !workSet.retainIds.has(tileId)) {
        this.states.set(tileId, 'evicted');
      }
    }
    const rank = new Map(
      desired.map((tile, index) => [tile.id, index] as const),
    );
    this.requestQueue = pending.sort((left, right) => (
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
    this.commitQueue.sort((left, right) => (
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right) ?? Number.MAX_SAFE_INTEGER)
    ));
    this.pumpRequests();
    this.scheduleCommit();
    this.updateBudgetWarning();
    this.settleIdleWaiters();
  }

  private pumpRequests(): void {
    if (this.disposed) return;
    while (
      this.activeRequests < this.maxConcurrentTiles
      && this.requestQueue.length > 0
    ) {
      const tile = this.requestQueue.shift()!;
      if (this.states.get(tile.id) !== 'pending') continue;
      const visible = this.workSet?.visible.some(
        (entry) => entry.id === tile.id,
      ) ?? false;
      if (!visible && this.residentBudgetReached()) {
        this.states.set(tile.id, 'evicted');
        continue;
      }
      this.activeIds.add(tile.id);
      this.activeRequests += 1;
      this.states.set(tile.id, 'loading');
      this.emit('TILESET_TILE_LOADING', tile.id);
      void this.loadTile(tile).finally(() => {
        this.activeIds.delete(tile.id);
        this.activeRequests -= 1;
        this.pumpRequests();
        this.settleIdleWaiters();
      });
    }
  }

  private async loadTile(tile: ICETilesetTile): Promise<void> {
    let loaded: ICEAssetHandle | undefined;
    try {
      if (!tile.contentUri) {
        throw new Error('tile has no content URI');
      }
      loaded = await this.assetLoader.load(tile.contentUri, {
        signal: this.abortController.signal,
      });
      if (
        this.disposed
        || !this.workSet?.retainIds.has(tile.id)
      ) {
        loaded.dispose();
        this.assetLoader.clear(tile.contentUri);
        if (!this.disposed) this.states.set(tile.id, 'evicted');
        return;
      }
      const bytes = estimateSceneBytes(loaded.scene);
      const container = new ICENode({
        id: `${this.snapshot.assetId}:tile:${tile.id}`,
        ...(tile.transform
          ? { matrix: tile.transform as ICEMatrix4Tuple }
          : {}),
      });
      for (const child of [...loaded.scene.children]) {
        container.addChild(child);
      }
      loaded.dispose();
      loaded = undefined;
      this.candidates.set(tile.id, {
        tile,
        container,
        bytes,
        contentUri: tile.contentUri,
      });
      this.commitQueue.push(tile.id);
      this.scheduleCommit();
      this.settleIdleWaiters();
    } catch (error) {
      loaded?.dispose();
      if (this.disposed || isAbortError(error)) return;
      if (!this.workSet?.retainIds.has(tile.id)) {
        this.states.set(tile.id, 'evicted');
        return;
      }
      this.states.set(tile.id, 'failed');
      this.engine.reportDiagnostic(
        'ICE3_TILESET_TILE_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      this.emit('TILESET_TILE_FAILED', tile.id);
      this.rejectReadyIfVisibleSetFailed();
      this.settleIdleWaiters();
    }
  }

  private scheduleCommit(): void {
    if (
      this.disposed
      || this.commitScheduled
      || this.commitQueue.length === 0
    ) {
      return;
    }
    this.commitScheduled = true;
    requestFrame(() => {
      this.commitScheduled = false;
      if (this.disposed) return;
      this.commitBatch();
    });
  }

  private commitBatch(): void {
    let committed = 0;
    while (
      committed < this.maxCommitsPerFrame
      && this.commitQueue.length > 0
    ) {
      const tileId = this.commitQueue.shift()!;
      const candidate = this.candidates.get(tileId);
      if (!candidate) continue;
      this.candidates.delete(tileId);
      if (!this.workSet?.retainIds.has(tileId)) {
        this.discardCandidateRecord(candidate);
        this.states.set(tileId, 'evicted');
        continue;
      }
      const visible = this.workSet.visible.some(
        (tile) => tile.id === tileId,
      );
      if (!visible && !this.canCommitWithinBudget(candidate)) {
        this.discardCandidateRecord(candidate);
        this.states.set(tileId, 'evicted');
        continue;
      }
      committed += 1;
      try {
        if (this.scene.findByID(candidate.container.id)) {
          throw new Error(`ICE3_TILESET_DUPLICATE_ID: ${candidate.container.id}`);
        }
        this.scene.addChild(candidate.container);
        this.resident.set(tileId, {
          tile: candidate.tile,
          container: candidate.container,
          bytes: candidate.bytes,
          contentUri: candidate.contentUri,
        });
        this.residentBytes += candidate.bytes;
        this.states.set(tileId, 'loaded');
        this.engine.requestRender('tileset-tile-committed');
        this.emit('TILESET_TILE_LOADED', tileId);
        if (
          !this.readySettled
          && this.workSet?.visible.some((tile) => tile.id === tileId)
        ) {
          this.readySettled = true;
          this.resolveReady();
          this.trigger<ICETilesetEvent>('TILESET_READY', {
            stats: this.stats,
          });
        }
      } catch (error) {
        candidate.container.dispose();
        this.assetLoader.clear(candidate.contentUri);
        this.states.set(tileId, 'failed');
        this.engine.reportDiagnostic(
          'ICE3_TILESET_TILE_FAILED',
          error instanceof Error ? error.message : String(error),
        );
        this.emit('TILESET_TILE_FAILED', tileId);
        this.rejectReadyIfVisibleSetFailed();
      }
    }
    this.enforceResidentBudget();
    this.updateBudgetWarning();
    this.scheduleCommit();
    this.settleIdleWaiters();
  }

  private discardCandidate(tileId: string): void {
    const candidate = this.candidates.get(tileId);
    if (!candidate) return;
    this.candidates.delete(tileId);
    this.commitQueue = this.commitQueue.filter((id) => id !== tileId);
    this.discardCandidateRecord(candidate);
    this.states.set(tileId, 'evicted');
  }

  private discardCandidateRecord(candidate: ICETileCandidate): void {
    candidate.container.dispose();
    this.assetLoader.clear(candidate.contentUri);
  }

  private unloadTile(tileId: string): void {
    const record = this.resident.get(tileId);
    if (!record) return;
    const ids = new Set<string>();
    collectNodeIDs(record.container, ids);
    if (this.engine.getSelection().some((id) => ids.has(id))) {
      this.engine.setSelection([]);
    }
    this.scene.removeChild(record.container, { dispose: true });
    this.resident.delete(tileId);
    this.residentBytes = Math.max(0, this.residentBytes - record.bytes);
    this.assetLoader.clear(record.contentUri);
    this.states.set(tileId, 'evicted');
    this.emit('TILESET_TILE_UNLOADED', tileId);
    this.engine.requestRender('tileset-tile-unloaded');
  }

  private rejectReadyIfVisibleSetFailed(): void {
    if (this.readySettled || !this.workSet) return;
    const visible = this.workSet.visible;
    if (
      visible.length > 0
      && visible.every((tile) => this.states.get(tile.id) === 'failed')
    ) {
      this.readySettled = true;
      this.rejectReady(new Error('All visible Tileset partitions failed'));
    }
  }

  private updateBudgetWarning(): void {
    const exceeded = this.residentBudgetExceeded();
    if (exceeded && !this.budgetWarningActive) {
      this.engine.reportDiagnostic(
        'ICE3_TILESET_RESIDENT_BUDGET_EXCEEDED',
        'Tileset residency exceeds the soft resident budget',
        'warning',
      );
    }
    this.budgetWarningActive = exceeded;
  }

  private residentBudgetReached(): boolean {
    return this.resident.size >= this.scheduler.residentTileLimit
      || this.residentBytes >= this.scheduler.residentByteLimit;
  }

  private residentBudgetExceeded(): boolean {
    return this.resident.size > this.scheduler.residentTileLimit
      || this.residentBytes > this.scheduler.residentByteLimit;
  }

  private canCommitWithinBudget(candidate: ICETileCandidate): boolean {
    return this.resident.size < this.scheduler.residentTileLimit
      && this.residentBytes + candidate.bytes
        <= this.scheduler.residentByteLimit;
  }

  private enforceResidentBudget(): void {
    if (!this.residentBudgetExceeded()) return;
    const visibleIds = new Set(
      this.workSet?.visible.map((tile) => tile.id) ?? [],
    );
    for (const id of [...this.resident.keys()]) {
      if (!visibleIds.has(id)) this.unloadTile(id);
    }
    for (const id of [...this.candidates.keys()]) {
      if (!visibleIds.has(id)) this.discardCandidate(id);
    }
  }

  private settleIdleWaiters(): void {
    const unsettled = new Set([
      ...this.requestQueue.map((tile) => tile.id),
      ...this.commitQueue,
      ...[...this.states]
        .filter(([, state]) => state === 'pending' || state === 'loading')
        .map(([id]) => id),
    ]);
    for (const waiter of [...this.idleWaiters]) {
      if ([...waiter.watchedIds].every((id) => !unsettled.has(id))) {
        this.idleWaiters.splice(this.idleWaiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
    if (unsettled.size === 0 && !this.idleEmitted) {
      this.idleEmitted = true;
      this.trigger<ICETilesetEvent>('TILESET_IDLE', { stats: this.stats });
    }
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

interface ICEResidentTile {
  readonly tile: ICETilesetTile;
  readonly container: ICENode;
  readonly bytes: number;
  readonly contentUri: string;
}

interface ICETileCandidate extends Omit<ICEResidentTile, 'tile'> {
  readonly tile: ICETilesetTile;
}

interface ICEIdleWaiter {
  readonly watchedIds: ReadonlySet<string>;
  readonly resolve: () => void;
}

function requestFrame(callback: FrameRequestCallback): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(callback);
  } else {
    setTimeout(() => callback(performance.now()), 0);
  }
}

function estimateSceneBytes(scene: ICEScene): number {
  const geometries = new Set<ICEGeometry>();
  const visit = (node: ICENode): void => {
    if (node instanceof ICEMesh) geometries.add(node.geometry);
    for (const child of node.children) visit(child);
  };
  visit(scene);
  let total = 0;
  for (const geometry of geometries) {
    total += geometry.positions.byteLength;
    total += geometry.indices.byteLength;
    total += geometry.edgeIndices?.byteLength ?? 0;
    total += geometry.colors?.byteLength ?? 0;
  }
  return total;
}

function collectNodeIDs(node: ICENode, output: Set<string>): void {
  output.add(node.id);
  for (const child of node.children) collectNodeIDs(child, output);
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
