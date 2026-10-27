import type { ICEDiagnostic } from './ICEDiagnostic.js';

export class ICEEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly diagnostic?: Readonly<ICEDiagnostic>,
  ) {
    super(message);
    this.name = 'ICEEngineError';
  }
}
