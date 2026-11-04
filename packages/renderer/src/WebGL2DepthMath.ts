//! 深度的视空间换算。
//!
//! 屏幕空间遮蔽必须按**物理半径**采样，而深度缓冲给的是非线性 NDC 深度：远端十米
//! 的差别在数值上可能只有千分之几，直接比较深度差表达不了"1 米"这种量
//! （SPEC-007 第 2.5 节）。所以先把深度还原成视空间坐标，再按半径取样本。
//!
//! 这里的实现与 `WebGL2Program` 里的 GLSL 逐行对应：着色器负责逐像素，这里负责
//! 让同一套换算可以在没有 GPU 的情况下被单测钉住。

export type PerspectiveProjection = {
  /** 投影矩阵列主序元素，与 `ICEMatrix4.elements` 一致。 */
  readonly elements: Float32Array | readonly number[];
  readonly near: number;
  readonly far: number;
};

/**
 * NDC `(x, y, depth)` → 视空间坐标（右手系，相机看向 −Z）。
 *
 * `depth` 取深度缓冲里的值，范围 `[0, 1]`。
 */
export function viewPositionFromNdc(
  ndcX: number,
  ndcY: number,
  depth: number,
  projection: PerspectiveProjection,
): [number, number, number] {
  const e = projection.elements;
  // 透视投影里 p[0][0] = 1/(tanHalfFov·aspect)、p[1][1] = 1/tanHalfFov，
  // 所以两者的倒数就是半张角的正切与纵横比，不需要另外传 fov。
  const reciprocalX = e[0]!;
  const reciprocalY = e[5]!;
  const tanHalfFov = 1 / reciprocalY;
  const aspect = reciprocalY / reciprocalX;
  const ndcZ = depth * 2 - 1;
  const { near, far } = projection;
  // 透视深度的线性化：z_ndc → 视空间 −z。
  const linear =
    (2 * near * far) / (far + near - ndcZ * (far - near));
  return [
    ndcX * tanHalfFov * aspect * linear,
    ndcY * tanHalfFov * linear,
    -linear,
  ];
}

/** 视空间坐标 → NDC；`w` 不为正说明落在相机背面。 */
export function ndcFromViewPosition(
  position: readonly [number, number, number],
  projection: PerspectiveProjection,
): [number, number, number, number] {
  const e = projection.elements;
  const [x, y, z] = position;
  const clipX = e[0]! * x + e[8]! * z;
  const clipY = e[5]! * y + e[9]! * z;
  const clipZ = e[10]! * z + e[14]!;
  const clipW = e[11]! * z;
  return [clipX / clipW, clipY / clipW, clipZ / clipW, clipW];
}

/**
 * 视空间半径 → 屏幕像素半径。
 *
 * 用样本点到相机的深度换算，靠近相机时半径自然放大、远处收小；这正是
 * "按视距自适应"要的效果，而且不需要知道世界单位与像素的比例。
 */
export function screenRadiusForWorldRadius(
  worldRadius: number,
  viewDepth: number,
  viewportHeight: number,
  projection: PerspectiveProjection,
): number {
  const tanHalfFov = 1 / projection.elements[5]!;
  const halfHeightAtDepth = Math.max(1e-6, viewDepth * tanHalfFov);
  return (worldRadius / halfHeightAtDepth) * (viewportHeight * 0.5);
}
