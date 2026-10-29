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
      projectWorldPoint(
        point: readonly [number, number, number],
      ): ICEProjectedPoint;
      assetCenter(): ICEProjectedPoint;
      cameraPosition(): readonly [number, number, number];
      cameraTarget(): readonly [number, number, number];
      setCameraPose(
        position: readonly [number, number, number],
        target: readonly [number, number, number],
      ): void;
      showLodOverview(): void;
      focusLodBranch(): void;
      selectOverviewDevice(): void;
      equipmentSelectionIds(): readonly string[];
      equipmentMetadata(
        selectionId: string,
      ): Readonly<Record<string, unknown>> | undefined;
      whenLodIdle(): Promise<void>;
      visibleMeshCount(): number;
      scenePixelAtProjection(): Promise<
        readonly [number, number, number, number]
      >;
      scenePixelAt(
        x: number,
        y: number,
      ): Promise<readonly [number, number, number, number]>;
      yellowPixelCount(): Promise<number>;
      pickSelectionId(
        point: Readonly<{ x: number; y: number }>,
      ): Promise<string | undefined>;
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
      adaptiveStats(): {
        mode: 'asset' | 'adaptive' | 'off';
        activeGeneration: number;
        candidateGeneration?: number;
        adaptiveBatchCount: number;
      };
      tilesetStats(): ICETilesetStats;
    };
  }
}

export {};
