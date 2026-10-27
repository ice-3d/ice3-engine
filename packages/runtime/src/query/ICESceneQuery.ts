import {
  ICEMesh,
  type ICEGeometryBounds,
  type ICENode,
  type ICEScene,
} from '@ice3/core';

export interface ICESceneQuery {
  readonly ids?: readonly string[];
  readonly selectionIds?: readonly string[];
  readonly bounds?: ICEGeometryBounds;
  readonly visibleOnly?: boolean;
  readonly limit?: number;
}

export interface ICESceneItem {
  readonly nodeId: string;
  readonly selectionId: string;
  readonly name: string;
  readonly typeId: string;
  readonly bounds: ICEGeometryBounds;
  readonly visible: boolean;
}

export interface ICERay {
  readonly origin: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
  readonly maxDistance?: number;
}

export function raycastSceneNode(
  scene: ICEScene,
  ray: ICERay,
): ICENode | undefined {
  const values = [...ray.origin, ...ray.direction];
  const length = Math.hypot(...ray.direction);
  if (values.some((value) => !Number.isFinite(value)) || length === 0
    || (ray.maxDistance !== undefined && (!Number.isFinite(ray.maxDistance) || ray.maxDistance <= 0))) {
    throw new Error('ICE3_SCENE_QUERY_INVALID: ray is invalid');
  }
  const direction = ray.direction.map((value) => value / length);
  const maxDistance = ray.maxDistance ?? Infinity;
  let nearest = maxDistance;
  let hit: ICEMesh | undefined;
  const visit = (node: ICENode): void => {
    if (!node.visible) return;
    if (node instanceof ICEMesh) {
      const matrix = node.updateWorldMatrix().elements;
      const transform = (index: number): readonly [number, number, number] => {
        const x = node.geometry.positions[index * 3]!;
        const y = node.geometry.positions[index * 3 + 1]!;
        const z = node.geometry.positions[index * 3 + 2]!;
        return [
          matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
        ];
      };
      for (let i = 0; i < node.geometry.indices.length; i += 3) {
        const distance = intersectTriangle(
          ray.origin,
          direction,
          transform(node.geometry.indices[i]!),
          transform(node.geometry.indices[i + 1]!),
          transform(node.geometry.indices[i + 2]!),
        );
        if (distance >= 0 && distance < nearest) {
          nearest = distance;
          hit = node;
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(scene);
  return hit;
}

function intersectTriangle(
  origin: readonly number[],
  direction: readonly number[],
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): number {
  const edge1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const edge2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  const p = [
    direction[1]! * edge2[2]! - direction[2]! * edge2[1]!,
    direction[2]! * edge2[0]! - direction[0]! * edge2[2]!,
    direction[0]! * edge2[1]! - direction[1]! * edge2[0]!,
  ];
  const determinant = edge1[0]! * p[0]! + edge1[1]! * p[1]! + edge1[2]! * p[2]!;
  if (Math.abs(determinant) < 1e-9) return -1;
  const inverse = 1 / determinant;
  const t = [origin[0]! - a[0]!, origin[1]! - a[1]!, origin[2]! - a[2]!];
  const u = (t[0]! * p[0]! + t[1]! * p[1]! + t[2]! * p[2]!) * inverse;
  if (u < 0 || u > 1) return -1;
  const q = [
    t[1]! * edge1[2]! - t[2]! * edge1[1]!,
    t[2]! * edge1[0]! - t[0]! * edge1[2]!,
    t[0]! * edge1[1]! - t[1]! * edge1[0]!,
  ];
  const v = (direction[0]! * q[0]! + direction[1]! * q[1]! + direction[2]! * q[2]!) * inverse;
  if (v < 0 || u + v > 1) return -1;
  return (edge2[0]! * q[0]! + edge2[1]! * q[1]! + edge2[2]! * q[2]!) * inverse;
}

export function collectSceneItems(
  scene: ICEScene,
  query: ICESceneQuery = {},
): readonly ICESceneItem[] {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new Error('ICE3_SCENE_QUERY_INVALID: limit must be positive');
  }
  const ids = query.ids ? new Set(query.ids) : undefined;
  const selections = query.selectionIds ? new Set(query.selectionIds) : undefined;
  const items = new Map<string, { item: ICESceneItem; depth: number }>();
  const visit = (node: ICENode, depth: number, inheritedVisible: boolean): void => {
    const visible = inheritedVisible && node.visible;
    if (node instanceof ICEMesh) {
      const matrix = node.updateWorldMatrix().elements;
      const local = node.geometry.getBounds();
      const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => {
        const p = [x ? local.max[0] : local.min[0], y ? local.max[1] : local.min[1], z ? local.max[2] : local.min[2]];
        return [matrix[0]! * p[0]! + matrix[4]! * p[1]! + matrix[8]! * p[2]! + matrix[12]!, matrix[1]! * p[0]! + matrix[5]! * p[1]! + matrix[9]! * p[2]! + matrix[13]!, matrix[2]! * p[0]! + matrix[6]! * p[1]! + matrix[10]! * p[2]! + matrix[14]!] as const;
      })));
      const bounds: ICEGeometryBounds = {
        min: [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.min(...corners.map((p) => p[2]))],
        max: [Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[2]))],
      };
      const item = Object.freeze({
        nodeId: node.id,
        selectionId: node.selectionId,
        name: node.displayName,
        typeId: node.typeId,
        bounds: Object.freeze(bounds),
        visible,
      });
      const previous = items.get(item.selectionId);
      if (!previous || depth > previous.depth || (depth === previous.depth && item.nodeId < previous.item.nodeId)) {
        items.set(item.selectionId, { item, depth });
      }
    }
    for (const child of node.children) visit(child, depth + 1, visible);
  };
  visit(scene, 0, true);
  const filtered = [...items.values()].map((entry) => entry.item)
    .filter((item) => !ids || ids.has(item.nodeId))
    .filter((item) => !selections || selections.has(item.selectionId))
    .filter((item) => !query.visibleOnly || item.visible)
    .sort((a, b) => a.selectionId.localeCompare(b.selectionId, 'en'));
  return Object.freeze((query.limit ? filtered.slice(0, query.limit) : filtered));
}
