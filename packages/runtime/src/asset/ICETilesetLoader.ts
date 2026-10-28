import {
  ICEBasicMaterial,
  ICEEventDispatcher,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEScene,
  type ICEGeometry,
  type ICEGeometryBounds,
  type ICEMatrix4Tuple,
  type ICEPerspectiveCamera,
} from '@ice3/core';
import {
  queueBatchGeneration,
  type ICEBatchGenerationHandle,
  type ICEBatchUploadBuffer,
} from '@ice3/renderer';
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
import {
  ICEAdaptiveRenderBatchController,
  type ICEAdaptiveBatchExecutionResult,
  type ICEAdaptiveBatchRequest,
  type ICERenderBatchingOptions,
} from '../batching/ICEAdaptiveRenderBatchController.js';
import {
  ICEBatchWorkerPool,
} from '../batching/ICEBatchWorkerPool.js';
import type {
  ICEBatchWorkerOutput,
  ICEBatchWorkerSource,
} from '../batching/ICEBatchWorkerProtocol.js';
import { ICERenderBatchPlanner } from '../batching/ICERenderBatchPlanner.js';
import { ICERenderBatch } from './ICERenderBatch.js';

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
  readonly lodSettleDelayMs?: number;
  readonly renderBatching?: ICERenderBatchingOptions;
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
  private readonly lodSettleDelayMs: number;
  private readonly renderBatching: ICERenderBatchingOptions | undefined;

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
    this.lodSettleDelayMs = options.lodSettleDelayMs ?? 180;
    this.renderBatching = options.renderBatching;
    if (
      options.renderBatching
      && (
        !['asset', 'adaptive', 'off'].includes(options.renderBatching.mode)
        || (
          options.renderBatching.maxWorkers !== undefined
          && (
            !Number.isInteger(options.renderBatching.maxWorkers)
            || options.renderBatching.maxWorkers < 1
          )
        )
        || (
          options.renderBatching.idleTaskBudgetMs !== undefined
          && (
            !Number.isFinite(options.renderBatching.idleTaskBudgetMs)
            || options.renderBatching.idleTaskBudgetMs < 0
          )
        )
        || (
          options.renderBatching.uploadBytesPerFrame !== undefined
          && (
            !Number.isInteger(options.renderBatching.uploadBytesPerFrame)
            || options.renderBatching.uploadBytesPerFrame < 1
          )
        )
        || (
          options.renderBatching.maxExtraGpuBytes !== undefined
          && (
            !Number.isFinite(options.renderBatching.maxExtraGpuBytes)
            || options.renderBatching.maxExtraGpuBytes < 0
          )
        )
      )
    ) {
      throw new Error(
        'ICE3_TILESET_INVALID: adaptive batching options are invalid',
      );
    }
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
    if (
      !Number.isInteger(this.lodSettleDelayMs)
      || this.lodSettleDelayMs < 0
    ) {
      throw new Error(
        'ICE3_TILESET_LOD_INVALID: lodSettleDelayMs must be a non-negative integer',
      );
    }
    this.scheduler = new ICETilesetScheduler({
      maxResidentTiles: options.maxResidentTiles ?? 64,
      maxResidentBytes: options.maxResidentBytes ?? 805_306_368,
      prefetchMarginRatio: options.prefetchMarginRatio ?? 0.20,
      unloadMarginRatio: options.unloadMarginRatio ?? 1.0,
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
      this.lodSettleDelayMs,
      this.renderBatching,
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
  private readonly lodSettleDelayMs: number;
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
  private cameraMoving = false;
  private lodSettleTimer: ReturnType<typeof setTimeout> | undefined;
  private motionFallbackId: string | undefined;
  private readonly adaptiveController: ICEAdaptiveRenderBatchController | undefined;
  private readonly batchWorkerPool: ICEBatchWorkerPool | undefined;
  private readonly adaptivePlanner = new ICERenderBatchPlanner();
  private readonly adaptiveUploadBytesPerFrame: number;
  private readonly adaptiveMaxExtraGpuBytes: number;
  private readonly adaptiveIdleTaskBudgetMs: number;
  private adaptiveAbortController: AbortController | undefined;
  private adaptiveUploadHandle: ICEBatchGenerationHandle | undefined;
  private adaptiveState: ICEAdaptiveSceneState | undefined;
  private adaptivePlanningSignature = '';
  private readonly renderBatchingMode: ICERenderBatchingOptions['mode'];
  private visibleCoverageIds = new Set<string>();

  constructor(
    private readonly engine: ICE3,
    private readonly snapshot: ICETilesetSnapshot,
    private readonly camera: ICEPerspectiveCamera,
    private readonly scheduler: ICETilesetScheduler,
    fetch: typeof globalThis.fetch,
    private readonly maxConcurrentTiles: number,
    private readonly maxCommitsPerFrame: number,
    private readonly maxScreenSpaceErrorPixels: number,
    lodSettleDelayMs: number,
    renderBatching: ICERenderBatchingOptions | undefined,
    callerSignal?: AbortSignal,
  ) {
    super();
    this.scene = new ICEScene({ id: `${snapshot.assetId}:scene` });
    this.bounds = snapshot.bounds;
    this.lodSettleDelayMs = lodSettleDelayMs;
    this.renderBatchingMode = renderBatching?.mode ?? 'asset';
    this.adaptiveUploadBytesPerFrame =
      renderBatching?.uploadBytesPerFrame ?? 8 * 1024 * 1024;
    this.adaptiveMaxExtraGpuBytes =
      renderBatching?.maxExtraGpuBytes ?? 256 * 1024 * 1024;
    this.adaptiveIdleTaskBudgetMs =
      renderBatching?.idleTaskBudgetMs ?? 4;
    if (renderBatching?.mode === 'adaptive') {
      this.batchWorkerPool = new ICEBatchWorkerPool({
        ...(renderBatching.maxWorkers === undefined
          ? {}
          : { maxWorkers: renderBatching.maxWorkers }),
      });
      this.adaptiveController = new ICEAdaptiveRenderBatchController({
        mode: 'adaptive',
        activeGeneration: 1,
        maxExtraGpuBytes: this.adaptiveMaxExtraGpuBytes,
        execute: (request) => this.executeAdaptiveBatch(request),
        onDiagnostic: (code, generation, message) => {
          this.engine.reportDiagnostic(
            code,
            `${message} (generation ${generation})`,
            'info',
          );
        },
      });
    }
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

  get adaptiveStats(): Readonly<{
    mode: ICERenderBatchingOptions['mode'];
    activeGeneration: number;
    candidateGeneration?: number;
    adaptiveBatchCount: number;
  }> {
    const candidate = this.adaptiveController?.candidate;
    return Object.freeze({
      mode: this.renderBatchingMode,
      activeGeneration: this.adaptiveController?.activeGeneration ?? 1,
      ...(candidate === undefined ? {} : { candidateGeneration: candidate }),
      adaptiveBatchCount: this.adaptiveState?.nodes.length ?? 0,
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
    const pending = new Set<string>([
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
    if (this.cameraMoving) pending.add('@lod-settle');
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
    this.cancelAdaptiveCandidate();
    this.restoreAdaptiveScene();
    this.adaptiveController?.dispose();
    this.batchWorkerPool?.dispose();
    this.removeCallerAbort?.();
    this.removeCallerAbort = undefined;
    this.engine.off('AFTER_RENDER', this.handleAfterRender);
    if (this.lodSettleTimer !== undefined) {
      clearTimeout(this.lodSettleTimer);
      this.lodSettleTimer = undefined;
    }
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
    for (const resident of this.resident.values()) {
      for (const geometry of resident.geometries) {
        this.engine.releaseRenderBatchGeometry(geometry);
      }
    }
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
    const cameraChanged = this.lastSignature !== ''
      && signature !== this.lastSignature;
    if (signature === this.lastSignature && !this.workSetForce) {
      this.settleIdleWaiters();
      return;
    }
    this.workSetForce = false;
    this.lastSignature = signature;
    if (cameraChanged) this.enterCameraMotion();
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
    for (const id of this.resident.keys()) {
      const tile = this.tilesById.get(id);
      if (tile) candidateMap.set(id, tile);
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

    this.promoteReadyVisibleTargets();
    const retainingTransitionCoverage = this.cameraMoving
      || this.hasPendingVisibleTargets();
    if (!retainingTransitionCoverage) {
      for (const id of [...this.resident.keys()]) {
        if (
          !workSet.retainIds.has(id)
          && (
            (this.lodSelection?.target.length ?? 0) === 0
            || id !== this.motionFallbackId
          )
        ) {
          this.unloadTile(id);
        }
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
      const preparedGeometries: ICEGeometry[] = [];
      try {
        this.cancelAdaptiveCandidate();
        this.restoreAdaptiveScene();
        if (this.scene.findByID(candidate.container.id)) {
          throw new Error(`ICE3_TILESET_DUPLICATE_ID: ${candidate.container.id}`);
        }
        for (const geometry of collectNodeGeometries(candidate.container)) {
          this.engine.prepareRenderBatchGeometry(geometry);
          preparedGeometries.push(geometry);
        }
        candidate.container.visible = false;
        this.scene.addChild(candidate.container);
        this.resident.set(tileId, {
          tile: candidate.tile,
          container: candidate.container,
          bytes: candidate.bytes,
          contentUris: candidate.contentUris,
          geometries: preparedGeometries,
        });
        this.residentBytes += candidate.bytes;
        this.states.set(tileId, 'loaded');
        this.emit('TILESET_TILE_LOADED', tileId);
      } catch (error) {
        for (const geometry of preparedGeometries) {
          this.engine.releaseRenderBatchGeometry(geometry);
        }
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
    if (!this.cameraMoving) this.promoteReadyVisibleTargets();
    if (this.lodSelection) this.requestWorkSetUpdate(true);
    if (!this.cameraMoving && !this.hasPendingVisibleTargets()) {
      this.enforceResidentBudget();
    }
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
    this.cancelAdaptiveCandidate();
    this.restoreAdaptiveScene();
    const record = this.resident.get(tileId);
    if (!record) return;
    this.scene.removeChild(record.container, { dispose: true });
    for (const geometry of record.geometries) {
      this.engine.releaseRenderBatchGeometry(geometry);
    }
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

  private enterCameraMotion(): void {
    this.cancelAdaptiveCandidate();
    this.restoreAdaptiveScene();
    if (this.lodSettleDelayMs === 0) {
      this.cameraMoving = false;
      this.requestWorkSetUpdate(true);
      return;
    }
    if (!this.cameraMoving) {
      this.cameraMoving = true;
    }
    if (this.lodSettleTimer !== undefined) {
      clearTimeout(this.lodSettleTimer);
    }
    this.lodSettleTimer = setTimeout(() => {
      this.lodSettleTimer = undefined;
      if (this.disposed) return;
      this.cameraMoving = false;
      this.requestWorkSetUpdate(true);
    }, this.lodSettleDelayMs);
  }

  private promoteReadyVisibleTargets(): void {
    const targets = (this.lodSelection?.target ?? []).filter((target) => (
      !this.cameraMoving
      || ![...this.visibleCoverageIds].some((visibleId) => (
        visibleId === target.id
        || this.lodAncestorIds(target.id).includes(visibleId)
        || this.lodAncestorIds(visibleId).includes(target.id)
      ))
    ));
    const targetIds = this.lodReadyVisibleCoverage(targets);
    for (const tileId of this.visibleCoverageIds) {
      if (
        !this.resident.has(tileId)
        || !this.workSet?.retainIds.has(tileId)
      ) {
        continue;
      }
      const relatedToTarget = [...targetIds].some((id) => (
        id === tileId
        || this.lodAncestorIds(id).includes(tileId)
      ));
      const coveredByTargetAncestor = this.lodAncestorIds(tileId)
        .some((id) => targetIds.has(id));
      if (!relatedToTarget && !coveredByTargetAncestor) {
        targetIds.add(tileId);
      }
    }
    if (targetIds.size === 0) return;
    const fallbackIds = new Set(
      [...(this.lodSelection?.fallbackByTargetId.values() ?? [])]
        .filter((id) => this.resident.has(id)),
    );
    this.motionFallbackId = fallbackIds.values().next().value;
    for (const [tileId, resident] of this.resident) {
      resident.container.visible = targetIds.has(tileId);
    }
    for (const tileId of targetIds) {
      const fallbackId = this.lodSelection?.fallbackByTargetId.get(tileId);
      if (fallbackId) this.failedLodFallbacks.delete(fallbackId);
    }
    this.visibleCoverageIds = targetIds;
    this.reconcileSelectionVisibility();
    this.engine.requestRender('tileset-visible-target-committed');
    if (!this.readySettled) {
      this.readySettled = true;
      this.resolveReady();
      this.trigger<ICETilesetEvent>('TILESET_READY', {
        stats: this.stats,
      });
    }
  }

  private lodReadyVisibleCoverage(
    targets: readonly ICETilesetTile[],
  ): Set<string> {
    const exact = new Set<string>();
    const fallback = new Set<string>();
    for (const target of targets) {
      if (this.resident.has(target.id)) {
        exact.add(target.id);
        continue;
      }
      const coverage = this.lodCoverageId(target);
      if (coverage) fallback.add(coverage);
    }
    const visible = new Set<string>();
    for (const id of [...exact, ...fallback]) {
      const tile = this.tilesById.get(id);
      if (!tile) continue;
      const coveredByFallback = this.lodAncestors(id).some((ancestor) => (
        fallback.has(ancestor.id)
      ));
      if (!coveredByFallback) visible.add(id);
    }
    for (const id of [...visible]) {
      const coveredByDescendant = [...visible].some((candidate) => (
        candidate !== id && this.lodAncestorIds(candidate).includes(id)
      ));
      if (coveredByDescendant) visible.delete(id);
    }
    return visible;
  }

  private reconcileSelectionVisibility(): void {
    const visibleIds = new Set<string>();
    for (const child of this.scene.children) {
      collectVisibleNodeAndSelectionIDs(child, visibleIds);
    }
    const selection = this.engine.getSelection();
    const visibleSelection = selection.filter((id) => visibleIds.has(id));
    if (visibleSelection.length !== selection.length) {
      this.engine.setSelection(visibleSelection);
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

  private maybeStartAdaptiveBatch(): void {
    if (
      !this.adaptiveController
      || this.cameraMoving
      || this.adaptiveState
      || this.adaptivePlanningSignature === this.lastSignature
    ) {
      return;
    }
    const batches = collectAdaptiveSourceBatches(
      this.scene,
      performance.now() + this.adaptiveIdleTaskBudgetMs,
    );
    if (batches.length < 2) return;
    const plan = this.adaptivePlanner.plan({
      generation: this.adaptiveController.activeGeneration + 1,
      visibleBatchIds: batches.map((batch) => batch.id),
      batches: batches.map((batch) => ({
        id: batch.id,
        materialKey: batch.materialKey,
        triangleCount: batch.geometry.indices.length / 3,
        byteLength: geometryByteLength(batch),
        bounds: batch.geometry.getBounds(),
      })),
      maxExtraGpuBytes: this.adaptiveMaxExtraGpuBytes,
    });
    if (!plan.accepted) {
      if (plan.estimatedBytes > this.adaptiveMaxExtraGpuBytes) {
        this.engine.reportDiagnostic(
          'ICE3_RENDER_BATCH_MEMORY_REJECTED',
          `Adaptive render batch generation exceeds the extra GPU memory budget (generation ${plan.generation})`,
          'warning',
        );
      }
      return;
    }
    this.adaptivePlanningSignature = this.lastSignature;
    this.adaptiveController.request({
      cameraMoving: this.cameraMoving,
      generation: plan.generation,
      plan,
    });
  }

  private async executeAdaptiveBatch(
    request: ICEAdaptiveBatchRequest,
  ): Promise<ICEAdaptiveBatchExecutionResult> {
    if (!this.batchWorkerPool) {
      return {
        kind: 'failed',
        reason: 'worker',
        error: new Error('ICE3_RENDER_BATCH_WORKER_UNAVAILABLE'),
      };
    }
    const sourceById = new Map(
      collectAdaptiveSourceBatches(this.scene).map((batch) => [
        batch.id,
        batch,
      ] as const),
    );
    this.adaptiveAbortController?.abort();
    const controller = new AbortController();
    this.adaptiveAbortController = controller;
    const materialByKey = new Map<string, ICEBasicMaterial>();
    const groups = new Map<string, ICEBatchWorkerSource[]>();
    for (const id of request.plan.sourceBatchIds) {
      const batch = sourceById.get(id);
      if (!batch) continue;
      await yieldMainThread();
      if (controller.signal.aborted) {
        return {
          kind: 'failed',
          reason: 'worker',
          error: new DOMException('Adaptive source staging aborted', 'AbortError'),
        };
      }
      materialByKey.set(batch.materialKey, batch.material);
      const group = groups.get(batch.materialKey) ?? [];
      const source = await workerSource(batch, controller.signal);
      if (controller.signal.aborted) {
        return {
          kind: 'failed',
          reason: 'worker',
          error: new DOMException('Adaptive source staging aborted', 'AbortError'),
        };
      }
      group.push(source);
      groups.set(batch.materialKey, group);
    }
    if (groups.size === 0) {
      return {
        kind: 'failed',
        reason: 'worker',
        error: new Error('ICE3_RENDER_BATCH_ADAPTIVE_EMPTY'),
      };
    }
    let responses;
    try {
      responses = await Promise.all(
        [...groups.values()].map((sources) => this.batchWorkerPool!.run({
          type: 'build',
          generation: request.generation,
          maxTrianglesPerBatch: 500_000,
          maxBytesPerBatch: 32 * 1024 * 1024,
          sources,
        }, controller.signal)),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return { kind: 'failed', reason: 'worker', error };
      }
      return { kind: 'failed', reason: 'worker', error };
    }
    const failed = responses.find((response) => response.type === 'failed');
    if (failed?.type === 'failed') {
      return {
        kind: 'failed',
        reason: 'worker',
        error: new Error(failed.message),
      };
    }
    const outputs = responses.flatMap((response) => (
      response.type === 'built' ? response.batches : []
    ));
    const uploadBuffers = outputs.map((output) => uploadBuffer(output));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        result: ICEAdaptiveBatchExecutionResult,
      ): void => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = (): void => {
        this.adaptiveUploadHandle?.cancel();
        finish({
          kind: 'failed',
          reason: 'upload',
          error: new DOMException('Adaptive batch upload aborted', 'AbortError'),
        });
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      this.adaptiveUploadHandle = queueBatchGeneration(uploadBuffers, {
        generation: request.generation,
        bytesPerFrame: this.adaptiveUploadBytesPerFrame,
        isCurrent: () => !controller.signal.aborted,
        upload: (buffer) => {
          const geometry = new ICEIndexedGeometry({
            id: buffer.id,
            positions: buffer.positions,
            indices: buffer.indices,
            semanticIndices: buffer.semanticIndices,
          });
          this.engine.prepareRenderBatchGeometry(geometry);
          return {
            buffer,
            geometry,
            material: materialByKey.get(buffer.materialKey)!,
          };
        },
        release: (resource) => {
          this.engine.releaseRenderBatchGeometry(
            (resource as ICEAdaptiveUploadedResource).geometry,
          );
        },
        onActivate: (_generation, resources) => {
          this.activateAdaptiveScene(
            request.generation,
            request.plan.sourceBatchIds,
            resources as readonly ICEAdaptiveUploadedResource[],
          );
        },
        onUploaded: () => {
          finish({
            kind: 'completed',
            estimatedBytes: request.plan.estimatedBytes,
          });
        },
        onFailed: (_generation, error) => {
          finish({ kind: 'failed', reason: 'upload', error });
        },
      });
    });
  }

  private activateAdaptiveScene(
    generation: number,
    sourceIds: readonly string[],
    resources: readonly ICEAdaptiveUploadedResource[],
  ): void {
    this.restoreAdaptiveScene();
    const sourceVisibility = new Map<ICERenderBatch, boolean>();
    const sourceNodes: ICERenderBatch[] = [];
    const adaptiveNodes = resources.map((resource, index) => (
      new ICERenderBatch({
        id: `adaptive:${generation}:${index}`,
        displayName: `adaptive-render-batch-${index}`,
        geometry: resource.geometry,
        material: resource.material,
        semanticIds: resource.buffer.semanticIds,
        semanticNodeIds: resource.buffer.semanticNodeIds,
        semanticSelectionIds: resource.buffer.semanticSelectionIds,
        materialKey: resource.buffer.materialKey,
      })
    ));
    const added: ICERenderBatch[] = [];
    try {
      for (const id of sourceIds) {
        const node = this.scene.findByID(id);
        if (!(node instanceof ICERenderBatch)) continue;
        sourceVisibility.set(node, node.visible);
        sourceNodes.push(node);
        node.visible = false;
      }
      for (const node of adaptiveNodes) {
        this.scene.addChild(node);
        added.push(node);
      }
      this.adaptiveState = {
        generation,
        nodes: adaptiveNodes,
        resources,
        sourceNodes,
        sourceVisibility,
      };
      this.engine.requestRender('adaptive-render-batch-activated');
    } catch (error) {
      for (const node of added) {
        this.scene.removeChild(node, { dispose: true });
      }
      for (const [node, visible] of sourceVisibility) {
        node.visible = visible;
      }
      this.engine.requestRender('adaptive-render-batch-restored');
      throw error;
    }
  }

  private restoreAdaptiveScene(): void {
    const state = this.adaptiveState;
    if (!state) return;
    this.adaptiveState = undefined;
    for (const node of state.nodes) {
      if (this.scene.findByID(node.id)) {
        this.scene.removeChild(node, { dispose: true });
      }
    }
    for (const resource of state.resources) {
      this.engine.releaseRenderBatchGeometry(resource.geometry);
    }
    for (const [node, visible] of state.sourceVisibility) {
      node.visible = visible;
    }
    this.engine.requestRender('adaptive-render-batch-restored');
  }

  private cancelAdaptiveCandidate(): void {
    this.adaptiveController?.cameraMotion();
    this.adaptiveAbortController?.abort();
    this.adaptivePlanningSignature = '';
  }

  private settleIdleWaiters(): void {
    const unsettled = new Set<string>([
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
    if (this.cameraMoving) unsettled.add('@lod-settle');
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
      this.maybeStartAdaptiveBatch();
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
  readonly geometries: readonly ICEGeometry[];
}

interface ICEAdaptiveSceneState {
  readonly generation: number;
  readonly nodes: readonly ICERenderBatch[];
  readonly resources: readonly ICEAdaptiveUploadedResource[];
  readonly sourceNodes: readonly ICERenderBatch[];
  readonly sourceVisibility: ReadonlyMap<ICERenderBatch, boolean>;
}

interface ICEAdaptiveUploadedResource {
  readonly buffer: ICEBatchUploadBuffer;
  readonly geometry: ICEIndexedGeometry;
  readonly material: ICEBasicMaterial;
}

function collectAdaptiveSourceBatches(
  scene: ICEScene,
  deadline = Infinity,
): ICERenderBatch[] {
  const output: ICERenderBatch[] = [];
  const visit = (node: ICENode, parentVisible: boolean): void => {
    if (output.length % 256 === 0 && performance.now() > deadline) return;
    const visible = parentVisible && node.visible;
    if (
      visible
      && node instanceof ICERenderBatch
      && !node.geometry.edgeIndices?.length
      && node.geometry.semanticIndices
    ) {
      output.push(node);
    }
    for (const child of node.children) visit(child, visible);
  };
  visit(scene, true);
  return output;
}

function geometryByteLength(batch: ICERenderBatch): number {
  return batch.geometry.positions.byteLength
    + batch.geometry.indices.byteLength
    + (batch.geometry.semanticIndices?.byteLength ?? 0);
}

async function workerSource(
  batch: ICERenderBatch,
  signal: AbortSignal,
): Promise<ICEBatchWorkerSource> {
  const semanticIndices = batch.geometry.semanticIndices!;
  return {
    id: batch.id,
    materialKey: batch.materialKey,
    positions: (
      await copyFloat32(batch.geometry.positions, signal)
    ).buffer as ArrayBuffer,
    indices: (
      await copyUint32(batch.geometry.indices, signal)
    ).buffer as ArrayBuffer,
    semanticIndices: (
      await copyUint32(semanticIndices, signal)
    ).buffer as ArrayBuffer,
    semanticIds: batch.semanticIds,
    semanticNodeIds: batch.semanticNodeIds,
    semanticSelectionIds: batch.semanticSelectionIds,
  };
}

async function copyFloat32(
  source: Float32Array,
  signal: AbortSignal,
): Promise<Float32Array> {
  const target = new Float32Array(source.length);
  for (let offset = 0; offset < source.length; offset += 262_144) {
    target.set(source.subarray(offset, offset + 262_144), offset);
    if (signal.aborted) break;
    await yieldMainThread();
  }
  return target;
}

async function copyUint32(
  source: Uint16Array | Uint32Array,
  signal: AbortSignal,
): Promise<Uint32Array> {
  const target = new Uint32Array(source.length);
  for (let offset = 0; offset < source.length; offset += 262_144) {
    target.set(source.subarray(offset, offset + 262_144), offset);
    if (signal.aborted) break;
    await yieldMainThread();
  }
  return target;
}

function uploadBuffer(
  output: ICEBatchWorkerOutput,
): ICEBatchUploadBuffer {
  const positions = new Float32Array(output.positions);
  const indices = new Uint32Array(output.indices);
  const semanticIndices = new Uint32Array(output.semanticIndices);
  return {
    id: output.id,
    materialKey: output.materialKey,
    positions,
    indices,
    semanticIndices,
    semanticIds: output.semanticIds,
    semanticNodeIds: output.semanticNodeIds,
    semanticSelectionIds: output.semanticSelectionIds,
    bounds: output.bounds,
    triangleCount: output.triangleCount,
    byteLength: positions.byteLength
      + indices.byteLength
      + semanticIndices.byteLength,
  };
}

function yieldMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ICETileCandidate extends Omit<
  ICEResidentTile,
  'tile' | 'geometries'
> {
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
  let total = 0;
  for (const geometry of collectNodeGeometries(scene)) {
    total += geometry.positions.byteLength;
    total += geometry.indices.byteLength;
    total += geometry.edgeIndices?.byteLength ?? 0;
    total += geometry.colors?.byteLength ?? 0;
    total += geometry.semanticIndices?.byteLength ?? 0;
  }
  return total;
}

function collectNodeGeometries(node: ICENode): ICEGeometry[] {
  const geometries = new Set<ICEGeometry>();
  const visit = (current: ICENode): void => {
    if (current instanceof ICEMesh) geometries.add(current.geometry);
    if (current instanceof ICERenderBatch) geometries.add(current.geometry);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return [...geometries];
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

function collectVisibleNodeAndSelectionIDs(
  node: ICENode,
  output: Set<string>,
): void {
  if (!node.visible) return;
  output.add(node.id);
  if (node instanceof ICEMesh) output.add(node.selectionId);
  for (const child of node.children) {
    collectVisibleNodeAndSelectionIDs(child, output);
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
