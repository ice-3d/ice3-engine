import { ICEScene } from '@ice3/core';
import type { ICEProjectedPoint } from '../ICEProjection.js';
import { ICE2DLayer, type ICE2DLayerOptions } from './ICE2DLayer.js';

export type ICEAnchorProjector = (anchorId: string) => ICEProjectedPoint | undefined;

export class ICEWorldLayer extends ICE2DLayer {
  constructor(options: ICE2DLayerOptions) {
    super(options);
  }

  prepare(_scene: ICEScene, project: ICEAnchorProjector): void {
    for (const label of this.labels) {
      if (!label.anchorId) {
        label.visible = false;
        continue;
      }
      const anchor = project(label.anchorId);
      if (!anchor) {
        label.visible = false;
        continue;
      }
      label.setWorldAnchor([anchor.x, anchor.y], anchor.visible);
    }
  }
}
