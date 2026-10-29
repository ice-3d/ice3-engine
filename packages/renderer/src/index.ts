export { FakeRendererBackend } from './FakeRendererBackend.js';
export {
  WebGL2RendererBackend,
  colorToRgba,
} from './WebGL2RendererBackend.js';
export {
  selectDefaultRendererBackend,
  selectRendererBackend,
  type ICERendererBackendSelection,
  type ICERendererFactories,
} from './RendererSelection.js';
export {
  WebGPURendererBackend,
  type WebGPUDeviceContext,
} from './WebGPURendererBackend.js';
export { probeWebGPU } from './WebGPUProbe.js';
export type {
  ICEWebGPUProbeFailureReason,
  ICEWebGPUProbeOptions,
  ICEWebGPUProbeResult,
} from './WebGPUProbe.js';
export {
  WebGPUGeometryCache,
  type WebGPUGeometryCacheOptions,
  type WebGPUGeometryEntry,
} from './WebGPUGeometryCache.js';
export {
  WebGPUInstanceCache,
  type WebGPUInstanceEntry,
} from './WebGPUInstanceCache.js';
export {
  WebGPUDrawStorage,
  type ICEWebGPUDrawUniform,
} from './WebGPUDrawStorage.js';
export {
  WebGPURenderPlanCache,
  type WebGPURenderPlan,
} from './WebGPURenderPlan.js';
export {
  detectWebGPUAcceleration,
  WEBGPU_GPU_DRIVEN_DEFAULT,
  WEBGPU_INSTANCE_VISIBILITY_THRESHOLD,
  WEBGPU_STORAGE_DEFAULT,
  type ICEWebGPUAcceleration,
  type ICEWebGPUAccelerationTier,
  type ICEWebGPUOptimizationStats,
} from './WebGPUCapabilities.js';
export {
  INSTANCE_RECORD_BYTES,
  WebGPUInstanceStorage,
  type ICEInstanceStorageEntry,
  type ICEInstanceStoragePage,
  type ICEInstanceStoragePagePlan,
  type WebGPUInstanceStorageOptions,
} from './WebGPUInstanceStorage.js';
export {
  createIndirectArguments,
  isAabbVisible,
  WebGPUVisibilityEncoder,
  type ICEVisibilityEntry,
} from './WebGPUVisibility.js';
export { WebGPUBundleCache } from './WebGPUBundleCache.js';
export {
  buildSelectionMask,
  WebGPUSelectionMaskBuffer,
  type ICESelectionMaskLayout,
} from './WebGPUSelectionMask.js';
export {
  collectWebGPUPickIds,
  WebGPUPicker,
} from './WebGPUPicker.js';
export {
  collectRenderables,
  selectionIdentity,
  type ICEGeometryRenderable,
} from './Renderables.js';
export {
  collectInstanceBatches,
  type ICEInstanceBatch,
} from './InstanceBatch.js';
export { queueBatchGeneration } from './ICEWebGL2BatchGenerationUploader.js';
export type {
  ICEFrameStageProfile,
} from './RendererProfiler.js';
export {
  RendererProfiler,
} from './RendererProfiler.js';
export { WebGPUTimestampProfiler } from './WebGPUTimestampProfiler.js';
export type {
  ICEBatchGenerationHandle,
  ICEBatchUploadBuffer,
  ICEBatchUploadOptions,
} from './ICEWebGL2BatchGenerationUploader.js';
export {
  collectRenderBatches,
  semanticSelectionId,
  type ICERenderBatchDraw,
  type ICERenderBatchNode,
} from './RenderBatch.js';
export type {
  ICERendererBackend,
  ICERendererCapabilities,
  ICERendererStats,
  ICEFrame,
  ICEScreenPoint,
  ICEViewport,
  ICE3RendererPreference,
  ICE3RendererSelection,
  ICEWebGPUOptimizationFailureReason,
} from './types.js';
