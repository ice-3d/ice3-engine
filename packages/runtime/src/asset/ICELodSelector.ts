import type { ICETilesetTile } from '@ice3/assets';
import {
  ICEFrustum,
  type ICEGeometryBounds,
  type ICEPerspectiveCamera,
} from '@ice3/core';
import type { ICEViewport } from '@ice3/renderer';

export interface ICELodSelectionInput {
  readonly root: ICETilesetTile;
  readonly camera: ICEPerspectiveCamera;
  readonly viewport: ICEViewport;
  readonly residentIds: ReadonlySet<string>;
  readonly failedIds: ReadonlySet<string>;
  readonly maxScreenSpaceErrorPixels: number;
}

export interface ICELodSelection {
  readonly target: readonly ICETilesetTile[];
  readonly prefetch: readonly ICETilesetTile[];
  readonly fallbackByTargetId: ReadonlyMap<string, string>;
}

export class ICELodSelector {
  select(input: ICELodSelectionInput): ICELodSelection {
    if (
      !Number.isFinite(input.maxScreenSpaceErrorPixels)
      || input.maxScreenSpaceErrorPixels <= 0
    ) {
      throw new Error(
        'ICE3_TILESET_LOD_INVALID: maxScreenSpaceErrorPixels must be positive',
      );
    }
    const aspect = input.viewport.width / Math.max(1, input.viewport.height);
    const frustum = ICEFrustum.fromViewProjection(
      input.camera.getViewProjectionMatrix(aspect),
    );
    const targets = new Map<string, ICETilesetTile>();
    const fallbackByTargetId = new Map<string, string>();
    const visit = (
      tile: ICETilesetTile,
      nearestContent?: ICETilesetTile,
    ): void => {
      if (!frustum.intersectsBounds(tile.bounds)) return;
      const contentAncestor = tile.contentUri ? tile : nearestContent;
      const shouldRefine = tile.children.length > 0
        && tile.geometricError > 0
        && screenSpaceError(
          tile,
          input.camera,
          input.viewport,
        ) > input.maxScreenSpaceErrorPixels;
      if (shouldRefine) {
        const before = targets.size;
        for (const child of tile.children) visit(child, contentAncestor);
        if (targets.size === before && tile.contentUri) {
          addTarget(tile, nearestContent);
        }
        return;
      }
      if (tile.contentUri) {
        addTarget(tile, nearestContent);
        return;
      }
      for (const child of tile.children) visit(child, nearestContent);
    };
    const addTarget = (
      tile: ICETilesetTile,
      nearestContent?: ICETilesetTile,
    ): void => {
      if (input.failedIds.has(tile.id) && nearestContent) {
        targets.set(nearestContent.id, nearestContent);
        return;
      }
      targets.set(tile.id, tile);
      if (nearestContent) {
        fallbackByTargetId.set(tile.id, nearestContent.id);
      }
    };

    visit(input.root);
    const targetIds = new Set(targets.keys());
    const prefetch = new Map<string, ICETilesetTile>();
    const addPrefetch = (tile: ICETilesetTile): void => {
      if (targetIds.has(tile.id) || input.residentIds.has(tile.id)) return;
      prefetch.set(tile.id, tile);
    };
    for (const tile of targets.values()) {
      for (const child of tile.children) {
        if (child.contentUris?.length > 0 || child.contentUri) {
          addPrefetch(child);
        } else {
          for (const descendant of child.children) {
            if (descendant.contentUris?.length > 0 || descendant.contentUri) {
              addPrefetch(descendant);
            }
          }
        }
      }
    }
    return {
      target: Object.freeze([...targets.values()]),
      prefetch: Object.freeze(
        [...prefetch.values()].sort((left, right) => (
          left.id.localeCompare(right.id, 'en')
        )),
      ),
      fallbackByTargetId,
    };
  }
}

function screenSpaceError(
  tile: ICETilesetTile,
  camera: ICEPerspectiveCamera,
  viewport: ICEViewport,
): number {
  const distance = Math.max(
    camera.near,
    distanceToBounds(camera.getPosition().toArray(), tile.bounds),
  );
  return tile.geometricError * viewport.height / (
    2 * distance * Math.tan(camera.fov * Math.PI / 360)
  );
}

function distanceToBounds(
  point: readonly number[],
  bounds: ICEGeometryBounds,
): number {
  const delta = [0, 1, 2].map((axis) => {
    const value = point[axis]!;
    if (value < bounds.min[axis]!) return bounds.min[axis]! - value;
    if (value > bounds.max[axis]!) return value - bounds.max[axis]!;
    return 0;
  });
  return Math.hypot(delta[0]!, delta[1]!, delta[2]!);
}
