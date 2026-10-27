import type { ICERenderBatchPlan } from './ICERenderBatchPlan.js';

export type ICERenderBatchingMode = 'asset' | 'adaptive' | 'off';

export interface ICERenderBatchingOptions {
  readonly mode: ICERenderBatchingMode;
  readonly maxWorkers?: number;
  readonly idleTaskBudgetMs?: number;
  readonly uploadBytesPerFrame?: number;
  readonly maxExtraGpuBytes?: number;
}

export interface ICEAdaptiveBatchRequest {
  readonly cameraMoving: boolean;
  readonly generation: number;
  readonly plan: ICERenderBatchPlan;
}

export type ICEAdaptiveBatchExecutionResult =
  | {
    readonly kind: 'completed';
    readonly estimatedBytes: number;
  }
  | {
    readonly kind: 'failed';
    readonly reason: 'worker' | 'upload';
    readonly error: unknown;
  };

export type ICEAdaptiveBatchRequestResult =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'started'; readonly generation: number }
  | {
    readonly kind: 'rejected';
    readonly reason: 'plan' | 'memory' | 'superseded' | 'busy';
  };

export interface ICEAdaptiveRenderBatchControllerOptions {
  readonly mode: ICERenderBatchingMode;
  readonly activeGeneration: number;
  readonly maxExtraGpuBytes?: number;
  readonly execute: (
    request: ICEAdaptiveBatchRequest,
  ) => Promise<ICEAdaptiveBatchExecutionResult>;
  readonly onDiagnostic?: (
    code: string,
    generation: number,
    message: string,
  ) => void;
}

export class ICEAdaptiveRenderBatchController {
  private generation: number;
  private candidateGeneration: number | undefined;
  private readonly mode: ICERenderBatchingMode;
  private readonly maxExtraGpuBytes: number;
  private readonly execute: ICEAdaptiveRenderBatchControllerOptions['execute'];
  private readonly onDiagnostic:
    ICEAdaptiveRenderBatchControllerOptions['onDiagnostic'];
  private readonly emitted = new Set<string>();

  constructor(options: ICEAdaptiveRenderBatchControllerOptions) {
    this.mode = options.mode;
    this.generation = options.activeGeneration;
    this.maxExtraGpuBytes = options.maxExtraGpuBytes ?? 256 * 1024 * 1024;
    this.execute = options.execute;
    this.onDiagnostic = options.onDiagnostic;
  }

  get activeGeneration(): number {
    return this.generation;
  }

  get candidate(): number | undefined {
    return this.candidateGeneration;
  }

  request(request: ICEAdaptiveBatchRequest): ICEAdaptiveBatchRequestResult {
    if (this.mode !== 'adaptive') return { kind: 'disabled' };
    if (request.cameraMoving) return { kind: 'deferred' };
    if (!request.plan.accepted) {
      return { kind: 'rejected', reason: 'plan' };
    }
    if (request.generation <= this.generation) {
      return { kind: 'rejected', reason: 'superseded' };
    }
    if (this.candidateGeneration !== undefined) {
      return { kind: 'rejected', reason: 'busy' };
    }
    if (
      request.plan.estimatedBytes > this.maxExtraGpuBytes
      || request.plan.estimatedBytes > Number.MAX_SAFE_INTEGER
    ) {
      this.diagnostic(
        'ICE3_RENDER_BATCH_MEMORY_REJECTED',
        request.generation,
        'Adaptive render batch generation exceeds the extra GPU memory budget',
      );
      return { kind: 'rejected', reason: 'memory' };
    }
    this.candidateGeneration = request.generation;
    this.diagnostic(
      'ICE3_RENDER_BATCH_ADAPTIVE_STARTED',
      request.generation,
      'Adaptive render batch generation started',
    );
    void this.execute(request).then(
      (result) => this.finish(request.generation, result),
      (error: unknown) => this.finish(request.generation, {
        kind: 'failed',
        reason: 'worker',
        error,
      }),
    );
    return { kind: 'started', generation: request.generation };
  }

  cancel(generation: number): void {
    if (this.candidateGeneration !== generation) return;
    this.candidateGeneration = undefined;
    this.diagnostic(
      'ICE3_RENDER_BATCH_ADAPTIVE_CANCELLED',
      generation,
      'Adaptive render batch generation was cancelled',
    );
  }

  cameraMotion(): void {
    if (this.candidateGeneration !== undefined) {
      this.cancel(this.candidateGeneration);
    }
  }

  dispose(): void {
    if (this.candidateGeneration !== undefined) {
      const generation = this.candidateGeneration;
      this.candidateGeneration = undefined;
      this.emitted.clear();
      this.diagnostic(
        'ICE3_RENDER_BATCH_ADAPTIVE_CANCELLED',
        generation,
        'Adaptive render batch generation was cancelled',
      );
    }
  }

  private finish(
    generation: number,
    result: ICEAdaptiveBatchExecutionResult,
  ): void {
    if (this.candidateGeneration !== generation) return;
    this.candidateGeneration = undefined;
    if (result.kind === 'completed') {
      this.generation = generation;
      this.diagnostic(
        'ICE3_RENDER_BATCH_ADAPTIVE_COMPLETED',
        generation,
        'Adaptive render batch generation is active',
      );
      return;
    }
    this.diagnostic(
      'ICE3_RENDER_BATCH_ADAPTIVE_FAILED',
      generation,
      `Adaptive ${result.reason} stage failed: ${
        result.error instanceof Error ? result.error.message : String(result.error)
      }`,
    );
  }

  private diagnostic(
    code: string,
    generation: number,
    message: string,
  ): void {
    const key = `${code}:${generation}`;
    if (this.emitted.has(key)) return;
    this.emitted.add(key);
    this.onDiagnostic?.(code, generation, message);
  }
}
