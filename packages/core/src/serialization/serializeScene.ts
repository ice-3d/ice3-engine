import type { ICEDiagnostic } from '../diagnostics/ICEDiagnostic.js';
import type { ICETypeRegistry } from '../types/ICETypeRegistry.js';
import { ICENode, type ICESerializedNode } from '../scene/ICENode.js';
import { ICEScene } from '../scene/ICEScene.js';

export interface ICESerializedScene {
  readonly schemaVersion: 1;
  readonly typeId: 'ice3:Scene';
  readonly scene: ICESerializedNode;
}

export interface ICEDeserializedScene {
  readonly scene: ICEScene;
  readonly report: Readonly<{ errors: readonly ICEDiagnostic[] }>;
}

export function serializeScene(scene: ICEScene): ICESerializedScene {
  return {
    schemaVersion: 1,
    typeId: 'ice3:Scene',
    scene: scene.toJSON(),
  };
}

export function deserializeScene(
  value: ICESerializedScene,
  registry: ICETypeRegistry,
): ICEDeserializedScene {
  const errors: ICEDiagnostic[] = [];
  const scene = new ICEScene({
    id: value.scene.id,
    ...(value.scene.displayName
      ? { displayName: value.scene.displayName }
      : {}),
    ...(value.scene.metadata ? { metadata: value.scene.metadata } : {}),
    position: value.scene.position,
    rotation: value.scene.rotation,
    scale: value.scene.scale,
  });
  scene.visible = value.scene.visible;

  const buildChildren = (source: ICESerializedNode, parent: ICENode, path: string) => {
    source.children.forEach((child, index) => {
      const type = registry.get(child.typeId);
      if (!type) {
        errors.push({
          severity: 'error',
          code: 'ICE3_UNKNOWN_TYPE',
          message: `Unknown ICE node type: ${child.typeId}`,
          path: `${path}.children[${index}]`,
        });
        return;
      }
      try {
        const node = type.fromJSON(child);
        parent.addChild(node);
        buildChildren(child, node, `${path}.children[${index}]`);
      } catch (error) {
        errors.push({
          severity: 'error',
          code: 'ICE3_INVALID_NODE_DATA',
          message: `Invalid ICE node data: ${
            error instanceof Error ? error.message : String(error)
          }`,
          path: `${path}.children[${index}]`,
        });
      }
    });
  };

  buildChildren(value.scene, scene, 'scene');
  return { scene, report: { errors } };
}
