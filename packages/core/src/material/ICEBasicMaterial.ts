export interface ICEBasicMaterialOptions {
  readonly color: string;
  readonly edgeColor?: string;
}

export class ICEBasicMaterial {
  readonly typeId = 'ice3:BasicMaterial';
  readonly color: string;
  readonly edgeColor: string | undefined;

  constructor(options: ICEBasicMaterialOptions) {
    this.color = options.color;
    this.edgeColor = options.edgeColor;
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      color: this.color,
      ...(this.edgeColor ? { edgeColor: this.edgeColor } : {}),
    };
  }
}
