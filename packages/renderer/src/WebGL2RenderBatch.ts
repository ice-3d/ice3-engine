import type {
  ICEBasicMaterial,
  ICEGeometry,
  ICENode,
  ICEScene,
} from '@ice3/core';

export interface ICERenderBatchNode extends ICENode {
  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  readonly semanticIds: readonly string[];
  readonly semanticNodeIds: readonly string[];
  readonly semanticSelectionIds: readonly string[];
  readonly materialKey: string;
}

export interface ICERenderBatchDraw {
  readonly id: string;
  readonly batch: ICERenderBatchNode;
  readonly worldMatrix: Float32Array;
}

export function collectRenderBatches(
  scene: ICEScene,
  output: ICERenderBatchDraw[] = [],
): readonly ICERenderBatchDraw[] {
  output.length = 0;
  const visit = (node: ICENode, parentVisible: boolean): void => {
    const visible = parentVisible && node.visible;
    if (visible && isRenderBatch(node)) {
      output.push({
        id: node.id,
        batch: node,
        worldMatrix: node.updateWorldMatrix().elements,
      });
    }
    for (const child of node.children) visit(child, visible);
  };
  visit(scene, true);
  output.sort((left, right) => (
    left.batch.materialKey.localeCompare(right.batch.materialKey, 'en')
    || left.id.localeCompare(right.id, 'en')
  ));
  return output;
}

function isRenderBatch(node: ICENode): node is ICERenderBatchNode {
  if (node.typeId !== 'ice3:RenderBatch') return false;
  const candidate = node as unknown as Partial<ICERenderBatchNode>;
  return Boolean(
    candidate.geometry
    && candidate.material
    && candidate.semanticIds
    && candidate.semanticNodeIds
    && candidate.semanticSelectionIds
    && typeof candidate.materialKey === 'string',
  );
}
