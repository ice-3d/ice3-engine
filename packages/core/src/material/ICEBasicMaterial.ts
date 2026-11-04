/**
 * Base-colour texture reference.
 *
 * `url` points at an image the renderer loads asynchronously; `scale` tiles it
 * over the metre-based UV projection (`[1,1]` means one texture repeat per metre).
 */
export const DEFAULT_ROUGHNESS = 0.85;

export interface ICEBasicMaterialMap {
  readonly url: string;
  readonly scale?: readonly [number, number];
}

/**
 * Tangent-space normal map.
 *
 * `strength` multiplies the sampled X/Y perturbation, matching glTF's
 * `normalTexture.scale`; 1 is neutral.
 */
export interface ICEBasicMaterialNormalMap {
  readonly url: string;
  readonly strength?: number;
}

export interface ICEBasicMaterialOptions {
  readonly color: string;
  readonly edgeColor?: string;
  readonly shading?: 'directional' | 'flat' | 'water';
  readonly map?: ICEBasicMaterialMap;
  readonly normalMap?: ICEBasicMaterialNormalMap;
  /** 0 = dielectric, 1 = metal. Drives the specular tint and strength. */
  readonly metallic?: number;
  /** 0 = mirror-smooth highlight, 1 = broad and dull. */
  readonly roughness?: number;
  /** Linear RGB emitted by the surface, added after lighting. */
  readonly emissive?: readonly [number, number, number];
}

export class ICEBasicMaterial {
  readonly typeId = 'ice3:BasicMaterial';
  readonly color: string;
  readonly edgeColor: string | undefined;
  readonly shading: 'directional' | 'flat' | 'water' | undefined;
  readonly map: ICEBasicMaterialMap | undefined;
  readonly normalMap: ICEBasicMaterialNormalMap | undefined;
  readonly metallic: number;
  readonly roughness: number;
  readonly emissive: readonly [number, number, number] | undefined;

  constructor(options: ICEBasicMaterialOptions) {
    this.color = options.color;
    this.edgeColor = options.edgeColor;
    this.shading = options.shading;
    this.map = options.map;
    this.normalMap = options.normalMap;
    this.metallic = options.metallic ?? 0;
    this.roughness = options.roughness ?? DEFAULT_ROUGHNESS;
    this.emissive = options.emissive;
  }

  toJSON(): Record<string, unknown> {
    return {
      typeId: this.typeId,
      color: this.color,
      ...(this.edgeColor ? { edgeColor: this.edgeColor } : {}),
      ...(this.shading ? { shading: this.shading } : {}),
      ...(this.map ? { map: this.map } : {}),
      ...(this.normalMap ? { normalMap: this.normalMap } : {}),
      ...(this.metallic !== 0 ? { metallic: this.metallic } : {}),
      ...(this.roughness !== DEFAULT_ROUGHNESS
        ? { roughness: this.roughness }
        : {}),
      ...(this.emissive ? { emissive: this.emissive } : {}),
    };
  }
}
