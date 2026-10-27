import { ICEEventDispatcher } from '@ice3/core';
import type { ICEViewport } from '@ice3/renderer';
import { ICELabel } from './ICELabel';

export interface ICE2DLayerOptions {
  readonly id: string;
  readonly order?: number;
  readonly visible?: boolean;
  readonly interactive?: boolean;
  readonly passThrough?: boolean;
}

export class ICE2DLayer extends ICEEventDispatcher {
  readonly id: string;
  readonly order: number;
  visible: boolean;
  interactive: boolean;
  passThrough: boolean;
  protected readonly labels: ICELabel[] = [];

  constructor(options: ICE2DLayerOptions) {
    super();
    this.id = options.id;
    this.order = options.order ?? 0;
    this.visible = options.visible ?? true;
    this.interactive = options.interactive ?? true;
    this.passThrough = options.passThrough ?? true;
  }

  addChild(child: ICELabel): this {
    if (this.labels.some((label) => label.id === child.id)) {
      throw new Error(`Duplicate ICE label ID: ${child.id}`);
    }
    this.labels.push(child);
    return this;
  }

  removeChild(child: ICELabel): this {
    const index = this.labels.indexOf(child);
    if (index >= 0) {
      this.labels.splice(index, 1);
    }
    return this;
  }

  hitTest(point: { readonly x: number; readonly y: number }): ICELabel | undefined {
    if (!this.visible || !this.interactive) {
      return undefined;
    }
    for (let index = this.labels.length - 1; index >= 0; index -= 1) {
      const label = this.labels[index]!;
      if (label.interactive && label.containsPoint(point)) {
        return label;
      }
    }
    return undefined;
  }

  getLabels(): readonly ICELabel[] {
    return this.labels;
  }

  paint(context: CanvasRenderingContext2D, _viewport: ICEViewport): void {
    if (!this.visible) {
      return;
    }
    context.save();
    context.font = '14px sans-serif';
    context.textBaseline = 'top';
    for (const label of this.labels) {
      if (!label.visible) {
        continue;
      }
      const rect = label.measure(context);
      context.fillStyle = label.background;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.fillStyle = label.color;
      context.fillText(label.text, rect.x + label.padding, rect.y + label.padding);
    }
    context.restore();
  }

  dispose(): void {
    this.labels.length = 0;
    this.removeAllListeners();
  }
}
