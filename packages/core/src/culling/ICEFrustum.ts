import type { ICEGeometryBounds } from '../geometry/ICEGeometry.js';
import type { ICEMatrix4 } from '../math/ICEMatrix4.js';

type Plane = readonly [number, number, number, number];

export class ICEFrustum {
  private constructor(
    private readonly planes: readonly Plane[],
  ) {}

  static fromViewProjection(matrix: ICEMatrix4): ICEFrustum {
    const m = matrix.elements;
    const row0 = [m[0]!, m[4]!, m[8]!, m[12]!] as const;
    const row1 = [m[1]!, m[5]!, m[9]!, m[13]!] as const;
    const row2 = [m[2]!, m[6]!, m[10]!, m[14]!] as const;
    const row3 = [m[3]!, m[7]!, m[11]!, m[15]!] as const;
    return new ICEFrustum([
      normalizePlane(add(row3, row0)),
      normalizePlane(subtract(row3, row0)),
      normalizePlane(add(row3, row1)),
      normalizePlane(subtract(row3, row1)),
      normalizePlane(add(row3, row2)),
      normalizePlane(subtract(row3, row2)),
    ]);
  }

  intersectsBounds(bounds: ICEGeometryBounds, margin = 0): boolean {
    const values = [...bounds.min, ...bounds.max];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError('ICE frustum bounds must be finite');
    }
    if (
      bounds.min.some((value, axis) => value > bounds.max[axis]!)
      || !Number.isFinite(margin)
      || margin < 0
    ) {
      throw new RangeError('ICE frustum bounds or margin are invalid');
    }
    for (const [a, b, c, d] of this.planes) {
      const x = a >= 0 ? bounds.max[0] : bounds.min[0];
      const y = b >= 0 ? bounds.max[1] : bounds.min[1];
      const z = c >= 0 ? bounds.max[2] : bounds.min[2];
      if (a * x + b * y + c * z + d < -margin) {
        return false;
      }
    }
    return true;
  }
}

function add(
  left: readonly number[],
  right: readonly number[],
): [number, number, number, number] {
  return [
    left[0]! + right[0]!,
    left[1]! + right[1]!,
    left[2]! + right[2]!,
    left[3]! + right[3]!,
  ];
}

function subtract(
  left: readonly number[],
  right: readonly number[],
): [number, number, number, number] {
  return [
    left[0]! - right[0]!,
    left[1]! - right[1]!,
    left[2]! - right[2]!,
    left[3]! - right[3]!,
  ];
}

function normalizePlane(
  plane: readonly [number, number, number, number],
): Plane {
  const length = Math.hypot(plane[0], plane[1], plane[2]);
  if (length === 0 || !Number.isFinite(length)) {
    throw new TypeError('ICE frustum matrix produced an invalid plane');
  }
  return [
    plane[0] / length,
    plane[1] / length,
    plane[2] / length,
    plane[3] / length,
  ];
}
