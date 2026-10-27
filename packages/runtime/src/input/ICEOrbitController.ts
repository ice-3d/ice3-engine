import type { ICEEvent } from '@ice3/core';
import { ICEPerspectiveCamera } from '@ice3/core';
import type { ICE3 } from '../ICE3.js';
import type { ICEInputEvent, ICEInputTarget } from './ICEInputRouter.js';

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
  private readonly activePointers = new Map<
    number,
    Readonly<{ x: number; y: number }>
  >();
  private pinchDistance: number | null = null;
  private started = false;
  private disposed = false;
  private readonly onPointerDown = (event: DispatchEvent): void => {
    const { target, event: input } = event.param ?? {};
    if (!input || input.pointerId === undefined) {
      return;
    }
    if (target?.kind === 'scene' && !target.nodeId) {
      this.activePointers.set(input.pointerId, { ...input.point });
      if (this.activePointers.size === 1) {
        this.draggingPointer = input.pointerId;
        this.lastPoint = [input.point.x, input.point.y];
      } else {
        this.draggingPointer = null;
        this.pinchDistance = this.distanceBetweenPointers();
      }
    }
  };
  private readonly onPointerMove = (event: DispatchEvent): void => {
    const input = event.param?.event;
    if (!input || input.pointerId === undefined) {
      return;
    }
    if (this.activePointers.has(input.pointerId)) {
      this.activePointers.set(input.pointerId, { ...input.point });
    }
    if (this.activePointers.size >= 2) {
      const nextDistance = this.distanceBetweenPointers();
      if (this.pinchDistance !== null && nextDistance !== null) {
        this.zoomBy((this.pinchDistance - nextDistance) * 2);
      }
      this.pinchDistance = nextDistance;
      return;
    }
    if (input.pointerId !== this.draggingPointer) {
      return;
    }
    this.rotateBy(
      input.point.x - this.lastPoint[0],
      input.point.y - this.lastPoint[1],
    );
    this.lastPoint = [input.point.x, input.point.y];
  };
  private readonly onPointerUp = (event: DispatchEvent): void => {
    const pointerId = event.param?.event.pointerId;
    if (pointerId === undefined) {
      return;
    }
    this.activePointers.delete(pointerId);
    if (this.activePointers.size < 2) {
      this.pinchDistance = null;
    }
    if (this.activePointers.size === 1) {
      const [remainingId, point] = this.activePointers.entries().next().value as [
        number,
        Readonly<{ x: number; y: number }>,
      ];
      this.draggingPointer = remainingId;
      this.lastPoint = [point.x, point.y];
    } else if (this.activePointers.size === 0) {
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
    this.activePointers.clear();
    this.pinchDistance = null;
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

  private distanceBetweenPointers(): number | null {
    const points = [...this.activePointers.values()];
    const first = points[0];
    const second = points[1];
    return first && second
      ? Math.hypot(second.x - first.x, second.y - first.y)
      : null;
  }
}
