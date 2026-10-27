import type { ICEGeometry, ICEGeometryBounds } from './ICEGeometry.js';

export interface ICEIndexedGeometryOptions {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  readonly colors?: Float32Array;
}

export class ICEIndexedGeometry implements ICEGeometry {
  readonly typeId = 'ice3:IndexedGeometry';
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  readonly colors?: Float32Array;

  constructor(options: ICEIndexedGeometryOptions) {
    if (!options.id.trim()) {
      throw new TypeError('ICE geometry ID must not be empty');
    }
    if (
      options.positions.length === 0
      || options.positions.length % 3 !== 0
      || options.positions.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError('ICE indexed geometry positions are invalid');
    }
    const vertexCount = options.positions.length / 3;
    for (const index of options.indices) {
      if (index >= vertexCount) {
        throw new RangeError('ICE indexed geometry index is out of range');
      }
    }
    for (const index of options.edgeIndices ?? []) {
      if (index >= vertexCount) {
        throw new RangeError('ICE indexed geometry edge index is out of range');
      }
    }
    if (options.edgeIndices && options.edgeIndices.length % 2 !== 0) {
      throw new TypeError('ICE edge index count must be even');
    }
    if (
      options.colors
      && options.colors.length !== vertexCount * 3
      && options.colors.length !== vertexCount * 4
    ) {
      throw new TypeError(
        'ICE color count must be 3 or 4 values per vertex',
      );
    }
    this.id = options.id;
    this.positions = options.positions;
    this.indices = options.indices;
    if (options.edgeIndices) {
      this.edgeIndices = options.edgeIndices;
    }
    if (options.colors) {
      this.colors = options.colors;
    }
  }

  getBounds(): ICEGeometryBounds {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < this.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = this.positions[index + axis]!;
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
    }
    return { min, max };
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      id: this.id,
      positionCount: this.positions.length / 3,
      indexCount: this.indices.length,
      edgeIndexCount: this.edgeIndices?.length ?? 0,
      colorCount: this.colors ? this.positions.length / 3 : 0,
      bounds: this.getBounds(),
    };
  }
}
