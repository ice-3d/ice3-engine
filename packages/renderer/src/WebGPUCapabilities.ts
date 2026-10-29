export type ICEWebGPUAccelerationTier =
  | 'baseline'
  | 'storage'
  | 'gpu-driven';

// Measured CPU benefit was below the 10% promotion threshold.
export const WEBGPU_STORAGE_DEFAULT = false;

export type ICEWebGPUOptimizationStats = Readonly<{
  tier: ICEWebGPUAccelerationTier;
  selectionMaskActive: boolean;
  bundleActive: boolean;
  storageActive: boolean;
  visibilityActive: boolean;
  instanceUploadBytes: number;
  bundleRecreations: number;
  timestampUnavailableReason?: string;
}>;

export type ICEWebGPUAcceleration = Readonly<{
  tier: ICEWebGPUAccelerationTier;
  storage: boolean;
  visibility: boolean;
  maxStorageBufferBindingSize: number;
  minStorageBufferOffsetAlignment: number;
}>;

export function detectWebGPUAcceleration(
  device: GPUDevice,
): ICEWebGPUAcceleration {
  const maxBindingBytes =
    device.limits.maxStorageBufferBindingSize ?? 0;
  const maxBuffers =
    device.limits.maxStorageBuffersPerShaderStage ?? 0;
  const alignment =
    device.limits.minStorageBufferOffsetAlignment ?? 256;
  const storage = (
    maxBindingBytes >= 256
    && maxBuffers >= 2
    && alignment >= 4
    && Number.isInteger(alignment)
  );
  const visibility = false;
  return {
    tier: storage ? 'storage' : 'baseline',
    storage,
    visibility,
    maxStorageBufferBindingSize: maxBindingBytes,
    minStorageBufferOffsetAlignment: alignment,
  };
}
