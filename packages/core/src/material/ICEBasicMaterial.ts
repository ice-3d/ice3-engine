/**
 * Base-colour texture reference.
 *
 * `url` points at an image the renderer loads asynchronously; `scale` tiles it
 * over the metre-based UV projection (`[1,1]` means one texture repeat per metre).
 */
export interface ICEBasicMaterialMap {
  readonly url: string;
  readonly scale?: readonly [number, number];
}

export interface ICEBasicMaterialOptions {
  readonly color: string;
  readonly edgeColor?: string;
  readonly shading?: 'directional' | 'flat' | 'water';
  readonly map?: ICEBasicMaterialMap;
}

export class ICEBasicMaterial {
  readonly typeId = 'ice3:BasicMaterial';
  readonly color: string;
  readonly edgeColor: string | undefined;
  readonly shading: 'directional' | 'flat' | 'water' | undefined;
  readonly map: ICEBasicMaterialMap | undefined;

  constructor(options: ICEBasicMaterialOptions) {
    this.color = options.color;
    this.edgeColor = options.edgeColor;
    this.shading = options.shading;
    this.map = options.map;
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      color: this.color,
      ...(this.edgeColor ? { edgeColor: this.edgeColor } : {}),
      ...(this.shading ? { shading: this.shading } : {}),
      ...(this.map ? { map: this.map } : {}),
    };
  }
}
