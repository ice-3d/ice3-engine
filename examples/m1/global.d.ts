import type {
  ICEAssetHandle,
  ICEEngineDiagnostics,
  ICEProjectedPoint,
} from 'ice3';

declare global {
  interface Window {
    __ice3M1: {
      diagnostics(): Readonly<ICEEngineDiagnostics>;
      projection(): ICEProjectedPoint;
      assetCenter(): ICEProjectedPoint;
      scenePixelAtProjection(): readonly [number, number, number, number];
      selectedIds(): readonly string[];
      disposeAsset(): void;
      assetStats(): ICEAssetHandle['stats'];
    };
  }
}

export {};
