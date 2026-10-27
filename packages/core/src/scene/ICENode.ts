import { ICEEventDispatcher } from '../event/ICEEventDispatcher';
import { ICEEngineError } from '../diagnostics/ICEEngineError';
import { ICEMatrix4 } from '../math/ICEMatrix4';
import { ICEVector3, type ICEVector3Tuple } from '../math/ICEVector3';

export interface ICENodeOptions {
  readonly id: string;
  readonly position?: ICEVector3Tuple;
  readonly rotation?: ICEVector3Tuple;
  readonly scale?: ICEVector3Tuple;
}

export interface ICESerializedNode {
  readonly id: string;
  readonly typeId: string;
  readonly visible: boolean;
  readonly position: ICEVector3Tuple;
  readonly rotation: ICEVector3Tuple;
  readonly scale: ICEVector3Tuple;
  readonly children: readonly ICESerializedNode[];
  readonly [key: string]: unknown;
}

const LOCAL_MATRIX = new ICEMatrix4();

export class ICENode extends ICEEventDispatcher {
  readonly id: string;
  readonly position: ICEVector3;
  readonly rotation: ICEVector3;
  readonly scale: ICEVector3;
  visible = true;

  private _parent: ICENode | null = null;
  private readonly _children: ICENode[] = [];
  private readonly worldMatrix = new ICEMatrix4();

  constructor(options: ICENodeOptions) {
    super();
    if (!options.id.trim()) {
      throw new TypeError('ICE node ID must not be empty');
    }
    this.id = options.id;
    this.position = new ICEVector3(...(options.position ?? [0, 0, 0]));
    this.rotation = new ICEVector3(...(options.rotation ?? [0, 0, 0]));
    this.scale = new ICEVector3(...(options.scale ?? [1, 1, 1]));
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
    const duplicate = root.findByID(node.id);
    if (duplicate && duplicate !== node) {
      throw new ICEEngineError(
        'ICE3_DUPLICATE_OBJECT_ID',
        `Duplicate ICE node ID: ${node.id}`,
        { id: node.id },
      );
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

  toJSON(): ICESerializedNode {
    return {
      id: this.id,
      typeId: this.typeId,
      visible: this.visible,
      position: this.position.toArray(),
      rotation: this.rotation.toArray(),
      scale: this.scale.toArray(),
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
