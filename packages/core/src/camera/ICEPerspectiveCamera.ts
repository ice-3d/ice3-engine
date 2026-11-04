import { ICEMatrix4 } from '../math/ICEMatrix4.js';
import { ICEVector3, type ICEVector3Tuple } from '../math/ICEVector3.js';

export interface ICEPerspectiveCameraOptions {
  readonly id: string;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly position: ICEVector3Tuple;
  readonly target?: ICEVector3Tuple;
}

export class ICEPerspectiveCamera {
  readonly id: string;
  readonly fov: number;
  near: number;
  far: number;

  private eye: ICEVector3;
  private lookTarget: ICEVector3;

  constructor(options: ICEPerspectiveCameraOptions) {
    if (options.near <= 0 || options.far <= options.near) {
      throw new RangeError('Camera near/far values are invalid');
    }
    this.id = options.id;
    this.fov = options.fov;
    this.near = options.near;
    this.far = options.far;
    this.eye = new ICEVector3(...options.position);
    this.lookTarget = new ICEVector3(...(options.target ?? [0, 0, 0]));
  }

  setPosition(position: ICEVector3Tuple): this {
    this.eye = new ICEVector3(...position);
    return this;
  }

  setTarget(target: ICEVector3Tuple): this {
    this.lookTarget = new ICEVector3(...target);
    return this;
  }

  setClipPlanes(near: number, far: number): this {
    if (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0 || far <= near) {
      throw new RangeError('Camera near/far values are invalid');
    }
    this.near = near;
    this.far = far;
    return this;
  }

  getPosition(): ICEVector3 {
    return this.eye;
  }

  getTarget(): ICEVector3 {
    return this.lookTarget;
  }

  /**
   * 投影矩阵。屏幕空间效果要从深度重建视空间坐标，光有 viewProjection 不够。
   */
  getProjectionMatrix(aspect: number): ICEMatrix4 {
    return new ICEMatrix4().perspective(this.fov, aspect, this.near, this.far);
  }

  getViewMatrix(): ICEMatrix4 {
    return new ICEMatrix4().lookAt(
      this.eye,
      this.lookTarget,
      new ICEVector3(0, 1, 0),
    );
  }

  getViewProjectionMatrix(aspect: number): ICEMatrix4 {
    return this.getProjectionMatrix(aspect).multiply(this.getViewMatrix());
  }
}
