export interface ICEBoxGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export class ICEBoxGeometry {
  readonly typeId = 'ice3:BoxGeometry';
  readonly width: number;
  readonly height: number;
  readonly depth: number;

  constructor(options: ICEBoxGeometryOptions) {
    if (options.width <= 0 || options.height <= 0 || options.depth <= 0) {
      throw new RangeError('ICE box dimensions must be positive');
    }
    this.width = options.width;
    this.height = options.height;
    this.depth = options.depth;
  }

  getBounds(): {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } {
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
