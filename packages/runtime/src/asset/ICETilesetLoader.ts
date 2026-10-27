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
import {
  ICELodSelector,
  type ICELodSelection,
} from './ICELodSelector.js';

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
  readonly residentContents: number;
  readonly loadingContents: number;
  readonly lod: ICELodStats;
}

export interface ICELodStats {
  readonly target: number;
  readonly resident: number;
  readonly coarseResident: number;
  readonly fineResident: number;
  readonly transitioning: number;
  readonly fallback: number;
  readonly maxScreenSpaceErrorPixels: number;
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
  readonly maxScreenSpaceErrorPixels?: number;
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
  private readonly maxScreenSpaceErrorPixels: number;

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
    this.maxScreenSpaceErrorPixels = options.maxScreenSpaceErrorPixels ?? 16;
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
    if (
      !Number.isFinite(this.maxScreenSpaceErrorPixels)
      || this.maxScreenSpaceErrorPixels <= 0
    ) {
      throw new Error(
        'ICE3_TILESET_LOD_INVALID: maxScreenSpaceErrorPixels must be positive',
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
      this.maxScreenSpaceErrorPixels,
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
  private readonly tilesById = new Map<string, ICETilesetTile>();
  private readonly resident = new Map<string, ICEResidentTile>();
  private readonly candidates = new Map<string, ICETileCandidate>();
  private readonly activeIds = new Set<string>();
  private readonly prefetchIds = new Set<string>();
  private readonly failedLodFallbacks = new Set<string>();
  private readonly lodAncestorCache = new Map<
    string,
    readonly ICETilesetTile[]
  >();
  private readonly idleWaiters: ICEIdleWaiter[] = [];
  private readonly assetLoader: ICEAssetLoader;
  private readonly lodSelector = new ICELodSelector();
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
  private workSetForce = false;
  private lastSignature = '';
  private commitScheduled = false;
  private budgetWarningActive = false;
  private idleEmitted = false;
  private lodSelection: ICELodSelection | undefined;
  private lastLodTarget = '';
  private lastLodFallbacks = '';

  constructor(
    private readonly engine: ICE3,
    private readonly snapshot: ICETilesetSnapshot,
    private readonly camera: ICEPerspectiveCamera,
    private readonly scheduler: ICETilesetScheduler,
    fetch: typeof globalThis.fetch,
    private readonly maxConcurrentTiles: number,
    private readonly maxCommitsPerFrame: number,
    private readonly maxScreenSpaceErrorPixels: number,
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
    for (const tile of snapshot.tiles) {
      this.states.set(tile.id, 'pending');
      this.tilesById.set(tile.id, tile);
    }
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
    const targetTiles = this.lodSelection?.target ?? [];
    const coverageIds = this.lodCoverageIds(targetTiles);
    const residentCut = [...coverageIds].filter((id) => (
      this.resident.has(id)
    )).length;
    const coarseResident = [...this.resident.keys()].filter((id) => (
      (this.tilesById.get(id)?.children.length ?? 0) > 0
    )).length;
    const unavailableTargets = targetTiles.filter((tile) => (
      !this.resident.has(tile.id)
    ));
    const transitioning = this.lodNextTiles(targetTiles).length;
    const fallbacks = new Set([
      ...[...coverageIds].filter((id) => (
        unavailableTargets.some((tile) => (
          this.lodAncestorIds(tile.id).includes(id)
        ))
      )),
      ...this.failedLodFallbacks,
    ]);
    const lod = Object.freeze({
      target: this.lodSelection?.target.length ?? 0,
      resident: residentCut,
      coarseResident,
      fineResident: this.resident.size - coarseResident,
      transitioning,
      fallback: fallbacks.size,
      maxScreenSpaceErrorPixels: this.maxScreenSpaceErrorPixels,
    });
    return Object.freeze({
      total: this.states.size,
      pending: values.filter((value) => value === 'pending').length,
      loading: values.filter((value) => value === 'loading').length,
      loaded: this.resident.size,
      failed: values.filter((value) => value === 'failed').length,
      evicted: values.filter((value) => value === 'evicted').length,
      visible: this.workSet?.visible.length ?? 0,
      resident: this.resident.size,
      residentContents: [...this.resident.values()].reduce(
        (total, tile) => total + tile.contentUris.length,
        0,
      ),
      loadingContents: [...this.states]
        .filter(([, state]) => state === 'loading')
        .reduce((total, [id]) => (
          total + (this.tilesById.get(id)?.contentUris.length ?? 0)
        ), 0),
      residentBytes: this.residentBytes,
      lod,
    });
  }

  private lodAncestors(tileId: string): readonly ICETilesetTile[] {
    const cached = this.lodAncestorCache.get(tileId);
    if (cached) return cached;
    const search = (
      tile: ICETilesetTile,
      ancestors: readonly ICETilesetTile[],
    ): readonly ICETilesetTile[] | undefined => {
      if (tile.id === tileId) return ancestors;
      const next = tile.contentUris.length > 0
        ? [...ancestors, tile]
        : ancestors;
      for (const child of tile.children) {
        const found = search(child, next);
        if (found) return found;
      }
      return undefined;
    };
    const ancestors = search(this.snapshot.root, []) ?? [];
    this.lodAncestorCache.set(tileId, ancestors);
    return ancestors;
  }

  private lodAncestorIds(tileId: string): readonly string[] {
    return this.lodAncestors(tileId).map((tile) => tile.id);
  }

  private lodCoverageId(tile: ICETilesetTile | undefined): string | undefined {
    if (!tile) return undefined;
    if (this.resident.has(tile.id)) return tile.id;
    const residentAncestor = [...this.lodAncestors(tile.id)]
      .reverse()
      .find((ancestor) => this.resident.has(ancestor.id));
    return residentAncestor?.id;
  }

  private lodCoverageIds(
    targets: readonly ICETilesetTile[],
  ): Set<string> {
    return new Set(
      targets
        .map((tile) => this.lodCoverageId(tile))
        .filter((id): id is string => Boolean(id)),
    );
  }

  private lodNextTiles(
    targets: readonly ICETilesetTile[],
  ): ICETilesetTile[] {
    const output = new Map<string, ICETilesetTile>();
    for (const target of targets) {
      if (this.resident.has(target.id)) continue;
      const ancestors = this.lodAncestors(target.id);
      const deepestResident = ancestors.findLastIndex((tile) => (
        this.resident.has(tile.id)
      ));
      const next = [
        ...(deepestResident < 0
          ? ancestors
          : ancestors.slice(deepestResident + 1)),
        target,
      ].find((tile) => this.states.get(tile.id) !== 'failed');
      if (!next) continue;
      if (
        this.residentBudgetReached()
        && this.lodCoverageId(target)
      ) {
        continue;
      }
      output.set(next.id, next);
    }
    return [...output.values()];
  }

  private lodUnsettledIds(): string[] {
    const targets = (this.lodSelection?.target ?? []).filter((tile) => (
      !this.resident.has(tile.id)
      && this.states.get(tile.id) !== 'failed'
    ));
    const next = this.lodNextTiles(targets);
    if (next.length === 0) return [];
    return [...new Set([
      ...next.map((tile) => tile.id),
      ...targets.map((tile) => tile.id),
    ])];
  }

  private recordLodFailure(tileId: string): void {
    const coverage = this.lodCoverageId(this.tilesById.get(tileId));
    if (coverage && !this.failedLodFallbacks.has(coverage)) {
      this.failedLodFallbacks.add(coverage);
      this.engine.reportDiagnostic(
        'ICE3_TILESET_LOD_FALLBACK',
        'Finer Tileset content is unavailable; retaining coarse coverage',
        'warning',
      );
    }
  }

  tileState(tileId: string): ICETilesetTileState | undefined {
    return this.states.get(tileId);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  whenIdle(): Promise<void> {
    const pending = new Set([
      ...this.requestQueue
        .map((tile) => tile.id)
        .filter((id) => !this.prefetchIds.has(id)),
      ...this.commitQueue.filter((id) => !this.prefetchIds.has(id)),
      ...this.lodUnsettledIds(),
      ...[...this.states]
        .filter(([id, state]) => (
          !this.prefetchIds.has(id)
          && (state === 'pending' || state === 'loading')
        ))
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
      for (const uri of candidate.contentUris) this.assetLoader.clear(uri);
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

  private requestWorkSetUpdate(force = false): void {
    if (this.disposed) return;
    this.workSetDirty = true;
    this.workSetForce ||= force;
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
    if (signature === this.lastSignature && !this.workSetForce) {
      this.settleIdleWaiters();
      return;
    }
    this.workSetForce = false;
    this.lastSignature = signature;
    const previousTargetIds = new Set(
      this.lodSelection?.target.map((tile) => tile.id) ?? [],
    );
    const lodSelection = this.lodSelector.select({
      root: this.snapshot.root,
      camera: this.camera,
      viewport,
      residentIds: new Set(this.resident.keys()),
      failedIds: new Set(
        [...this.states]
          .filter(([, state]) => state === 'failed')
          .map(([id]) => id),
      ),
      previousTargetIds,
      maxScreenSpaceErrorPixels: this.maxScreenSpaceErrorPixels,
    });
    this.lodSelection = lodSelection;
    const lodTarget = lodSelection.target.map((tile) => tile.id).join('|');
    if (this.lastLodTarget && lodTarget !== this.lastLodTarget) {
      this.trigger<ICETilesetEvent>('TILESET_LOD_CHANGED', {
        stats: this.stats,
      });
    }
    this.lastLodTarget = lodTarget;
    const fallbacks = [...lodSelection.fallbackByTargetId]
      .map(([targetId, fallbackId]) => `${targetId}:${fallbackId}`)
      .join('|');
    if (fallbacks !== this.lastLodFallbacks) {
      this.trigger<ICETilesetEvent>('TILESET_LOD_FALLBACK', {
        stats: this.stats,
      });
    }
    this.lastLodFallbacks = fallbacks;
    const targetTiles = [...lodSelection.target];
    const coverageTiles = [...this.lodCoverageIds(targetTiles)]
      .map((id) => this.tilesById.get(id))
      .filter((tile): tile is ICETilesetTile => Boolean(tile));
    const nextTiles = this.lodNextTiles(targetTiles);
    const prefetchTiles = this.residentBudgetReached()
      ? []
      : [...lodSelection.prefetch];
    this.prefetchIds.clear();
    for (const tile of prefetchTiles) this.prefetchIds.add(tile.id);
    const candidateMap = new Map<string, ICETilesetTile>();
    for (const tile of [
      ...coverageTiles,
      ...nextTiles,
      ...prefetchTiles,
    ]) {
      candidateMap.set(tile.id, tile);
    }
    const workSet = this.scheduler.update({
      assetBounds: this.bounds,
      tiles: [...candidateMap.values()],
      camera: this.camera,
      viewport,
      residentBytes: new Map(
        [...this.resident].map(([id, tile]) => [id, tile.bytes]),
      ),
    });
    this.workSet = workSet;
    this.idleEmitted = false;

    const retainingTransitionCoverage = this.hasPendingVisibleTargets();
    if (!retainingTransitionCoverage) {
      this.promoteReadyVisibleTargets();
      for (const id of [...this.resident.keys()]) {
        if (!workSet.retainIds.has(id)) this.unloadTile(id);
      }
    }
    for (const id of [...this.candidates.keys()]) {
      if (!workSet.retainIds.has(id)) this.discardCandidate(id);
    }

    if (!retainingTransitionCoverage) this.enforceResidentBudget();
    const desired = [...nextTiles, ...prefetchTiles];
    const desiredIds = new Set(desired.map((tile) => tile.id));
    const pending: ICETilesetTile[] = [];
    for (const tile of this.snapshot.tiles) {
      if (this.activeIds.has(tile.id)) {
        if (this.states.get(tile.id) !== 'failed') {
          this.states.set(
            tile.id,
            desiredIds.has(tile.id) ? 'loading' : 'evicted',
          );
        }
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
      if (
        this.states.get(tileId) !== 'failed'
        && !desiredIds.has(tileId)
        && !workSet.retainIds.has(tileId)
      ) {
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
    const loadedHandles: ICEAssetHandle[] = [];
    try {
      if (tile.contentUris.length === 0) {
        throw new Error('tile has no content URI');
      }
      const container = new ICENode({
        id: `${this.snapshot.assetId}:tile:${tile.id}`,
        ...(tile.transform
          ? { matrix: tile.transform as ICEMatrix4Tuple }
          : {}),
      });
      let bytes = 0;
      for (const [index, uri] of tile.contentUris.entries()) {
        const loaded = await this.assetLoader.load(uri, {
          signal: this.abortController.signal,
        });
        loadedHandles.push(loaded);
        if (this.disposed || !this.workSet?.retainIds.has(tile.id)) {
          for (const handle of loadedHandles) handle.dispose();
          for (const contentUri of tile.contentUris) {
            this.assetLoader.clear(contentUri);
          }
          container.dispose();
          if (!this.disposed) this.states.set(tile.id, 'evicted');
          return;
        }
        bytes += estimateSceneBytes(loaded.scene);
        const chunk = new ICENode({ id: `${container.id}:content:${index}` });
        for (const child of [...loaded.scene.children]) chunk.addChild(child);
        container.addChild(chunk);
        loaded.dispose();
      }
      this.candidates.set(tile.id, {
        tile,
        container,
        bytes,
        contentUris: tile.contentUris,
      });
      this.commitQueue.push(tile.id);
      this.scheduleCommit();
      this.settleIdleWaiters();
    } catch (error) {
      for (const handle of loadedHandles) handle.dispose();
      for (const uri of tile.contentUris) this.assetLoader.clear(uri);
      if (this.disposed || isAbortError(error)) return;
      if (!this.workSet?.retainIds.has(tile.id)) {
        this.states.set(tile.id, 'evicted');
        return;
      }
      this.states.set(tile.id, 'failed');
      if (this.prefetchIds.has(tile.id)) {
        this.states.set(tile.id, 'evicted');
        return;
      }
      this.engine.reportDiagnostic(
        'ICE3_TILESET_TILE_FAILED',
        error instanceof Error ? error.message : String(error),
      );
      this.emit('TILESET_TILE_FAILED', tile.id);
      this.recordLodFailure(tile.id);
      this.rejectReadyIfVisibleSetFailed();
      this.requestWorkSetUpdate(true);
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
        candidate.container.visible = false;
        this.scene.addChild(candidate.container);
        this.resident.set(tileId, {
          tile: candidate.tile,
          container: candidate.container,
          bytes: candidate.bytes,
          contentUris: candidate.contentUris,
        });
        this.residentBytes += candidate.bytes;
        this.states.set(tileId, 'loaded');
        this.emit('TILESET_TILE_LOADED', tileId);
      } catch (error) {
        candidate.container.dispose();
        for (const uri of candidate.contentUris) this.assetLoader.clear(uri);
        this.states.set(tileId, 'failed');
        this.engine.reportDiagnostic(
          'ICE3_TILESET_TILE_FAILED',
          error instanceof Error ? error.message : String(error),
        );
        this.emit('TILESET_TILE_FAILED', tileId);
        this.rejectReadyIfVisibleSetFailed();
      }
    }
    this.promoteReadyVisibleTargets();
    if (this.lodSelection) this.requestWorkSetUpdate(true);
    if (!this.hasPendingVisibleTargets()) this.enforceResidentBudget();
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
    for (const uri of candidate.contentUris) this.assetLoader.clear(uri);
  }

  private unloadTile(tileId: string): void {
    const record = this.resident.get(tileId);
    if (!record) return;
    this.scene.removeChild(record.container, { dispose: true });
    this.resident.delete(tileId);
    this.residentBytes = Math.max(0, this.residentBytes - record.bytes);
    for (const uri of record.contentUris) this.assetLoader.clear(uri);
    this.states.set(tileId, 'evicted');
    this.emit('TILESET_TILE_UNLOADED', tileId);
    const remainingIds = new Set<string>();
    collectNodeAndSelectionIDs(this.scene, remainingIds);
    const selection = this.engine.getSelection();
    if (selection.some((id) => !remainingIds.has(id))) {
      this.engine.setSelection(
        selection.filter((id) => remainingIds.has(id)),
      );
    }
    this.engine.requestRender('tileset-tile-unloaded');
  }

  private hasPendingVisibleTargets(): boolean {
    return (this.lodSelection?.target ?? []).some((tile) => (
      !this.resident.has(tile.id)
    ));
  }

  private promoteReadyVisibleTargets(): void {
    const targets = this.lodSelection?.target ?? [];
    if (
      targets.length === 0
      || targets.some((tile) => !this.resident.has(tile.id))
    ) {
      return;
    }
    const targetIds = new Set(targets.map((tile) => tile.id));
    for (const tileId of targetIds) {
      const resident = this.resident.get(tileId);
      if (resident) resident.container.visible = true;
      const fallbackId = this.lodSelection?.fallbackByTargetId.get(tileId);
      if (fallbackId) this.failedLodFallbacks.delete(fallbackId);
    }
    for (const tileId of [...this.resident.keys()]) {
      if (
        !targetIds.has(tileId)
        && !this.prefetchIds.has(tileId)
      ) {
        this.unloadTile(tileId);
      }
    }
    this.engine.requestRender('tileset-visible-target-committed');
    if (!this.readySettled) {
      this.readySettled = true;
      this.resolveReady();
      this.trigger<ICETilesetEvent>('TILESET_READY', {
        stats: this.stats,
      });
    }
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
      ...this.requestQueue
        .map((tile) => tile.id)
        .filter((id) => !this.prefetchIds.has(id)),
      ...this.commitQueue.filter((id) => !this.prefetchIds.has(id)),
      ...this.lodUnsettledIds(),
      ...[...this.states]
        .filter(([id, state]) => (
          !this.prefetchIds.has(id)
          && (state === 'pending' || state === 'loading')
        ))
        .map(([id]) => id),
    ]);
    for (const waiter of [...this.idleWaiters]) {
      if ([...waiter.watchedIds].every((id) => !unsettled.has(id))) {
        this.idleWaiters.splice(this.idleWaiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
    if (
      unsettled.size === 0
      && !this.idleEmitted
      && !this.workSetUpdateScheduled
    ) {
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
  readonly contentUris: readonly string[];
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

function collectNodeAndSelectionIDs(
  node: ICENode,
  output: Set<string>,
): void {
  output.add(node.id);
  if (node instanceof ICEMesh) output.add(node.selectionId);
  for (const child of node.children) {
    collectNodeAndSelectionIDs(child, output);
  }
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
