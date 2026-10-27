import { ICENode, type ICENodeOptions } from './ICENode';

export class ICEScene extends ICENode {
  constructor(options: ICENodeOptions) {
    super(options);
  }

  override get typeId(): string {
    return 'ice3:Scene';
  }
}
