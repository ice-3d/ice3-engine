import type { ICEEvent } from '@ice3/core';
import { ICEPerspectiveCamera } from '@ice3/core';
import type { ICE3 } from '../ICE3';
import type { ICEInputEvent, ICEInputTarget } from './ICEInputRouter';

type DispatchEvent = ICEEvent<{
  readonly target: ICEInputTarget;
  readonly event: ICEInputEvent;
}>;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class ICEOrbitController {
  private readonly target: readonly [number, number, number];
  private yaw: number;
  private pitch: number;
  private distance: number;
  private draggingPointer: number | null = null;
  private lastPoint: readonly [number, number] = [0, 0];
  private started = false;
  private disposed = false;
  private readonly onPointerDown = (event: DispatchEvent): void => {
    const { target, event: input } = event.param ?? {};
    if (!input || input.pointerId === undefined) {
      return;
    }
    if (target?.kind === 'scene' && !target.nodeId) {
      this.draggingPointer = input.pointerId;
      this.lastPoint = [input.point.x, input.point.y];
    }
  };
  private readonly onPointerMove = (event: DispatchEvent): void => {
    const input = event.param?.event;
    if (!input || input.pointerId !== this.draggingPointer) {
      return;
    }
    this.rotateBy(
      input.point.x - this.lastPoint[0],
      input.point.y - this.lastPoint[1],
    );
    this.lastPoint = [input.point.x, input.point.y];
  };
  private readonly onPointerUp = (event: DispatchEvent): void => {
    if (event.param?.event.pointerId === this.draggingPointer) {
      this.draggingPointer = null;
    }
  };
  private readonly onWheel = (event: DispatchEvent): void => {
    const param = event.param;
    if (param?.target.kind === 'scene' && param.event.deltaY !== undefined) {
      this.zoomBy(param.event.deltaY);
    }
  };

  constructor(
    private readonly engine: ICE3,
    private readonly camera: ICEPerspectiveCamera,
  ) {
    const target = camera.getTarget();
    const eye = camera.getPosition();
    const offsetX = eye.x - target.x;
    const offsetY = eye.y - target.y;
    const offsetZ = eye.z - target.z;
    this.target = target.toArray();
    this.distance = Math.max(0.2, Math.hypot(offsetX, offsetY, offsetZ));
    this.yaw = Math.atan2(offsetX, offsetZ);
    this.pitch = Math.asin(clamp(offsetY / this.distance, -1, 1));
  }

  rotateBy(deltaX: number, deltaY: number): this {
    this.assertActive();
    this.yaw -= deltaX * 0.005;
    this.pitch = clamp(this.pitch + deltaY * 0.005, -1.45, 1.45);
    this.applyPosition();
    return this;
  }

  zoomBy(delta: number): this {
    this.assertActive();
    this.distance = clamp(this.distance * Math.exp(delta * 0.001), 0.2, 100);
    this.applyPosition();
    return this;
  }

  start(): this {
    this.assertActive();
    if (this.started) {
      return this;
    }
    this.engine
      .on('POINTER_DOWN', this.onPointerDown)
      .on('POINTER_MOVE', this.onPointerMove)
      .on('POINTER_UP', this.onPointerUp)
      .on('POINTER_CANCEL', this.onPointerUp)
      .on('WHEEL', this.onWheel);
    this.started = true;
    return this;
  }

  stop(): this {
    if (!this.started) {
      return this;
    }
    this.engine
      .off('POINTER_DOWN', this.onPointerDown)
      .off('POINTER_MOVE', this.onPointerMove)
      .off('POINTER_UP', this.onPointerUp)
      .off('POINTER_CANCEL', this.onPointerUp)
      .off('WHEEL', this.onWheel);
    this.started = false;
    this.draggingPointer = null;
    return this;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private applyPosition(): void {
    const horizontal = Math.cos(this.pitch) * this.distance;
    const [targetX, targetY, targetZ] = this.target;
    this.camera.setPosition([
      targetX + Math.sin(this.yaw) * horizontal,
      targetY + Math.sin(this.pitch) * this.distance,
      targetZ + Math.cos(this.yaw) * horizontal,
    ]);
    this.engine.requestRender('camera-control');
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('ICE orbit controller is disposed');
    }
  }
}
