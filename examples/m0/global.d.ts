import type { ICEEngineDiagnostics, ICEProjectedPoint } from 'ice3';

declare global {
  interface Window {
    __ice3M0: {
      diagnostics(): Readonly<ICEEngineDiagnostics>;
      projection(): ICEProjectedPoint;
      scenePixelAtProjection(): readonly [number, number, number, number];
      hudRect(): Readonly<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      getSelection(): readonly string[];
      measureWorldLabelOffset(): {
        screenX: number;
        screenY: number;
        labelX: number;
        labelY: number;
      };
      loseContext(): void;
      restoreContext(): void;
    };
  }
}

export {};
