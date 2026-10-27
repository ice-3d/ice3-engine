export class ICEEvent<T = unknown> {
  constructor(
    readonly type: string,
    readonly target: unknown,
    readonly param?: T,
  ) {}
}
