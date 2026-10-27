export type ICEInputTarget =
  | { readonly kind: 'layer'; readonly layerId: string; readonly labelId: string }
  | { readonly kind: 'scene'; readonly nodeId?: string };

export type ICEInputEvent = {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'wheel';
  readonly point: Readonly<{ x: number; y: number }>;
  readonly pointerId?: number;
  readonly deltaY?: number;
  readonly deltaMode?: number;
};

export type ICEKeyboardInputEvent = {
  readonly type: 'keydown' | 'keyup';
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;
};

export interface ICEInputRouterOptions {
  readonly hitTestLayer: (point: { x: number; y: number }) => ICEInputTarget | undefined;
  readonly pickScene: (point: { x: number; y: number }) => ICEInputTarget | undefined;
  readonly dispatch?: (target: ICEInputTarget, event: ICEInputEvent) => void;
}

export class ICEInputRouter {
  private readonly captured = new Map<number, ICEInputTarget>();

  constructor(private readonly options: ICEInputRouterOptions) {}

  route(point: { x: number; y: number }): ICEInputTarget | undefined {
    return this.options.hitTestLayer(point) ?? this.options.pickScene(point);
  }

  pointerDown(
    point: { x: number; y: number },
    pointerId: number,
  ): ICEInputTarget | undefined {
    const target = this.route(point);
    if (target) {
      this.captured.set(pointerId, target);
      this.options.dispatch?.(target, {
        type: 'pointerdown',
        point: { ...point },
        pointerId,
      });
    }
    return target;
  }

  pointerMove(
    point: { x: number; y: number },
    pointerId: number,
  ): ICEInputTarget | undefined {
    const target = this.captured.get(pointerId) ?? this.route(point);
    if (target) {
      this.options.dispatch?.(target, {
        type: 'pointermove',
        point: { ...point },
        pointerId,
      });
    }
    return target;
  }

  pointerUp(
    point: { x: number; y: number },
    pointerId: number,
  ): ICEInputTarget | undefined {
    const target = this.captured.get(pointerId) ?? this.route(point);
    if (target) {
      this.options.dispatch?.(target, {
        type: 'pointerup',
        point: { ...point },
        pointerId,
      });
    }
    this.captured.delete(pointerId);
    return target;
  }

  pointerCancel(pointerId: number): void {
    const target = this.captured.get(pointerId);
    if (target) {
      this.options.dispatch?.(target, {
        type: 'pointercancel',
        point: { x: 0, y: 0 },
        pointerId,
      });
    }
    this.captured.delete(pointerId);
  }

  wheel(
    deltaY: number,
    point: { x: number; y: number },
    deltaMode = 0,
  ): ICEInputTarget | undefined {
    const target = this.route(point);
    if (target) {
      this.options.dispatch?.(target, {
        type: 'wheel',
        point: { ...point },
        deltaY,
        deltaMode,
      });
    }
    return target;
  }
}
