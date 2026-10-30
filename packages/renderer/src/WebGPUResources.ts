import { ICEEngineError } from '@ice3/core';

export const WEBGPU_BUFFER_USAGE = {
  vertex: 32 | 8,
  index: 16 | 8,
} as const;

export function alignToFourBytes(value: number): number {
  return Math.ceil(value / 4) * 4;
}

export function createGPUDataBuffer(
  device: GPUDevice,
  data: ArrayBufferView,
  usage: GPUBufferUsageFlags,
  label: string,
): GPUBuffer {
  const byteLength = alignToFourBytes(data.byteLength);
  let buffer: GPUBuffer | undefined;
  try {
    buffer = device.createBuffer({
      label,
      size: byteLength,
      usage,
      mappedAtCreation: false,
    });
    const upload = data.byteLength === byteLength
      ? data
      : copyAndPad(data, byteLength);
    device.queue.writeBuffer(buffer, 0, upload as unknown as BufferSource);
    return buffer;
  } catch (error) {
    buffer?.destroy();
    throw new ICEEngineError(
      'ICE3_GPU_RESOURCE_FAILED',
      `ICE3_GPU_RESOURCE_FAILED: ${label}`,
      { cause: error },
    );
  }
}

export function createEmptyGPUDataBuffer(
  device: GPUDevice,
  byteLength: number,
  usage: GPUBufferUsageFlags,
  label: string,
): GPUBuffer {
  try {
    return device.createBuffer({
      label,
      size: Math.max(4, alignToFourBytes(byteLength)),
      usage,
      mappedAtCreation: false,
    });
  } catch (error) {
    throw new ICEEngineError(
      'ICE3_GPU_RESOURCE_FAILED',
      `ICE3_GPU_RESOURCE_FAILED: ${label}`,
      { cause: error },
    );
  }
}

export function writeGPUData(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: ArrayBufferView,
): void {
  try {
    device.queue.writeBuffer(buffer, 0, data as unknown as BufferSource);
  } catch (error) {
    throw new ICEEngineError(
      'ICE3_GPU_RESOURCE_FAILED',
      'ICE3_GPU_RESOURCE_FAILED: buffer upload failed',
      { cause: error },
    );
  }
}

function copyAndPad(
  data: ArrayBufferView,
  byteLength: number,
): Uint8Array {
  const output = new Uint8Array(byteLength);
  output.set(new Uint8Array(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ));
  return output;
}
