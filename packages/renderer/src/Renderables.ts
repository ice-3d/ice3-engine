import { ICEMesh, type ICENode, type ICEScene } from '@ice3/core';

export interface ICEGeometryRenderable {
  readonly id: string;
  readonly mesh: ICEMesh;
  readonly worldMatrix: Float32Array;
  /** 0..1, read from the mesh each frame so a fade needs no re-collection. */
  readonly opacity: number;
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
      worldMatrix: node.updateWorldMatrix().elements,
      opacity: node.opacity,
    });
  }
  for (const child of node.children) {
    visit(child, visible, output);
  }
};

export function collectRenderables(
  scene: ICEScene,
  output: ICEGeometryRenderable[] = [],
): readonly ICEGeometryRenderable[] {
  output.length = 0;
  visit(scene, true, output);
  return output;
}

export const selectionIdentity = (mesh: ICEMesh): string => mesh.selectionId;
