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
  WebGPUGeometryCache,
  WebGPUPicker,
  type ICEFrame,
  type ICEScreenPoint,
} from '../src/index';
import { fakeWebGPUDevice } from './fake-webgpu';

it('resolves a visible pick ID after async buffer mapping', async () => {
  const fake = fakeWebGPUDevice({
    pickPixel: new Uint8Array([3, 0, 0, 255]),
  });
  const picker = new WebGPUPicker(fake.device, 'bgra8unorm');
  const result = picker.pick(
    pickFrame(),
    new WebGPUGeometryCache({ device: fake.device }),
    {
      1: 'a',
      2: 'b',
      3: 'pump',
    },
  );
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe('pump');
});

it('maps CSS top-left Y coordinates to WebGPU texture coordinates', async () => {
  const fake = fakeWebGPUDevice();
  const picker = new WebGPUPicker(fake.device, 'bgra8unorm');
  await picker.pick(
    pickFrame({ point: { x: 20, y: 30 }, dpr: 2 }),
    new WebGPUGeometryCache({ device: fake.device }),
    {},
  );
  expect(fake.copyCalls[0]).toMatchObject({ origin: { x: 40, y: 60 } });
});

it('uses a normalized RGBA pick target independent of the canvas format', async () => {
  const fake = fakeWebGPUDevice();
  const picker = new WebGPUPicker(fake.device, 'bgra8unorm');
  await picker.pick(
    pickFrame(),
    new WebGPUGeometryCache({ device: fake.device }),
    {},
  );
  expect(
    fake.depthTextures.find((texture) => texture.label === 'ice3:pick-target')
      ?.format,
  ).toBe('rgba8unorm');
});

function pickFrame(
  overrides: Partial<ICEFrame & { readonly point: ICEScreenPoint }> = {},
): ICEFrame & { readonly point: ICEScreenPoint } {
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));
  return {
    frameId: 1,
    scene,
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 4],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection: [],
    point: { x: 160, y: 90 },
    ...overrides,
  };
}
