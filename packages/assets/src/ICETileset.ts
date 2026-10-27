import type { ICEGeometryBounds } from '@ice3/core';

export interface ICETilesetTile {
  readonly id: string;
  readonly bounds: ICEGeometryBounds;
  readonly contentUris: readonly string[];
  readonly contentUri?: string;
  readonly children: readonly ICETilesetTile[];
  readonly geometricError: number;
  readonly transform?: readonly number[];
}

export interface ICETilesetSnapshot {
  readonly assetId: string;
  readonly root: ICETilesetTile;
  readonly bounds: ICEGeometryBounds;
  readonly tiles: readonly ICETilesetTile[];
}
