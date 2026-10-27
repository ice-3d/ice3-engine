import { ICEMesh, type ICENode, type ICEScene } from '@ice3/core';

export interface ICEGeometryRenderable {
  readonly id: string;
  readonly mesh: ICEMesh;
  readonly worldMatrix: Float32Array;
}

const visit = (
  node: ICENode,
  parentVisible: boolean,
  output: ICEGeometryRenderable[],
): void => {
  const visible = parentVisible && node.visible;
  if (visible && node instanceof ICEMesh) {
    output.push({
      id: node.id,
      mesh: node,
      worldMatrix: node.updateWorldMatrix().elements.slice(),
    });
  }
  for (const child of node.children) {
    visit(child, visible, output);
  }
};

export function collectRenderables(
  scene: ICEScene,
): readonly ICEGeometryRenderable[] {
  const output: ICEGeometryRenderable[] = [];
  visit(scene, true, output);
  return output;
}

export const selectionIdentity = (mesh: ICEMesh): string => mesh.selectionId;
