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
