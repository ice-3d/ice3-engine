import type { ICE2DLayer } from './ICE2DLayer.js';
import type { ICELabel } from './ICELabel.js';

export type ICELayerHit = {
  readonly layer: ICE2DLayer;
  readonly label: ICELabel;
};

export class ICE2DLayerRouter {
  constructor(private readonly getLayers: () => readonly ICE2DLayer[]) {}

  hitTest(point: { readonly x: number; readonly y: number }): ICELayerHit | undefined {
    const layers = this.topDown();
    for (const layer of layers) {
      const label = layer.hitTest(point);
      if (label) {
        return { layer, label };
      }
    }
    return undefined;
  }

  shouldPassThrough(point: { readonly x: number; readonly y: number }): boolean {
    for (const layer of this.topDown()) {
      if (!layer.visible) {
        continue;
      }
      if (layer.hitTest(point)) {
        return false;
      }
      if (!layer.passThrough) {
        return false;
      }
    }
    return true;
  }

  private topDown(): readonly ICE2DLayer[] {
    return this.getLayers()
      .map((layer, index) => ({ layer, index }))
      .sort((left, right) =>
        right.layer.order - left.layer.order || right.index - left.index,
      )
      .map((entry) => entry.layer);
  }
}
