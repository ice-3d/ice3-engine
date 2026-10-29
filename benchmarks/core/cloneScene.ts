import {
  ICEMesh,
  ICENode,
  ICEScene,
} from '@ice3/core';
import { ICERenderBatch } from '@ice3/runtime';

const copyId = (copy: number, id: string): string => (
  `${id}:benchmark-copy/${copy}`
);

export function cloneBenchmarkScene(
  source: ICEScene,
  copies: number,
): ICEScene {
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error('ICE3_BENCHMARK_INVALID: copies must be positive');
  }
  const scene = new ICEScene({ id: `${source.id}:scale/${copies}` });
  for (let copy = 0; copy < copies; copy += 1) {
    const container = new ICENode({
      id: `${source.id}:benchmark-copy-group/${copy}`,
      position: [copy * 500, 0, copy * 500],
    });
    scene.addChild(container);
    copyChildren(source, container, copy);
  }
  return scene;
}

function copyChildren(
  source: ICENode,
  target: ICENode,
  copy: number,
): void {
  for (const child of source.children) {
    const json = child.toJSON();
    const id = copyId(copy, child.id);
    let next: ICENode;
    if (child instanceof ICEMesh) {
      next = new ICEMesh({
        id,
        displayName: child.displayName,
        selectionId: copyId(copy, child.selectionId),
        ...(json.metadata ? { metadata: json.metadata } : {}),
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
        geometry: child.geometry,
        material: child.material,
      });
    } else if (child instanceof ICERenderBatch) {
      next = new ICERenderBatch({
        id,
        displayName: child.displayName,
        ...(json.metadata ? { metadata: json.metadata } : {}),
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
        geometry: child.geometry,
        material: child.material,
        semanticIds: child.semanticIds,
        semanticNodeIds: child.semanticNodeIds.map(
          (value) => copyId(copy, value),
        ),
        semanticSelectionIds: child.semanticSelectionIds.map(
          (value) => copyId(copy, value),
        ),
        materialKey: child.materialKey,
      });
    } else {
      next = new ICENode({
        id,
        displayName: child.displayName,
        ...(json.metadata ? { metadata: json.metadata } : {}),
        ...(typeof json.selectionId === 'string'
          ? { selectionId: copyId(copy, json.selectionId) }
          : {}),
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
      });
    }
    next.visible = json.visible;
    target.addChild(next);
    copyChildren(child, next, copy);
  }
}
