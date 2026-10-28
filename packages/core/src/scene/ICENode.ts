import { ICEEventDispatcher } from '../event/ICEEventDispatcher.js';
import { ICEEngineError } from '../diagnostics/ICEEngineError.js';
import { ICEMatrix4 } from '../math/ICEMatrix4.js';
import { ICEVector3, type ICEVector3Tuple } from '../math/ICEVector3.js';

export interface ICENodeOptions {
  readonly id: string;
  readonly displayName?: string;
  readonly selectionId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly position?: ICEVector3Tuple;
  readonly rotation?: ICEVector3Tuple;
  readonly scale?: ICEVector3Tuple;
  readonly matrix?: ICEMatrix4Tuple;
}

export type ICEMatrix4Tuple = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface ICESerializedNode {
  readonly id: string;
  readonly displayName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly typeId: string;
  readonly visible: boolean;
  readonly position: ICEVector3Tuple;
  readonly rotation: ICEVector3Tuple;
  readonly scale: ICEVector3Tuple;
  readonly matrix?: ICEMatrix4Tuple;
  readonly children: readonly ICESerializedNode[];
  readonly [key: string]: unknown;
}

const LOCAL_MATRIX = new ICEMatrix4();

export class ICENode extends ICEEventDispatcher {
  readonly id: string;
  readonly displayName: string;
  readonly selectionId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly position: ICEVector3;
  readonly rotation: ICEVector3;
  readonly scale: ICEVector3;
  visible = true;

  private _parent: ICENode | null = null;
  private readonly _children: ICENode[] = [];
  private readonly worldMatrix = new ICEMatrix4();
  private localMatrixOverride: Float32Array | null = null;

  constructor(options: ICENodeOptions) {
    super();
    if (!options.id.trim()) {
      throw new TypeError('ICE node ID must not be empty');
    }
    this.id = options.id;
    this.displayName = options.displayName?.trim() || options.id;
    const selectionId = options.selectionId?.trim();
    if (selectionId) this.selectionId = selectionId;
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      this.metadata = Object.freeze({ ...options.metadata });
    }
    this.position = new ICEVector3(...(options.position ?? [0, 0, 0]));
    this.rotation = new ICEVector3(...(options.rotation ?? [0, 0, 0]));
    this.scale = new ICEVector3(...(options.scale ?? [1, 1, 1]));
    if (options.matrix) {
      this.setLocalMatrix(options.matrix);
    }
  }

  get typeId(): string {
    return 'ice3:Node';
  }

  get parent(): ICENode | null {
    return this._parent;
  }

  get children(): readonly ICENode[] {
    return this._children;
  }

  addChild(node: ICENode): this {
    if (node === this || node.isAncestorOf(this)) {
      throw new ICEEngineError('ICE3_SCENE_CYCLE', 'ICE scene cycle is not allowed');
    }

    const root = this.getRoot();
    for (const id of collectIDs(node)) {
      const duplicate = root.findByID(id);
      if (duplicate && duplicate !== node.findByID(id)) {
        throw new ICEEngineError(
          'ICE3_DUPLICATE_OBJECT_ID',
          `Duplicate ICE node ID: ${id}`,
          { id },
        );
      }
    }

    if (node._parent) {
      node._parent.removeChild(node, { dispose: false });
    }
    node._parent = this;
    this._children.push(node);
    return this;
  }

  removeChild(node: ICENode, options?: { readonly dispose?: boolean }): this {
    const index = this._children.indexOf(node);
    if (index < 0) {
      return this;
    }
    this._children.splice(index, 1);
    node._parent = null;
    if (options?.dispose) {
      node.dispose();
    }
    return this;
  }

  findByID(id: string): ICENode | undefined {
    if (this.id === id) {
      return this;
    }
    for (const child of this._children) {
      const found = child.findByID(id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  updateWorldMatrix(parentMatrix?: ICEMatrix4): ICEMatrix4 {
    const parent = parentMatrix
      ?? this._parent?.updateWorldMatrix()
      ?? new ICEMatrix4().identity();

    const local = this.localMatrix(LOCAL_MATRIX);
    this.worldMatrix.elements.set(parent.elements);
    this.worldMatrix.multiply(local);
    return this.worldMatrix;
  }

  getWorldPosition(): ICEVector3 {
    const matrix = this.updateWorldMatrix();
    return new ICEVector3(matrix.elements[12]!, matrix.elements[13]!, matrix.elements[14]!);
  }

  setLocalMatrix(matrix: ICEMatrix4Tuple): this {
    if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
      throw new TypeError('ICE local matrix must contain 16 finite values');
    }
    this.localMatrixOverride = new Float32Array(matrix);
    return this;
  }

  clearLocalMatrix(): this {
    this.localMatrixOverride = null;
    return this;
  }

  toJSON(): ICESerializedNode {
    return {
      id: this.id,
      displayName: this.displayName,
      ...(this.metadata ? { metadata: this.metadata } : {}),
      typeId: this.typeId,
      ...(this.selectionId ? { selectionId: this.selectionId } : {}),
      visible: this.visible,
      position: this.position.toArray(),
      rotation: this.rotation.toArray(),
      scale: this.scale.toArray(),
      ...(this.localMatrixOverride
        ? { matrix: [...this.localMatrixOverride] as unknown as ICEMatrix4Tuple }
        : {}),
      children: this._children.map((child) => child.toJSON()),
    };
  }

  dispose(): void {
    for (const child of [...this._children]) {
      this.removeChild(child, { dispose: true });
    }
    this.removeAllListeners();
  }

  private getRoot(): ICENode {
    let current: ICENode = this;
    while (current._parent) {
      current = current._parent;
    }
    return current;
  }

  private isAncestorOf(node: ICENode): boolean {
    let current: ICENode | null = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current._parent;
    }
    return false;
  }

  private localMatrix(target: ICEMatrix4): ICEMatrix4 {
    if (this.localMatrixOverride) {
      target.elements.set(this.localMatrixOverride);
      return target;
    }
    const x = this.rotation.x;
    const y = this.rotation.y;
    const z = this.rotation.z;
    const cx = Math.cos(x);
    const sx = Math.sin(x);
    const cy = Math.cos(y);
    const sy = Math.sin(y);
    const cz = Math.cos(z);
    const sz = Math.sin(z);
    const elements = target.elements;

    elements[0] = (cy * cz) * this.scale.x;
    elements[1] = (sx * sy * cz + cx * sz) * this.scale.x;
    elements[2] = (-cx * sy * cz + sx * sz) * this.scale.x;
    elements[3] = 0;
    elements[4] = (-cy * sz) * this.scale.y;
    elements[5] = (-sx * sy * sz + cx * cz) * this.scale.y;
    elements[6] = (cx * sy * sz + sx * cz) * this.scale.y;
    elements[7] = 0;
    elements[8] = sy * this.scale.z;
    elements[9] = -sx * cy * this.scale.z;
    elements[10] = cx * cy * this.scale.z;
    elements[11] = 0;
    elements[12] = this.position.x;
    elements[13] = this.position.y;
    elements[14] = this.position.z;
    elements[15] = 1;
    return target;
  }
}

const collectIDs = (node: ICENode): string[] => [
  node.id,
  ...node.children.flatMap((child) => collectIDs(child)),
];
