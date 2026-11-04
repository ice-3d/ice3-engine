/**
 * Box-projected texture coordinates.
 *
 * Studio generates geometry procedurally, so meshes reach the renderer without a
 * UV attribute. The projection is derived from the surface instead: each fragment
 * is projected along the dominant axis of its normal, which is stable inside a
 * face and needs no extra vertex channel.
 *
 * This mirrors `box_projected_uvs` in Studio's exporter, so a surface textured in
 * the viewport and the same surface exported as glTF land on the same texels.
 * Coordinates are in metres; tiling is a material concern.
 */

export type ICEUvScale = readonly [number, number];

export const DEFAULT_UV_SCALE: ICEUvScale = [1, 1];

export function boxProjectedUv(
  position: readonly [number, number, number],
  normal: readonly [number, number, number],
  scale: ICEUvScale = DEFAULT_UV_SCALE,
): [number, number] {
  const [x, y, z] = position;
  const [nx, ny, nz] = normal;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const [su, sv] = scale;
  if (ax + ay + az < 1e-6) {
    // A degenerate normal says nothing about orientation; the XY plane is the
    // least surprising default.
    return [x * su, y * sv];
  }
  if (ax >= ay && ax >= az) {
    const sign = nx >= 0 ? 1 : -1;
    return [-sign * z * su, y * sv];
  }
  if (ay >= az) {
    const sign = ny >= 0 ? 1 : -1;
    return [x * su, sign * z * sv];
  }
  const sign = nz >= 0 ? 1 : -1;
  return [sign * x * su, y * sv];
}
