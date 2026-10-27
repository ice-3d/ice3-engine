import {
  ICEPerspectiveCamera,
  ICEVector3,
  type ICEVector3Tuple,
} from '@ice3/core';
import type { ICEViewport } from '@ice3/renderer';

export interface ICEProjectedPoint {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly depth: number;
}

export function projectWorldPoint(
  camera: ICEPerspectiveCamera,
  position: ICEVector3Tuple,
  viewport: ICEViewport,
): ICEProjectedPoint {
  const aspect = viewport.width / Math.max(viewport.height, 1);
  const [x, y, z, w] = camera
    .getViewProjectionMatrix(aspect)
    .transformPoint(new ICEVector3(...position));
  const safeW = Math.max(Math.abs(w), Number.EPSILON) * Math.sign(w || 1);
  const ndcX = x / safeW;
  const ndcY = y / safeW;
  const ndcZ = z / safeW;
  return {
    x: viewport.x + ((ndcX + 1) / 2) * viewport.width,
    y: viewport.y + ((1 - ndcY) / 2) * viewport.height,
    visible: w > 0
      && ndcX >= -1
      && ndcX <= 1
      && ndcY >= -1
      && ndcY <= 1
      && ndcZ >= -1
      && ndcZ <= 1,
    depth: ndcZ,
  };
}
