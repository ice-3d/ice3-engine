import type {
  ICEGeometryBounds,
  ICEMatrix4Tuple,
} from '@ice3/core';

export interface ICEPreparedNode {
  readonly id: string;
  readonly selectionId: string;
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
  readonly colors?: Float32Array;
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

export interface ICEPreparedStats {
  readonly nodeCount: number;
  readonly maxNodeDepth: number;
  readonly meshCount: number;
  readonly primitiveCount: number;
  readonly triangleCount: number;
  readonly edgeSegmentCount: number;
  readonly materialCount: number;
  readonly selectionGroupCount: number;
}

export interface ICEPreparedContract {
  readonly status: 'active' | 'legacy';
  readonly version?: string;
  readonly preparation?: Readonly<{
    runtimeConversionRequired: false;
    sourceFormat: 'gltf-2.0';
    unitsNormalized: true;
    matrixTransformsBaked: true;
    requiredCompressionDecoded: true;
    edgesPrepared: boolean;
    selectionGroupsPrepared: true;
  }>;
  readonly budget?: Readonly<{
    profile: string;
    status: 'pass' | 'warning' | 'error';
    warningCount: number;
    errorCount: number;
  }>;
}

export interface ICEPreparedAssetSnapshot {
  readonly assetId: string;
  readonly bounds: ICEGeometryBounds;
  readonly stats: ICEPreparedStats;
  readonly contract: ICEPreparedContract;
  readonly nodes: readonly ICEPreparedNode[];
  readonly geometries: readonly ICEPreparedGeometry[];
  readonly materials: readonly ICEPreparedMaterial[];
  readonly meshes: readonly ICEPreparedMesh[];
}
