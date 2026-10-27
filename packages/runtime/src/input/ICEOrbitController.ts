import type { ICEEvent } from '@ice3/core';
import { ICEPerspectiveCamera } from '@ice3/core';
import type { ICE3 } from '../ICE3.js';
import type {
  ICEInputEvent,
  ICEInputTarget,
  ICEKeyboardInputEvent,
} from './ICEInputRouter.js';

type DispatchEvent = ICEEvent<{
  readonly target: ICEInputTarget;
  readonly event: ICEInputEvent | ICEKeyboardInputEvent;
}>;

const isKeyboardInput = (
  input: ICEInputEvent | ICEKeyboardInputEvent,
): input is ICEKeyboardInputEvent => (
  input.type === 'keydown' || input.type === 'keyup'
);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const MOTION_TIME_CONSTANT_MS = 55;
const MAX_FRAME_DELTA_MS = 64;
const SETTLE_EPSILON = 1e-5;
const WHEEL_LINE_HEIGHT_PX = 16;
const MAX_WHEEL_STEP_PX = 240;
const MOVE_SPEED_PER_DISTANCE = 0.75;

const NAVIGATION_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
]);

export class ICEOrbitController {
  private target: [number, number, number];
  private yaw: number;
  private pitch: number;
  private distance: number;
  private targetYaw: number;
  private targetPitch: number;
  private targetDistance: number;
  private lastMotionAt = performance.now();
  private draggingPointer: number | null = null;
  private lastPoint: readonly [number, number] = [0, 0];
  private readonly activePointers = new Map<
    number,
    Readonly<{ x: number; y: number }>
  >();
  private pinchDistance: number | null = null;
  private readonly pressedKeys = new Set<string>();
  private started = false;
  private disposed = false;
  private readonly onPointerDown = (event: DispatchEvent): void => {
    const { target, event: input } = event.param ?? {};
    if (!input || isKeyboardInput(input) || input.pointerId === undefined) {
      return;
    }
    if (target?.kind === 'scene') {
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
    if (!input || isKeyboardInput(input) || input.pointerId === undefined) {
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
    const input = event.param?.event;
    const pointerId = input && !isKeyboardInput(input)
      ? input.pointerId
      : undefined;
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
    if (
      param?.target.kind === 'scene'
      && !isKeyboardInput(param.event)
      && param.event.deltaY !== undefined
    ) {
      const deltaMode = param.event.deltaMode ?? 0;
      const scale = deltaMode === 1
        ? WHEEL_LINE_HEIGHT_PX
        : deltaMode === 2
          ? this.engine.getDiagnostics().viewport.height
          : 1;
      this.zoomBy(
        clamp(
          param.event.deltaY * Math.max(1, scale),
          -MAX_WHEEL_STEP_PX,
          MAX_WHEEL_STEP_PX,
        ),
      );
    }
  };
  private readonly onKeyDown = (event: DispatchEvent): void => {
    const input = event.param?.event;
    if (
      !input
      || input.type !== 'keydown'
      || !NAVIGATION_KEYS.has(input.code)
    ) {
      return;
    }
    this.prepareMotion();
    this.pressedKeys.add(input.code);
    this.engine.requestRender('camera-keyboard-movement');
  };
  private readonly onKeyUp = (event: DispatchEvent): void => {
    const input = event.param?.event;
    if (input?.type === 'keyup') {
      this.pressedKeys.delete(input.code);
    }
  };
  private readonly onKeyCancel = (): void => {
    this.pressedKeys.clear();
  };
  private readonly onBeforeRender = (): void => {
    const moving = this.pressedKeys.size > 0;
    if (this.motionSettled() && !moving) {
      return;
    }
    const now = performance.now();
    const deltaMs = clamp(now - this.lastMotionAt, 0, MAX_FRAME_DELTA_MS);
    this.lastMotionAt = now;
    const alpha = 1 - Math.exp(-deltaMs / MOTION_TIME_CONSTANT_MS);
    this.yaw += (this.targetYaw - this.yaw) * alpha;
    this.pitch += (this.targetPitch - this.pitch) * alpha;
    this.distance = Math.exp(
      Math.log(this.distance)
        + (Math.log(this.targetDistance) - Math.log(this.distance)) * alpha,
    );
    if (this.motionSettled()) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
      this.distance = this.targetDistance;
    }
    this.applyKeyboardMovement(deltaMs);
    this.applyPosition();
    if (!this.motionSettled() || this.pressedKeys.size > 0) {
      this.engine.requestRender('orbit-smoothing');
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
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetDistance = this.distance;
  }

  rotateBy(deltaX: number, deltaY: number): this {
    this.assertActive();
    this.prepareMotion();
    this.targetYaw -= deltaX * 0.005;
    this.targetPitch = clamp(
      this.targetPitch + deltaY * 0.005,
      -1.45,
      1.45,
    );
    this.engine.requestRender('camera-rotation');
    return this;
  }

  zoomBy(delta: number): this {
    this.assertActive();
    this.prepareMotion();
    this.targetDistance = clamp(
      this.targetDistance * Math.exp(delta * 0.001),
      0.2,
      100,
    );
    this.engine.requestRender('camera-zoom');
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
      .on('WHEEL', this.onWheel)
      .on('KEY_DOWN', this.onKeyDown)
      .on('KEY_UP', this.onKeyUp)
      .on('KEY_CANCEL', this.onKeyCancel)
      .on('BEFORE_RENDER', this.onBeforeRender);
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
      .off('WHEEL', this.onWheel)
      .off('KEY_DOWN', this.onKeyDown)
      .off('KEY_UP', this.onKeyUp)
      .off('KEY_CANCEL', this.onKeyCancel)
      .off('BEFORE_RENDER', this.onBeforeRender);
    this.started = false;
    this.draggingPointer = null;
    this.activePointers.clear();
    this.pinchDistance = null;
    this.pressedKeys.clear();
    return this;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private applyPosition(): void {
    const horizontal = Math.cos(this.pitch) * this.distance;
    const [targetX, targetY, targetZ] = this.target;
    this.camera.setTarget(this.target);
    this.camera.setPosition([
      targetX + Math.sin(this.yaw) * horizontal,
      targetY + Math.sin(this.pitch) * this.distance,
      targetZ + Math.cos(this.yaw) * horizontal,
    ]);
  }

  private applyKeyboardMovement(deltaMs: number): void {
    const forward = (
      Number(this.pressedKeys.has('KeyW'))
      - Number(this.pressedKeys.has('KeyS'))
    );
    const right = (
      Number(this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight'))
      - Number(this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft'))
    );
    const up = (
      Number(this.pressedKeys.has('ArrowUp'))
      - Number(this.pressedKeys.has('ArrowDown'))
    );
    const magnitude = Math.hypot(forward, right, up);
    if (magnitude === 0) {
      return;
    }
    const distance = this.distance * MOVE_SPEED_PER_DISTANCE
      * (deltaMs / 1000)
      / magnitude;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const sinPitch = Math.sin(this.pitch);
    const cosPitch = Math.cos(this.pitch);
    this.target[0] += distance * (
      -sinYaw * forward
      + cosYaw * right
      - sinYaw * sinPitch * up
    );
    this.target[1] += distance * cosPitch * up;
    this.target[2] += distance * (
      -cosYaw * forward
      - sinYaw * right
      - cosYaw * sinPitch * up
    );
  }

  private prepareMotion(): void {
    if (this.motionSettled()) {
      this.lastMotionAt = performance.now();
    }
  }

  private motionSettled(): boolean {
    return (
      Math.abs(this.targetYaw - this.yaw) <= SETTLE_EPSILON
      && Math.abs(this.targetPitch - this.pitch) <= SETTLE_EPSILON
      && Math.abs(Math.log(this.targetDistance / this.distance))
        <= SETTLE_EPSILON
    );
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
