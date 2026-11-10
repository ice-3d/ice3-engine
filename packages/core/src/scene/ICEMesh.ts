import type { ICEGeometry } from '../geometry/ICEGeometry.js';
import { ICEBoxGeometry as BoxGeometry } from '../geometry/ICEBoxGeometry.js';
import type { ICEBasicMaterial } from '../material/ICEBasicMaterial.js';
import { ICEBasicMaterial as BasicMaterial } from '../material/ICEBasicMaterial.js';
import { ICENode, type ICENodeOptions, type ICESerializedNode } from './ICENode.js';

export interface ICEMeshOptions extends ICENodeOptions {
  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  /** 0..1, default 1. Set at runtime to fade a mesh in or out. */
  readonly opacity?: number;
}

export class ICEMesh extends ICENode {
  static readonly typeId = 'ice3:Mesh';

  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  override readonly selectionId: string;
  /**
   * Per-mesh opacity, 0..1.
   *
   * It is a per-instance attribute rather than a material property on purpose:
   * a material is part of the batching key, so fading one mesh by giving it its
   * own material would take the whole batch with it and turn one draw call into
   * one per object. Changing this number costs nothing and affects only this mesh.
   */
  opacity: number;

  constructor(options: ICEMeshOptions) {
    super(options);
    this.geometry = options.geometry;
    this.material = options.material;
    this.selectionId = options.selectionId?.trim() || options.id;
    this.opacity = clampOpacity(options.opacity ?? 1);
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
    const shading = material.shading === 'directional'
      || material.shading === 'flat'
      || material.shading === 'water'
      ? material.shading
      : undefined;
    return new ICEMesh({
      id: value.id,
      displayName: typeof value.displayName === 'string'
        ? value.displayName
        : value.id,
      ...(value.metadata ? { metadata: value.metadata } : {}),
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
        ...(shading ? { shading } : {}),
      }),
    });
  }
}

const clampOpacity = (value: number): number => (
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
);
