export type ICEVector3Tuple = readonly [number, number, number];

export class ICEVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    Object.freeze(this);
  }

  clone(): ICEVector3 {
    return new ICEVector3(this.x, this.y, this.z);
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}
