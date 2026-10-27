export interface ICEGeometryBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ICEGeometry {
  readonly typeId: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  getBounds(): ICEGeometryBounds;
  toJSON(): Record<string, unknown>;
}
