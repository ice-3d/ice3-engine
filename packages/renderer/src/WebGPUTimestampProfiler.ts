type TimestampSlot = {
  readonly querySet: GPUQuerySet;
  readonly buffer: GPUBuffer;
  pending: boolean;
};

export class WebGPUTimestampProfiler {
  private readonly slots: TimestampSlot[];
  private readonly pending: number[] = [];
  private reason: string | undefined;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    slotCount = 64,
  ) {
    if (!Number.isInteger(slotCount) || slotCount < 1) {
      throw new Error('ICE3_TIMESTAMP_INVALID: slot count must be positive');
    }
    this.slots = Array.from({ length: slotCount }, (_, index) => ({
      querySet: device.createQuerySet({
        label: `ice3:timestamp:${index}`,
        type: 'timestamp',
        count: 2,
      }),
      buffer: device.createBuffer({
        label: `ice3:timestamp-resolve:${index}`,
        size: 256,
        usage: 512 | 8 | 1,
      }),
      pending: false,
    }));
  }

  get unavailableReason(): string | undefined {
    return this.reason;
  }

  querySetFor(frameId: number): GPUQuerySet {
    return this.slotFor(frameId).querySet;
  }

  resolveFrame(encoder: GPUCommandEncoder, frameId: number): void {
    const slot = this.slotFor(frameId);
    if (slot.pending) {
      throw new Error('ICE3_TIMESTAMP_SLOT_BUSY');
    }
    encoder.resolveQuerySet(slot.querySet, 0, 2, slot.buffer, 0);
    this.pending.push(this.slotIndex(frameId));
    slot.pending = true;
  }

  async drain(): Promise<readonly number[]> {
    if (this.disposed) return [];
    const samples: number[] = [];
    for (const index of [...this.pending]) {
      const slot = this.slots[index]!;
      let mapped = false;
      try {
        await slot.buffer.mapAsync(1);
        mapped = true;
        const values = new BigUint64Array(
          slot.buffer.getMappedRange(),
          0,
          2,
        );
        const start = values[0]!;
        const end = values[1]!;
        if (end <= start) {
          this.reason = 'invalid-timestamp';
        } else {
          samples.push(Number(end - start) / 1_000_000);
        }
      } catch {
        this.reason = 'map-failed';
      } finally {
        if (mapped) slot.buffer.unmap();
        slot.pending = false;
        const pendingIndex = this.pending.indexOf(index);
        if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1);
      }
    }
    return samples;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.querySet.destroy();
      slot.buffer.destroy();
      slot.pending = false;
    }
    this.pending.length = 0;
  }

  private slotFor(frameId: number): TimestampSlot {
    if (this.disposed) {
      throw new Error('ICE3_ENGINE_DESTROYED: timestamp profiler');
    }
    if (!Number.isSafeInteger(frameId) || frameId < 0) {
      throw new Error('ICE3_TIMESTAMP_INVALID: frame ID');
    }
    return this.slots[this.slotIndex(frameId)]!;
  }

  private slotIndex(frameId: number): number {
    return frameId % this.slots.length;
  }
}
