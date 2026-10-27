export interface ICEBasicMaterialOptions {
  readonly color: string;
}

export class ICEBasicMaterial {
  readonly typeId = 'ice3:BasicMaterial';
  readonly color: string;

  constructor(options: ICEBasicMaterialOptions) {
    this.color = options.color;
  }

  toJSON(): Record<string, unknown> {
    return { typeId: this.typeId, color: this.color };
  }
}
