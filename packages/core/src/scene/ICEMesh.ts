import type { ICEBoxGeometry } from '../geometry/ICEBoxGeometry';
import { ICEBoxGeometry as BoxGeometry } from '../geometry/ICEBoxGeometry';
import type { ICEBasicMaterial } from '../material/ICEBasicMaterial';
import { ICEBasicMaterial as BasicMaterial } from '../material/ICEBasicMaterial';
import { ICENode, type ICENodeOptions, type ICESerializedNode } from './ICENode';

export interface ICEMeshOptions extends ICENodeOptions {
  readonly geometry: ICEBoxGeometry;
  readonly material: ICEBasicMaterial;
}

export class ICEMesh extends ICENode {
  static readonly typeId = 'ice3:Mesh';

  readonly geometry: ICEBoxGeometry;
  readonly material: ICEBasicMaterial;

  constructor(options: ICEMeshOptions) {
    super(options);
    this.geometry = options.geometry;
    this.material = options.material;
  }

  override get typeId(): string {
    return ICEMesh.typeId;
  }

  override toJSON(): ICESerializedNode {
    return {
      ...super.toJSON(),
      geometry: this.geometry.toJSON(),
      material: this.material.toJSON(),
    };
  }

  static fromJSON(value: ICESerializedNode): ICEMesh {
    const geometry = value.geometry as Record<string, unknown>;
    const material = value.material as Record<string, unknown>;
    return new ICEMesh({
      id: value.id,
      position: value.position,
      rotation: value.rotation,
      scale: value.scale,
      geometry: new BoxGeometry({
        width: Number(geometry.width),
        height: Number(geometry.height),
        depth: Number(geometry.depth),
      }),
      material: new BasicMaterial({ color: String(material.color) }),
    });
  }
}
