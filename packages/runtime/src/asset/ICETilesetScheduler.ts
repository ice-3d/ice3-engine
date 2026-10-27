import {
  ICEFrustum,
  type ICEGeometryBounds,
  type ICEPerspectiveCamera,
} from '@ice3/core';
import type { ICETilesetTile } from '@ice3/assets';
import type { ICEViewport } from '@ice3/renderer';

export interface ICETilesetSchedulerOptions {
  readonly maxResidentTiles: number;
  readonly maxResidentBytes: number;
  readonly prefetchMarginRatio: number;
  readonly unloadMarginRatio: number;
}

export interface ICETilesetWorkSetInput {
  readonly assetBounds: ICEGeometryBounds;
  readonly tiles: readonly ICETilesetTile[];
  readonly camera: ICEPerspectiveCamera;
  readonly viewport: ICEViewport;
  readonly residentBytes: ReadonlyMap<string, number>;
}

export interface ICETilesetWorkSet {
  readonly visible: readonly ICETilesetTile[];
  readonly prefetch: readonly ICETilesetTile[];
  readonly retainIds: ReadonlySet<string>;
  readonly ordered: readonly ICETilesetTile[];
  readonly budgetExceeded: boolean;
}

export class ICETilesetScheduler {
  private readonly maxResidentTiles: number;
  private readonly maxResidentBytes: number;
  private readonly prefetchMarginRatio: number;
  private readonly unloadMarginRatio: number;

  constructor(options: ICETilesetSchedulerOptions) {
    if (
      !Number.isInteger(options.maxResidentTiles)
      || options.maxResidentTiles < 1
    ) {
      throw new RangeError('ICE maxResidentTiles must be a positive integer');
    }
    if (
      !Number.isFinite(options.maxResidentBytes)
      || options.maxResidentBytes <= 0
    ) {
      throw new RangeError('ICE maxResidentBytes must be positive');
    }
    if (
      !Number.isFinite(options.prefetchMarginRatio)
      || options.prefetchMarginRatio <= 0
      || !Number.isFinite(options.unloadMarginRatio)
      || options.unloadMarginRatio <= options.prefetchMarginRatio
    ) {
      throw new RangeError('ICE tile margin ratios are invalid');
    }
    this.maxResidentTiles = options.maxResidentTiles;
    this.maxResidentBytes = options.maxResidentBytes;
    this.prefetchMarginRatio = options.prefetchMarginRatio;
    this.unloadMarginRatio = options.unloadMarginRatio;
  }

  get residentTileLimit(): number {
    return this.maxResidentTiles;
  }

  get residentByteLimit(): number {
    return this.maxResidentBytes;
  }

  update(input: ICETilesetWorkSetInput): ICETilesetWorkSet {
    const aspect = input.viewport.width / Math.max(1, input.viewport.height);
    const viewProjection = input.camera.getViewProjectionMatrix(aspect);
    const strict = ICEFrustum.fromViewProjection(viewProjection);
    const prefetchFrustum = ICEFrustum.fromViewProjection(viewProjection);
    const unloadFrustum = ICEFrustum.fromViewProjection(viewProjection);
    const sceneRadius = Math.hypot(
      input.assetBounds.max[0] - input.assetBounds.min[0],
      input.assetBounds.max[1] - input.assetBounds.min[1],
      input.assetBounds.max[2] - input.assetBounds.min[2],
    ) / 2;
    const prefetchMargin = sceneRadius * this.prefetchMarginRatio;
    const unloadMargin = sceneRadius * this.unloadMarginRatio;
    const eye = input.camera.getPosition().toArray();
    const visible = input.tiles.filter((entry) => (
      strict.intersectsBounds(entry.bounds)
    ));
    const visibleIds = new Set(visible.map((entry) => entry.id));
    const prefetch = input.tiles.filter((entry) => (
      !visibleIds.has(entry.id)
      && prefetchFrustum.intersectsBounds(entry.bounds, prefetchMargin)
    ));
    const retainIds = new Set(
      input.tiles
        .filter((entry) => unloadFrustum.intersectsBounds(
          entry.bounds,
          unloadMargin,
        ))
        .map((entry) => entry.id),
    );
    const rank = new Map(
      visible.map((entry) => [entry.id, 0] as const),
    );
    const byPriority = (left: ICETilesetTile, right: ICETilesetTile): number => (
      (rank.get(left.id) ?? 1) - (rank.get(right.id) ?? 1)
      || distance(left, eye) - distance(right, eye)
      || left.id.localeCompare(right.id, 'en')
    );
    visible.sort(byPriority);
    prefetch.sort(byPriority);
    const byteTotal = [...input.residentBytes.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    return {
      visible: Object.freeze(visible),
      prefetch: Object.freeze(prefetch),
      retainIds,
      ordered: Object.freeze([...visible, ...prefetch]),
      budgetExceeded: input.residentBytes.size > this.maxResidentTiles
        || byteTotal > this.maxResidentBytes,
    };
  }
}

function distance(
  tile: ICETilesetTile,
  eye: readonly number[],
): number {
  const center = boundsCenter(tile.bounds);
  return Math.hypot(
    center[0] - eye[0]!,
    center[1] - eye[1]!,
    center[2] - eye[2]!,
  );
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
