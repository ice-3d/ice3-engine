import { WEBGPU_UNIFORM_STRIDE } from './WebGPURenderPipeline.js';

const FLOATS_PER_DRAW = WEBGPU_UNIFORM_STRIDE / 4;

export type ICEWebGPUDrawUniform = Readonly<{
  matrix: ArrayLike<number>;
  color: readonly [number, number, number, number];
  useVertexColor: boolean;
  useInstancing: boolean;
  semanticHighlight?: number;
  useSemantic?: boolean;
  selectionBase: number;
  useSelectionMask: boolean;
}>;

export class WebGPUDrawStorage {
  private uniformBuffer: Float32Array;
  private capacity: number;
  private generationValue = 0;
  private count = 0;

  constructor(private readonly minimumCapacity = 64) {
    if (!Number.isInteger(minimumCapacity) || minimumCapacity < 1) {
      throw new Error('ICE3_DRAW_STORAGE_INVALID');
    }
    this.capacity = drawCountPowerOfTwo(minimumCapacity);
    this.uniformBuffer = new Float32Array(
      this.capacity * FLOATS_PER_DRAW,
    );
  }

  begin(requiredDraws: number): void {
    this.ensureCapacity(requiredDraws);
    this.count = 0;
  }

  append(draw: ICEWebGPUDrawUniform): number {
    if (this.count >= this.capacity) {
      this.ensureCapacity(this.count + 1);
    }
    const index = this.count;
    const offset = index * FLOATS_PER_DRAW;
    this.uniformBuffer.set(draw.matrix, offset);
    this.uniformBuffer.set(draw.color, offset + 16);
    this.uniformBuffer[offset + 20] = 0;
    this.uniformBuffer[offset + 21] = 0;
    this.uniformBuffer[offset + 22] = draw.useVertexColor ? 1 : 0;
    this.uniformBuffer[offset + 23] = draw.useInstancing ? 1 : 0;
    this.uniformBuffer[offset + 24] = draw.semanticHighlight ?? 0;
    this.uniformBuffer[offset + 25] = draw.useSemantic ? 1 : 0;
    this.uniformBuffer[offset + 26] = 0;
    this.uniformBuffer[offset + 27] = 0;
    this.uniformBuffer[offset + 28] = draw.selectionBase;
    this.uniformBuffer[offset + 29] = draw.useSelectionMask ? 1 : 0;
    this.count += 1;
    return index;
  }

  get uniformData(): Float32Array {
    return this.uniformBuffer;
  }

  get drawCount(): number {
    return this.count;
  }

  get generation(): number {
    return this.generationValue;
  }

  private ensureCapacity(requiredDraws: number): void {
    const next = Math.max(
      this.minimumCapacity,
      drawCountPowerOfTwo(requiredDraws),
    );
    if (next === this.capacity) return;
    this.capacity = next;
    this.uniformBuffer = new Float32Array(next * FLOATS_PER_DRAW);
    this.generationValue += 1;
  }
}

function drawCountPowerOfTwo(value: number): number {
  let result = 1;
  while (result < Math.max(1, value)) result *= 2;
  return result;
}
