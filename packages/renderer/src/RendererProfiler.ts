export type ICEFrameStageProfile = Readonly<{
  collectMs: number;
  prepareAndUploadMs: number;
  encodeMs: number;
  submitMs: number;
}>;

type Stage = 'collect' | 'prepareAndUpload' | 'encode' | 'submit';

export class RendererProfiler {
  private enabled = false;
  private cursor = 0;
  private readonly marks = new Map<Stage, number>();

  enable(value: boolean): void {
    this.enabled = value;
    this.marks.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  begin(): void {
    if (!this.enabled) return;
    this.cursor = performance.now();
    this.marks.clear();
  }

  mark(stage: Stage): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.marks.set(stage, Math.max(0, now - this.cursor));
    this.cursor = now;
  }

  end(): ICEFrameStageProfile | null {
    if (!this.enabled) return null;
    return {
      collectMs: this.marks.get('collect') ?? 0,
      prepareAndUploadMs: this.marks.get('prepareAndUpload') ?? 0,
      encodeMs: this.marks.get('encode') ?? 0,
      submitMs: this.marks.get('submit')
        ?? Math.max(0, performance.now() - this.cursor),
    };
  }
}
