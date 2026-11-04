/**
 * Base-colour texture cache.
 *
 * Materials reference textures by URL; the renderer turns each URL into one
 * `WebGLTexture` the first time a frame needs it and keeps it for later frames.
 * Loading is asynchronous, so the first frames after a URL appears draw with the
 * flat material colour and switch to the texture once the upload lands — a
 * self-correcting behaviour that never blocks the frame loop.
 */

const REPEAT = 10497;

export type ICEImageLoader = (url: string) => Promise<ImageBitmap>;

export type ICEWebGL2TextureStats = {
  readonly loaded: number;
  readonly pending: number;
  readonly failed: number;
};

type TextureEntry =
  | { readonly state: 'pending' }
  | { readonly state: 'ready'; readonly texture: WebGLTexture }
  | { readonly state: 'failed' };

/** Default loader: fetch the image and decode it off the main thread. */
export const fetchImageLoader: ICEImageLoader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ICE3_TEXTURE_FETCH_FAILED: ${response.status} ${url}`);
  }
  return createImageBitmap(await response.blob());
};

export class WebGL2TextureCache {
  private readonly entries = new Map<string, TextureEntry>();
  private disposed = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly load: ICEImageLoader = fetchImageLoader,
    private readonly onUpload?: () => void,
  ) {}

  /** Texture for `url`, or `null` while it is still loading (or after failure). */
  texture(url: string): WebGLTexture | null {
    if (this.disposed) return null;
    const existing = this.entries.get(url);
    if (existing) {
      return existing.state === 'ready' ? existing.texture : null;
    }
    this.entries.set(url, { state: 'pending' });
    void this.load(url)
      .then((image) => {
        if (this.disposed) {
          image.close?.();
          return;
        }
        const texture = this.upload(image);
        // A dispose during the await must not resurrect an entry.
        if (this.disposed) {
          this.gl.deleteTexture(texture);
          return;
        }
        this.entries.set(url, { state: 'ready', texture });
        this.onUpload?.();
      })
      .catch(() => {
        if (!this.disposed) this.entries.set(url, { state: 'failed' });
      });
    return null;
  }

  stats(): ICEWebGL2TextureStats {
    let loaded = 0;
    let pending = 0;
    let failed = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready') loaded += 1;
      else if (entry.state === 'pending') pending += 1;
      else failed += 1;
    }
    return { loaded, pending, failed };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready') this.gl.deleteTexture(entry.texture);
    }
    this.entries.clear();
  }

  private upload(image: ImageBitmap): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('ICE3_TEXTURE_CREATE_FAILED');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    image.close?.();
    return texture;
  }
}
