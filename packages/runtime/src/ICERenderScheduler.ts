export interface ICERenderScheduler {
  request(callback: FrameRequestCallback): number;
  cancelAll(): void;
  flushForTest(): boolean;
  pendingCount(): number;
}

export class BrowserRenderScheduler implements ICERenderScheduler {
  private readonly pending = new Map<number, FrameRequestCallback>();

  request(callback: FrameRequestCallback): number {
    let handle = 0;
    handle = requestAnimationFrame((time) => {
      this.pending.delete(handle);
      callback(time);
    });
    this.pending.set(handle, callback);
    return handle;
  }

  cancelAll(): void {
    for (const handle of this.pending.keys()) {
      cancelAnimationFrame(handle);
    }
    this.pending.clear();
  }

  flushForTest(): boolean {
    const first = this.pending.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!first) {
      return false;
    }
    cancelAnimationFrame(first[0]);
    this.pending.delete(first[0]);
    first[1](performance.now());
    return true;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
