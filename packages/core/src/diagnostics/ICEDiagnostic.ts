export type ICEDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ICEDiagnostic {
  readonly severity: ICEDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
