import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGL2TextureCache } from '../src/WebGL2TextureCache.js';

type FakeGl = {
  readonly textures: number;
  readonly calls: string[];
} & Record<string, unknown>;

function fakeGl(): FakeGl {
  let next = 0;
  const state: FakeGl = {
    textures: 0,
    calls: [],
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    createTexture: () => {
      next += 1;
      state.textures += 1;
      state.calls.push('createTexture');
      return { id: next };
    },
    bindTexture: () => state.calls.push('bindTexture'),
    texImage2D: () => state.calls.push('texImage2D'),
    texParameteri: () => state.calls.push('texParameteri'),
    generateMipmap: () => state.calls.push('generateMipmap'),
    deleteTexture: () => {
      state.textures -= 1;
      state.calls.push('deleteTexture');
    },
  };
  return state;
}

function fakeImage(): ImageBitmap {
  return { close: () => {} } as unknown as ImageBitmap;
}

test('one texture per url, and repeated frames do not restart the load', async () => {
  const gl = fakeGl();
  let loads = 0;
  const cache = new WebGL2TextureCache(
    gl as unknown as WebGL2RenderingContext,
    async () => {
      loads += 1;
      return fakeImage();
    },
  );

  expect(cache.texture('a.png')).toBeNull();
  expect(cache.texture('a.png')).toBeNull();
  expect(loads).toBe(1);
  expect(cache.stats()).toMatchObject({ loaded: 0, pending: 1 });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const texture = cache.texture('a.png');
  expect(texture).not.toBeNull();
  expect(cache.stats()).toMatchObject({ loaded: 1, pending: 0 });
  expect(loads).toBe(1);
});

test('the upload callback fires so the runtime can schedule one more frame', async () => {
  const gl = fakeGl();
  let uploads = 0;
  const cache = new WebGL2TextureCache(
    gl as unknown as WebGL2RenderingContext,
    async () => fakeImage(),
    () => {
      uploads += 1;
    },
  );
  cache.texture('a.png');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uploads).toBe(1);
});

test('a failed load stays failed instead of retrying every frame', async () => {
  const gl = fakeGl();
  let loads = 0;
  const cache = new WebGL2TextureCache(
    gl as unknown as WebGL2RenderingContext,
    async () => {
      loads += 1;
      throw new Error('ICE3_TEXTURE_FETCH_FAILED');
    },
  );
  cache.texture('missing.png');
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.texture('missing.png');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(loads).toBe(1);
  expect(cache.stats()).toMatchObject({ loaded: 0, failed: 1 });
  expect(cache.texture('missing.png')).toBeNull();
});

test('dispose releases every uploaded texture', async () => {
  const gl = fakeGl();
  const cache = new WebGL2TextureCache(
    gl as unknown as WebGL2RenderingContext,
    async () => fakeImage(),
  );
  cache.texture('a.png');
  cache.texture('b.png');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gl.textures).toBe(2);
  cache.dispose();
  expect(gl.textures).toBe(0);
  expect(cache.texture('a.png')).toBeNull();
});

test('an upload that lands after dispose is thrown away', async () => {
  const gl = fakeGl();
  const cache = new WebGL2TextureCache(
    gl as unknown as WebGL2RenderingContext,
    async () => fakeImage(),
  );
  cache.texture('a.png');
  cache.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gl.textures).toBe(0);
});
