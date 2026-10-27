import { ICEEventDispatcher } from '@ice3/core';

export interface ICELabelOptions {
  readonly id: string;
  readonly text: string;
  readonly anchorId?: string;
  readonly screenPosition?: readonly [number, number];
  readonly color?: string;
  readonly background?: string;
  readonly padding?: number;
  readonly interactive?: boolean;
}

export interface ICELabelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class ICELabel extends ICEEventDispatcher {
  readonly id: string;
  readonly anchorId: string | undefined;
  readonly color: string;
  readonly background: string;
  readonly padding: number;
  readonly interactive: boolean;
  visible = true;

  private currentText: string;
  private currentScreenPosition: readonly [number, number] | undefined;
  private rect: ICELabelRect;

  constructor(options: ICELabelOptions) {
    super();
    this.id = options.id;
    this.currentText = options.text;
    this.anchorId = options.anchorId;
    this.currentScreenPosition = options.screenPosition
      ? [options.screenPosition[0], options.screenPosition[1]]
      : undefined;
    this.color = options.color ?? '#f8fafc';
    this.background = options.background ?? 'rgba(9, 18, 34, 0.88)';
    this.padding = options.padding ?? 6;
    this.interactive = options.interactive ?? false;
    const width = Math.max(28, [...this.text].length * 14) + this.padding * 2;
    const height = 20 + this.padding * 2;
    const [x, y] = this.currentScreenPosition ?? [0, 0];
    this.rect = { x, y, width, height };
  }

  get text(): string {
    return this.currentText;
  }

  get screenPosition(): readonly [number, number] | undefined {
    return this.currentScreenPosition
      ? [this.currentScreenPosition[0], this.currentScreenPosition[1]]
      : undefined;
  }

  setText(text: string): this {
    this.currentText = text;
    this.visible = text.length > 0;
    const width = Math.max(28, [...text].length * 14) + this.padding * 2;
    const height = 20 + this.padding * 2;
    this.rect = { ...this.rect, width, height };
    return this;
  }

  setScreenPosition(position: readonly [number, number]): this {
    this.currentScreenPosition = [position[0], position[1]];
    const width = this.rect.width;
    const height = this.rect.height;
    this.rect = { x: position[0], y: position[1], width, height };
    return this;
  }

  setWorldAnchor(position: readonly [number, number], visible = true): this {
    this.visible = visible;
    const width = this.rect.width;
    const height = this.rect.height;
    this.rect = {
      x: position[0] - width / 2,
      y: position[1] - height / 2,
      width,
      height,
    };
    return this;
  }

  measure(context: CanvasRenderingContext2D): ICELabelRect {
    const width = Math.max(28, context.measureText(this.text).width)
      + this.padding * 2;
    const height = 20 + this.padding * 2;
    if (this.currentScreenPosition) {
      this.rect = {
        x: this.currentScreenPosition[0],
        y: this.currentScreenPosition[1],
        width,
        height,
      };
    } else {
      const centerX = this.rect.x + this.rect.width / 2;
      const centerY = this.rect.y + this.rect.height / 2;
      this.rect = {
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
      };
    }
    return this.getRect();
  }

  getRect(): ICELabelRect {
    return { ...this.rect };
  }

  containsPoint(point: { readonly x: number; readonly y: number }): boolean {
    return (
      this.visible
      && point.x >= this.rect.x
      && point.x <= this.rect.x + this.rect.width
      && point.y >= this.rect.y
      && point.y <= this.rect.y + this.rect.height
    );
  }
}
