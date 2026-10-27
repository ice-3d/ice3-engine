import type { ICEGeometry } from '../geometry/ICEGeometry.js';
import { ICEBoxGeometry as BoxGeometry } from '../geometry/ICEBoxGeometry.js';
import type { ICEBasicMaterial } from '../material/ICEBasicMaterial.js';
import { ICEBasicMaterial as BasicMaterial } from '../material/ICEBasicMaterial.js';
import { ICENode, type ICENodeOptions, type ICESerializedNode } from './ICENode.js';

export interface ICEMeshOptions extends ICENodeOptions {
  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
}

export class ICEMesh extends ICENode {
  static readonly typeId = 'ice3:Mesh';

  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  override readonly selectionId: string;

  constructor(options: ICEMeshOptions) {
    super(options);
    this.geometry = options.geometry;
    this.material = options.material;
    this.selectionId = options.selectionId?.trim() || options.id;
  }

  override get typeId(): string {
    return ICEMesh.typeId;
  }

  override toJSON(): ICESerializedNode {
    return {
      ...super.toJSON(),
      selectionId: this.selectionId,
      geometry: this.geometry.toJSON(),
      material: this.material.toJSON(),
    };
  }

  static fromJSON(value: ICESerializedNode): ICEMesh {
    const geometry = value.geometry as Record<string, unknown>;
    const material = value.material as Record<string, unknown>;
    return new ICEMesh({
      id: value.id,
      displayName: typeof value.displayName === 'string'
        ? value.displayName
        : value.id,
      selectionId: typeof value.selectionId === 'string'
        ? value.selectionId
        : value.id,
      position: value.position,
      rotation: value.rotation,
      scale: value.scale,
      ...(value.matrix ? { matrix: value.matrix } : {}),
      geometry: new BoxGeometry({
        width: Number(geometry.width),
        height: Number(geometry.height),
        depth: Number(geometry.depth),
      }),
      material: new BasicMaterial({
        color: String(material.color),
        ...(typeof material.edgeColor === 'string'
          ? { edgeColor: material.edgeColor }
          : {}),
      }),
    });
  }
}
