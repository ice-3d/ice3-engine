import {
  createEmptyGPUDataBuffer,
  writeGPUData,
} from './WebGPUResources.js';

const STORAGE_USAGE = 128 | 8;

export type ICESelectionMaskLayout = Readonly<{
  words: Uint32Array;
  bases: readonly number[];
}>;

export function buildSelectionMask(
  ranges: readonly (readonly string[])[],
  selection: readonly string[],
): ICESelectionMaskLayout {
  const selected = new Set(selection);
  const bases: number[] = [];
  let count = 0;
  for (const range of ranges) {
    bases.push(count);
    count += range.length;
  }
  const words = new Uint32Array(Math.max(1, count));
  ranges.forEach((range, rangeIndex) => {
    const base = bases[rangeIndex]!;
    range.forEach((id, index) => {
      words[base + index] = selected.has(id) ? 1 : 0;
    });
  });
  return { words, bases };
}

export class WebGPUSelectionMaskBuffer {
  private maskBuffer: GPUBuffer | null = null;
  private previous: Uint8Array | null = null;
  private maskGeneration = 0;

  constructor(private readonly device: GPUDevice) {}

  get buffer(): GPUBuffer | null {
    return this.maskBuffer;
  }

  get generation(): number {
    return this.maskGeneration;
  }

  get totalBytes(): number {
    return this.maskBuffer?.size ?? 0;
  }

  update(words: Uint32Array): void {
    if (this.maskBuffer && this.maskBuffer.size < words.byteLength) {
      this.maskBuffer.destroy();
      this.maskBuffer = null;
      this.previous = null;
    }
    if (!this.maskBuffer) {
      this.maskBuffer = createEmptyGPUDataBuffer(
        this.device,
        words.byteLength,
        STORAGE_USAGE,
        'ice3:selection-mask',
      );
      this.maskGeneration += 1;
    }
    const bytes = new Uint8Array(
      words.buffer,
      words.byteOffset,
      words.byteLength,
    ).slice();
    if (this.previous && sameBytes(this.previous, bytes)) return;
    writeGPUData(this.device, this.maskBuffer, words);
    this.previous = bytes;
  }

  dispose(): void {
    this.maskBuffer?.destroy();
    this.maskBuffer = null;
    this.previous = null;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
