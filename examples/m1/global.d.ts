import type {
  ICEEngineDiagnostics,
  ICEProjectedPoint,
  ICETilesetStats,
} from 'ice3';

declare global {
  interface Window {
    __ice3M1: {
      diagnostics(): Readonly<ICEEngineDiagnostics>;
      projection(): ICEProjectedPoint;
      assetCenter(): ICEProjectedPoint;
      cameraPosition(): readonly [number, number, number];
      cameraTarget(): readonly [number, number, number];
      scenePixelAtProjection(): readonly [number, number, number, number];
      selectedIds(): readonly string[];
      disposeAsset(): void;
      assetStats(): {
        nodeCount: number;
        maxNodeDepth: number;
        meshCount: number;
        primitiveCount: number;
        triangleCount: number;
        edgeSegmentCount: number;
        materialCount: number;
        selectionGroupCount: number;
      };
      tilesetStats(): ICETilesetStats;
    };
  }
}

export {};
