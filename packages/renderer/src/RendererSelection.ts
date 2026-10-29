import { ICEEngineError } from '@ice3/core';
import { probeWebGPU } from './WebGPUProbe.js';
import { WebGPURendererBackend } from './WebGPURendererBackend.js';
import { WebGL2RendererBackend } from './WebGL2RendererBackend.js';
import type {
  ICE3RendererPreference,
  ICE3RendererSelection,
  ICERendererBackend,
} from './types.js';

export type ICERendererFactories = Readonly<{
  createWebGPU: () => Promise<ICERendererBackend>;
  createWebGL2: () => ICERendererBackend;
}>;

export type ICERendererBackendSelection = Readonly<{
  backend: ICERendererBackend;
  selection: ICE3RendererSelection;
}>;

export async function selectRendererBackend(
  preference: ICE3RendererPreference,
  factories: ICERendererFactories,
): Promise<ICERendererBackendSelection> {
  const startedAt = performance.now();
  if (preference === 'webgl2') {
    const backend = factories.createWebGL2();
    return {
      backend,
      selection: {
        requested: preference,
        selected: backend.capabilities.backend,
        fallback: false,
        probeDurationMs: performance.now() - startedAt,
      },
    };
  }

  try {
    const backend = await factories.createWebGPU();
    return {
      backend,
      selection: {
        requested: preference,
        selected: backend.capabilities.backend,
        fallback: false,
        probeDurationMs: performance.now() - startedAt,
      },
    };
  } catch (error) {
    if (preference === 'webgpu') {
      if (
        error instanceof ICEEngineError
        && error.code === 'ICE3_WEBGPU_UNAVAILABLE'
      ) {
        throw error;
      }
      throw new ICEEngineError(
        'ICE3_WEBGPU_UNAVAILABLE',
        `ICE3_WEBGPU_UNAVAILABLE: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { reason: failureReason(error) },
      );
    }
    const backend = factories.createWebGL2();
    const reason = failureReason(error);
    return {
      backend,
      selection: {
        requested: preference,
        selected: backend.capabilities.backend,
        fallback: true,
        probeDurationMs: performance.now() - startedAt,
        ...(reason ? { fallbackReason: reason } : {}),
      },
    };
  }
}

export async function selectDefaultRendererBackend(
  preference: ICE3RendererPreference,
): Promise<ICERendererBackendSelection> {
  return selectRendererBackend(preference, {
    createWebGPU: createDefaultWebGPU,
    createWebGL2: () => new WebGL2RendererBackend(),
  });
}

async function createDefaultWebGPU(): Promise<ICERendererBackend> {
  const result = await probeWebGPU();
  if (!result.supported) {
    throw new ICEEngineError(
      'ICE3_WEBGPU_UNAVAILABLE',
      `ICE3_WEBGPU_UNAVAILABLE: ${result.reason}${
        result.detail ? `: ${result.detail}` : ''
      }`,
      { reason: result.reason },
    );
  }
  try {
    return await WebGPURendererBackend.create(result);
  } catch (error) {
    throw new ICEEngineError(
      'ICE3_WEBGPU_UNAVAILABLE',
      `ICE3_WEBGPU_UNAVAILABLE: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { reason: 'pipeline-failed' },
    );
  }
}

function failureReason(
  error: unknown,
): ICE3RendererSelection['fallbackReason'] {
  const details = (
    error as { readonly details?: Readonly<Record<string, unknown>> }
  )?.details;
  const reason = details?.reason;
  return typeof reason === 'string'
    ? reason as ICE3RendererSelection['fallbackReason']
    : undefined;
}
