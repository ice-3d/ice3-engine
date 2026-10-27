import { ICEMesh, type ICENode, type ICEScene } from '@ice3/core';

export interface ICEBoxRenderable {
  readonly id: string;
  readonly mesh: ICEMesh;
  readonly worldMatrix: Float32Array;
}

const visit = (
  node: ICENode,
  parentVisible: boolean,
  output: ICEBoxRenderable[],
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

export function collectRenderables(scene: ICEScene): readonly ICEBoxRenderable[] {
  const output: ICEBoxRenderable[] = [];
  visit(scene, true, output);
  return output;
}

export const BOX_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.5,
  0.5, -0.5, 0.5,
  0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5,
  0.5, -0.5, -0.5,
  0.5, 0.5, -0.5,
  -0.5, 0.5, -0.5,
]);

export const BOX_NORMALS = new Float32Array([
  -0.577, -0.577, 0.577,
  0.577, -0.577, 0.577,
  0.577, 0.577, 0.577,
  -0.577, 0.577, 0.577,
  -0.577, -0.577, -0.577,
  0.577, -0.577, -0.577,
  0.577, 0.577, -0.577,
  -0.577, 0.577, -0.577,
]);

export const BOX_INDICES = new Uint16Array([
  0, 1, 2, 0, 2, 3,
  5, 4, 7, 5, 7, 6,
  4, 0, 3, 4, 3, 7,
  1, 5, 6, 1, 6, 2,
  3, 2, 6, 3, 6, 7,
  4, 5, 1, 4, 1, 0,
]);

export function colorToRgba(color: string): [number, number, number, number] {
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Unsupported ICE basic material color: ${color}`);
  }
  return [
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
    1,
  ];
}
