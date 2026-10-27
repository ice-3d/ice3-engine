import type {
  ICEGeometryBounds,
  ICEMatrix4Tuple,
} from '@ice3/core';

export interface ICEPreparedNode {
  readonly id: string;
  readonly name: string;
  readonly parent: number | null;
  readonly matrix: ICEMatrix4Tuple;
  readonly visible: boolean;
}

export interface ICEPreparedGeometry {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  readonly bounds: ICEGeometryBounds;
}

export interface ICEPreparedMaterial {
  readonly id: string;
  readonly baseColor: string;
  readonly edgeColor?: string;
}

export interface ICEPreparedMesh {
  readonly id: string;
  readonly node: number;
  readonly geometry: number;
  readonly material: number;
}

export interface ICEPreparedAssetSnapshot {
  readonly assetId: string;
  readonly bounds: ICEGeometryBounds;
  readonly stats: Readonly<{
    nodeCount: number;
    meshCount: number;
    triangleCount: number;
  }>;
  readonly nodes: readonly ICEPreparedNode[];
  readonly geometries: readonly ICEPreparedGeometry[];
  readonly materials: readonly ICEPreparedMaterial[];
  readonly meshes: readonly ICEPreparedMesh[];
}
