import type { ICENode, ICESerializedNode } from '../scene/ICENode.js';

export interface ICENodeType {
  readonly typeId: string;
  fromJSON(value: ICESerializedNode): ICENode;
}

export class ICETypeRegistry {
  private readonly types = new Map<string, ICENodeType>();
  private readonly typeIds = new Map<ICENodeType, string>();

  register(typeId: string, type: ICENodeType): this {
    if (!/^[a-z][a-z0-9-]*:[A-Za-z_][A-Za-z0-9_-]*$/.test(typeId)) {
      throw new TypeError(`Invalid ICE type ID: ${typeId}`);
    }

    const registeredType = this.types.get(typeId);
    if (registeredType && registeredType !== type) {
      throw new TypeError(`Type ID already registered: ${typeId}`);
    }

    const registeredId = this.typeIds.get(type);
    if (registeredId && registeredId !== typeId) {
      throw new TypeError(`Type already registered as ${registeredId}`);
    }

    this.types.set(typeId, type);
    this.typeIds.set(type, typeId);
    return this;
  }

  get(typeId: string): ICENodeType | undefined {
    return this.types.get(typeId);
  }
}
