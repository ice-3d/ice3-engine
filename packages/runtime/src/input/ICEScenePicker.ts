import {
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
  type ICENode,
} from '@ice3/core';
import type { ICEViewport } from '@ice3/renderer';

export function pickSceneNode(
  scene: ICEScene,
  camera: ICEPerspectiveCamera,
  viewport: ICEViewport,
  point: { readonly x: number; readonly y: number },
): ICENode | undefined {
  const eye = camera.getPosition();
  const target = camera.getTarget();
  const forward = normalize([
    target.x - eye.x,
    target.y - eye.y,
    target.z - eye.z,
  ]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  const aspect = viewport.width / Math.max(viewport.height, 1);
  const tangent = Math.tan((camera.fov * Math.PI) / 360);
  const ndcX = (point.x / viewport.width) * 2 - 1;
  const ndcY = 1 - (point.y / viewport.height) * 2;
  const direction = normalize([
    forward[0] + right[0] * ndcX * aspect * tangent + up[0] * ndcY * tangent,
    forward[1] + right[1] * ndcX * aspect * tangent + up[1] * ndcY * tangent,
    forward[2] + right[2] * ndcX * aspect * tangent + up[2] * ndcY * tangent,
  ]);

  let nearest: ICENode | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const visit = (node: ICENode, parentVisible: boolean): void => {
    const visible = parentVisible && node.visible;
    if (!visible) {
      return;
    }
    if (node instanceof ICEMesh) {
      const inverse = invertMatrix(node.updateWorldMatrix().elements);
      if (!inverse) {
        return;
      }
      const localOrigin = transformPoint(inverse, eye.toArray(), 1);
      const localDirection = transformPoint(inverse, direction, 0);
      const { min, max } = node.geometry.getBounds();
      const distance = rayBoxDistance(localOrigin, localDirection, min, max);
      if (distance !== undefined && distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    for (const child of node.children) {
      visit(child, visible);
    }
  };
  visit(scene, true);
  return nearest;
}

const normalize = (
  value: readonly [number, number, number],
): [number, number, number] => {
  const length = Math.hypot(...value);
  return length > 0
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 0, 0];
};

const cross = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const rayBoxDistance = (
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): number | undefined => {
  let near = -Number.POSITIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const value = direction[axis]!;
    if (Math.abs(value) < 1e-9) {
      if (origin[axis]! < min[axis]! || origin[axis]! > max[axis]!) {
        return undefined;
      }
      continue;
    }
    const first = (min[axis]! - origin[axis]!) / value;
    const second = (max[axis]! - origin[axis]!) / value;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (far < near || far < 0) {
      return undefined;
    }
  }
  return near >= 0 ? near : far >= 0 ? far : undefined;
};

const transformPoint = (
  matrix: readonly number[],
  point: readonly [number, number, number],
  w: number,
): [number, number, number] => [
  matrix[0]! * point[0]! + matrix[4]! * point[1]! + matrix[8]! * point[2]!
    + matrix[12]! * w,
  matrix[1]! * point[0]! + matrix[5]! * point[1]! + matrix[9]! * point[2]!
    + matrix[13]! * w,
  matrix[2]! * point[0]! + matrix[6]! * point[1]! + matrix[10]! * point[2]!
    + matrix[14]! * w,
];

const invertMatrix = (source: ArrayLike<number>): number[] | undefined => {
  const inverse = new Array<number>(16);
  const a00 = source[0]!;
  const a01 = source[1]!;
  const a02 = source[2]!;
  const a03 = source[3]!;
  const a10 = source[4]!;
  const a11 = source[5]!;
  const a12 = source[6]!;
  const a13 = source[7]!;
  const a20 = source[8]!;
  const a21 = source[9]!;
  const a22 = source[10]!;
  const a23 = source[11]!;
  const a30 = source[12]!;
  const a31 = source[13]!;
  const a32 = source[14]!;
  const a33 = source[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12) {
    return undefined;
  }
  const value = 1 / determinant;
  inverse[0] = (a11 * b11 - a12 * b10 + a13 * b09) * value;
  inverse[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * value;
  inverse[2] = (a31 * b05 - a32 * b04 + a33 * b03) * value;
  inverse[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * value;
  inverse[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * value;
  inverse[5] = (a00 * b11 - a02 * b08 + a03 * b07) * value;
  inverse[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * value;
  inverse[7] = (a20 * b05 - a22 * b02 + a23 * b01) * value;
  inverse[8] = (a10 * b10 - a11 * b08 + a13 * b06) * value;
  inverse[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * value;
  inverse[10] = (a30 * b04 - a31 * b02 + a33 * b00) * value;
  inverse[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * value;
  inverse[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * value;
  inverse[13] = (a00 * b09 - a01 * b07 + a02 * b06) * value;
  inverse[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * value;
  inverse[15] = (a20 * b03 - a21 * b01 + a22 * b00) * value;
  return inverse;
};
