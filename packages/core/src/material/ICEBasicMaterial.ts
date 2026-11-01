export interface ICEBasicMaterialOptions {
  readonly color: string;
  readonly edgeColor?: string;
  readonly shading?: 'directional' | 'flat';
}

export class ICEBasicMaterial {
  readonly typeId = 'ice3:BasicMaterial';
  readonly color: string;
  readonly edgeColor: string | undefined;
  readonly shading: 'directional' | 'flat' | undefined;

  constructor(options: ICEBasicMaterialOptions) {
    this.color = options.color;
    this.edgeColor = options.edgeColor;
    this.shading = options.shading;
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      color: this.color,
      ...(this.edgeColor ? { edgeColor: this.edgeColor } : {}),
      ...(this.shading ? { shading: this.shading } : {}),
    };
  }
}
