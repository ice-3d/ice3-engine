import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { fn } from '../../../tests/test-mocks.ts';
import {
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';
import type { ICEFrame } from '../src/index';
import { fakeWebGPUDevice, readyBackend } from './fake-webgpu';

it('replaces the depth texture after resize without leaking the old texture', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.resize({ x: 0, y: 0, width: 200, height: 100 }, 1);
  const first = fake.depthTextures.at(-1);
  backend.resize({ x: 0, y: 0, width: 400, height: 200 }, 1);
  expect(first?.destroyed).toBe(true);
  expect(fake.depthTextures.at(-1)?.size).toEqual([400, 200]);
});

it('ignores the lost promise triggered by deliberate disposal', async () => {
  const fake = fakeWebGPUDevice();
  const onLost = fn();
  const backend = await readyBackend(fake, { onContextLost: onLost });
  backend.dispose();
  await fake.loseDevice('destroyed');
  expect(onLost).not.toHaveBeenCalled();
});

it('reports a non-deliberate Device Lost and restores resources', async () => {
  const fake = fakeWebGPUDevice();
  const onLost = fn();
  const onRestored = fn();
  await readyBackend(fake, {
    onContextLost: onLost,
    onContextRestored: onRestored,
  });

  await fake.loseDevice('unknown');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onLost).toHaveBeenCalledTimes(1);
  expect(onRestored).not.toHaveBeenCalled();

  await fake.completeReplacementDevice();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onRestored).toHaveBeenCalledTimes(1);
});

it('captures a PNG from the presented texture', async () => {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    'OffscreenCanvas',
  );
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { putImageData() {} };
      }

      async convertToBlob() {
        return new Blob([], { type: 'image/png' });
      }
    },
  });
  try {
    const fake = fakeWebGPUDevice({
      capturePixel: [47, 81, 247, 255],
    });
    const backend = await readyBackend(fake);
    backend.render(emptyFrame());
    const blob = await backend.capture();
    expect(blob.type).toBe('image/png');
    expect(fake.captureCopyCount()).toBe(1);
    expect(fake.lastMappedBytes().slice(0, 4)).toEqual(
      new Uint8Array([47, 81, 247, 255]),
    );
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    } else {
      delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    }
  }
});

function emptyFrame(): ICEFrame {
  return {
    frameId: 1,
    scene: new ICEScene({ id: 'scene' }),
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 4],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection: [],
  };
}
