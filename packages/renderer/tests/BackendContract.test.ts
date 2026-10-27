import { expect, it } from 'node-test';
import { FakeRendererBackend, WebGL2RendererBackend } from '../src/index';

it('records frames without exposing GPU objects', () => {
  const backend = new FakeRendererBackend();
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
