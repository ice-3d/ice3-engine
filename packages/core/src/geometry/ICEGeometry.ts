export interface ICEGeometryBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ICEGeometryIdentity {
  readonly geometryId: string;
  readonly topologyDigest: string;
  readonly attributeDigest: string;
}

export interface ICEGeometryByteRange {
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface ICEGeometryBufferUpdate {
  readonly positionRanges: readonly ICEGeometryByteRange[];
}

export interface ICEGeometry {
  readonly typeId: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  readonly colors?: Float32Array;
  readonly semanticIndices?: Uint32Array;
  readonly identity?: ICEGeometryIdentity;
  getBounds(): ICEGeometryBounds;
  toJSON(): Record<string, unknown>;
}
