export interface ICEBoxGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export class ICEBoxGeometry implements ICEGeometry {
  readonly typeId = 'ice3:BoxGeometry';
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  readonly edgeIndices: Uint16Array;

  constructor(options: ICEBoxGeometryOptions) {
    if (options.width <= 0 || options.height <= 0 || options.depth <= 0) {
      throw new RangeError('ICE box dimensions must be positive');
    }
    this.width = options.width;
    this.height = options.height;
    this.depth = options.depth;
    this.positions = scaledPositions(options);
    this.indices = BOX_INDICES;
    this.edgeIndices = BOX_EDGE_INDICES;
  }

  getBounds(): ICEGeometryBounds {
    return {
      min: [-this.width / 2, -this.height / 2, -this.depth / 2],
      max: [this.width / 2, this.height / 2, this.depth / 2],
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      width: this.width,
      height: this.height,
      depth: this.depth,
    };
  }
}

function scaledPositions(options: ICEBoxGeometryOptions): Float32Array {
  const positions = new Float32Array(BOX_POSITIONS);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! * options.width;
    positions[index + 1] = positions[index + 1]! * options.height;
    positions[index + 2] = positions[index + 2]! * options.depth;
  }
  return positions;
}
import type { ICEGeometry, ICEGeometryBounds } from './ICEGeometry.js';

const BOX_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5,
  0.5, -0.5, 0.5,
  0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5,
  0.5, -0.5, -0.5,
  0.5, 0.5, -0.5,
  -0.5, 0.5, -0.5,
]);

const BOX_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3,
  5, 4, 7, 5, 7, 6,
  4, 0, 3, 4, 3, 7,
  1, 5, 6, 1, 6, 2,
  3, 2, 6, 3, 6, 7,
  4, 5, 1, 4, 1, 0,
]);

const BOX_EDGE_INDICES = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);
