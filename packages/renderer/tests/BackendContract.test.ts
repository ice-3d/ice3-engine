import { expect, it } from 'node-test';
import {
  FakeRendererBackend,
  WebGL2RendererBackend,
  colorToRgba,
} from '../src/index';

it('records frames without exposing GPU objects', () => {
  const backend = new FakeRendererBackend();
  expect(backend.stats).toMatchObject({
    gpuUploads: 0,
    gpuEvictions: 0,
  });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 2);
  backend.render({
    frameId: 1,
    scene: {} as never,
    camera: {} as never,
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 2,
    selection: [],
  });

  expect(backend.frames).toHaveLength(1);
  expect(backend.lastViewport).toEqual({ x: 0, y: 0, width: 320, height: 180 });
  expect(Object.keys(backend)).not.toContain('gl');
});

it('rejects a target without WebGL2 using a stable diagnostic code', () => {
  const canvas = {
    getContext: () => null,
  } as unknown as HTMLCanvasElement;

  expect(() => new WebGL2RendererBackend().initialize({ canvas })).toThrowError(
    /ICE3_WEBGL2_UNAVAILABLE/,
  );
});

it('declares whether the backend supports exact picking', () => {
  expect(new FakeRendererBackend().capabilities.picking).toBe(false);
  expect(new WebGL2RendererBackend().capabilities.picking).toBe(true);
});

it('caches material colors after their first conversion', () => {
  expect(colorToRgba('#abc')).toBe(colorToRgba('#abc'));
  expect(colorToRgba('#112233')).toEqual([
    0x11 / 255,
    0x22 / 255,
    0x33 / 255,
    1,
  ]);
});

it('preserves the drawing buffer for pixel capture and recovery', () => {
  let contextOptions: WebGLContextAttributes | undefined;
  const canvas = {
    getContext: (_type: string, options: WebGLContextAttributes) => {
      contextOptions = options;
      return null;
    },
  } as unknown as HTMLCanvasElement;

  expect(() => new WebGL2RendererBackend().initialize({ canvas }))
    .toThrowError(/ICE3_WEBGL2_UNAVAILABLE/);
  expect(contextOptions?.preserveDrawingBuffer).toBe(true);
});
