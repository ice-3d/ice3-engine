import type { ICEViewport } from '@ice3/renderer';
import type { ICE2DLayer } from './ICE2DLayer';

export class ICE2DCanvasPainter {
  paint(
    canvas: HTMLCanvasElement,
    layers: readonly ICE2DLayer[],
    viewport: ICEViewport,
    dpr: number,
  ): void {
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const width = Math.max(1, Math.round(viewport.width * dpr));
    const height = Math.max(1, Math.round(viewport.height * dpr));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    const ordered = [...layers].sort((left, right) => left.order - right.order);
    for (const layer of ordered) {
      layer.paint(context, viewport);
    }
  }
}
