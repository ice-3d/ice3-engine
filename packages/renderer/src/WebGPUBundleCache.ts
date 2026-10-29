export class WebGPUBundleCache {
  private key: string | null = null;
  private bundle: GPURenderBundle | null = null;
  private recreations = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {}

  get(
    key: string,
    record: (encoder: GPURenderBundleEncoder) => void,
  ): GPURenderBundle {
    if (this.key === key && this.bundle) return this.bundle;
    const encoder = this.device.createRenderBundleEncoder({
      label: `ice3:bundle:${key}`,
      colorFormats: [this.format],
      depthStencilFormat: 'depth24plus',
    });
    record(encoder);
    const bundle = encoder.finish();
    this.key = key;
    this.bundle = bundle;
    this.recreations += 1;
    return bundle;
  }

  get current(): GPURenderBundle | null {
    return this.bundle;
  }

  get bundleRecreations(): number {
    return this.recreations;
  }

  invalidate(): void {
    this.key = null;
    this.bundle = null;
  }

  dispose(): void {
    this.invalidate();
  }
}
