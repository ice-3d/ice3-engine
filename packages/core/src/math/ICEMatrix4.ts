import { ICEVector3 } from './ICEVector3';

const dot = (left: ICEVector3, right: ICEVector3): number =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const cross = (left: ICEVector3, right: ICEVector3): ICEVector3 =>
  new ICEVector3(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );

const normalize = (value: ICEVector3): ICEVector3 => {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length === 0) {
    return new ICEVector3();
  }
  return new ICEVector3(value.x / length, value.y / length, value.z / length);
};

export class ICEMatrix4 {
  readonly elements = new Float32Array(16);

  constructor() {
    this.identity();
  }

  identity(): this {
    this.elements.fill(0);
    this.elements[0] = 1;
    this.elements[5] = 1;
    this.elements[10] = 1;
    this.elements[15] = 1;
    return this;
  }

  multiply(other: ICEMatrix4): this {
    const left = this.elements.slice();
    const right = other.elements;

    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let value = 0;
        for (let index = 0; index < 4; index += 1) {
          value += left[index * 4 + row]! * right[column * 4 + index]!;
        }
        this.elements[column * 4 + row] = value;
      }
    }
    return this;
  }

  perspective(fovDegrees: number, aspect: number, near: number, far: number): this {
    const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
    this.elements.fill(0);
    this.elements[0] = f / aspect;
    this.elements[5] = f;
    this.elements[10] = (far + near) / (near - far);
    this.elements[11] = -1;
    this.elements[14] = (2 * far * near) / (near - far);
    return this;
  }

  lookAt(eye: ICEVector3, target: ICEVector3, up: ICEVector3): this {
    const zAxis = normalize(
      new ICEVector3(eye.x - target.x, eye.y - target.y, eye.z - target.z),
    );
    const xAxis = normalize(cross(up, zAxis));
    const yAxis = cross(zAxis, xAxis);

    this.elements[0] = xAxis.x;
    this.elements[1] = yAxis.x;
    this.elements[2] = zAxis.x;
    this.elements[3] = 0;
    this.elements[4] = xAxis.y;
    this.elements[5] = yAxis.y;
    this.elements[6] = zAxis.y;
    this.elements[7] = 0;
    this.elements[8] = xAxis.z;
    this.elements[9] = yAxis.z;
    this.elements[10] = zAxis.z;
    this.elements[11] = 0;
    this.elements[12] = -dot(xAxis, eye);
    this.elements[13] = -dot(yAxis, eye);
    this.elements[14] = -dot(zAxis, eye);
    this.elements[15] = 1;
    return this;
  }

  transformPoint(point: ICEVector3): [number, number, number, number] {
    const elements = this.elements;
    const x = elements[0]! * point.x
      + elements[4]! * point.y
      + elements[8]! * point.z
      + elements[12]!;
    const y = elements[1]! * point.x
      + elements[5]! * point.y
      + elements[9]! * point.z
      + elements[13]!;
    const z = elements[2]! * point.x
      + elements[6]! * point.y
      + elements[10]! * point.z
      + elements[14]!;
    const w = elements[3]! * point.x
      + elements[7]! * point.y
      + elements[11]! * point.z
      + elements[15]!;
    return [x, y, z, w];
  }
}
