import {
  ICENode,
  type ICEBasicMaterial,
  type ICEIndexedGeometry,
  type ICENodeOptions,
} from '@ice3/core';

export interface ICERenderBatchOptions extends ICENodeOptions {
  readonly geometry: ICEIndexedGeometry;
  readonly material: ICEBasicMaterial;
  readonly semanticIds: readonly string[];
  readonly semanticNodeIds: readonly string[];
  readonly semanticSelectionIds: readonly string[];
  readonly materialKey: string;
}

export class ICERenderBatch extends ICENode {
  static readonly typeId = 'ice3:RenderBatch';

  readonly geometry: ICEIndexedGeometry;
  readonly material: ICEBasicMaterial;
  readonly semanticIds: readonly string[];
  readonly semanticNodeIds: readonly string[];
  readonly semanticSelectionIds: readonly string[];
  readonly materialKey: string;

  constructor(options: ICERenderBatchOptions) {
    const { selectionId: _selectionId, ...nodeOptions } = options;
    super(nodeOptions);
    this.geometry = options.geometry;
    this.material = options.material;
    this.semanticIds = Object.freeze([...options.semanticIds]);
    this.semanticNodeIds = Object.freeze([...options.semanticNodeIds]);
    this.semanticSelectionIds = Object.freeze(
      [...options.semanticSelectionIds],
    );
    this.materialKey = options.materialKey;
  }

  override get typeId(): string {
    return ICERenderBatch.typeId;
  }
}
