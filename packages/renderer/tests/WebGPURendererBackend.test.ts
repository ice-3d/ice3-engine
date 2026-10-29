import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';
import {
  WebGPURendererBackend,
  type ICEFrame,
} from '../src/index';
import { fakeWebGPUDevice } from './fake-webgpu';

it('configures the canvas and renders a clear frame', async () => {
  const fake = fakeWebGPUDevice();
  const canvas = fake.canvas();
  const backend = await WebGPURendererBackend.create(fake.context);

  backend.initialize({ canvas });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);
  backend.render(emptyFrame());

  expect(fake.contexts[0]?.configuration).toMatchObject({
    device: fake.context.device,
    format: 'bgra8unorm',
    alphaMode: 'premultiplied',
  });
  expect(fake.submissions).toHaveLength(1);
  expect(fake.renderPasses[0]?.clearValue).toEqual({
    r: 0.035,
    g: 0.055,
    b: 0.09,
    a: 1,
  });
  expect(backend.stats.drawCalls).toBe(0);
  expect(backend.capabilities.backend).toBe('webgpu');
});

it('draws one mesh and reports its renderer statistics', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await WebGPURendererBackend.create(fake.context);
  backend.initialize({ canvas: fake.canvas() });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);

  backend.render(meshFrame());

  expect(fake.draws).toMatchObject([{ indexCount: 36, instanceCount: 1 }]);
  expect(backend.stats).toMatchObject({
    drawCalls: 1,
    renderedMeshes: 1,
    renderedBatches: 0,
    instancingFallbacks: 0,
    gpuUploads: 3,
  });
});

it('resolves a backend pick through the stable selection identity', async () => {
  const fake = fakeWebGPUDevice({
    pickPixel: new Uint8Array([1, 0, 0, 255]),
  });
  const backend = await WebGPURendererBackend.create(fake.context);
  backend.initialize({ canvas: fake.canvas() });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);

  await expect(
    backend.pick(meshFrame(), { x: 160, y: 90 }),
  ).resolves.toBe('box');
});

it('waits for submitted WebGPU work to finish', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await WebGPURendererBackend.create(fake.context);
  backend.initialize({ canvas: fake.canvas() });

  await backend.finish();

  expect(fake.submittedWorkWaitCount()).toBe(1);
});

it('releases the cached probe when the backend is disposed', async () => {
  const fake = fakeWebGPUDevice();
  let released = false;
  const backend = await WebGPURendererBackend.create({
    ...fake.context,
    release: () => {
      released = true;
    },
  });
  backend.initialize({ canvas: fake.canvas() });

  backend.dispose();

  expect(released).toBe(true);
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

function meshFrame(): ICEFrame {
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'box',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  }));
  return {
    ...emptyFrame(),
    scene,
  };
}
