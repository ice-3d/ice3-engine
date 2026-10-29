import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';
import type { ICEFrame } from '../src/index';
import { fakeWebGPUDevice, readyBackend } from './fake-webgpu';

it('renders one instanced draw for repeated geometry', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(repeatedBoxFrame(4));
  expect(backend.stats).toMatchObject({
    drawCalls: 1,
    renderedMeshes: 0,
    instancingFallbacks: 0,
  });
  expect(fake.draws[0]?.instanceCount).toBe(4);
});

it('renders static and adaptive batches through the same batch pipeline', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(batchedFrame(2));
  expect(backend.stats.renderedBatches).toBe(2);
  expect(fake.draws).toHaveLength(2);
});

it('does not add one triangle draw per selected instance', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(repeatedBoxFrame(
    2000,
    Array.from({ length: 500 }, (_, index) => `copy-${index * 4}`),
  ));
  expect(backend.stats.drawCalls).toBe(1);
  expect(fake.draws).toHaveLength(1);
  expect(fake.selectionDraws).toHaveLength(0);
});

it('draws one masked selection edge overlay per selected batch', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(selectedBatchFrame());
  expect(fake.draws.filter((draw) => (
    draw.pipeline === 'selection:line'
  ))).toHaveLength(5);
  expect(fake.draws.some((draw) => (
    draw.pipeline === 'selection:triangle'
  ))).toBe(false);
});

it('falls back to per-object selection when the mask layout fails', async () => {
  const fake = fakeWebGPUDevice({ selectionMaskLayoutFails: true });
  const errors: Error[] = [];
  const backend = await readyBackend(fake, {
    onError: (error) => errors.push(error),
  });
  backend.render(selectedBoxFrame('pump'));

  expect(new Set(fake.draws.map((draw) => draw.pipeline))).toEqual(
    new Set([
      'main:triangle',
      'main:line',
      'selection:triangle',
      'selection:line',
    ]),
  );
  expect(backend.stats.drawCalls).toBe(12);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    code: 'ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE',
  });
});

it('reuses a render bundle across camera and selection content changes', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  const first = repeatedBoxFrame(4, ['copy-1']);
  backend.render(first);
  backend.render({
    ...first,
    camera: new ICEPerspectiveCamera({
      id: 'camera-2',
      position: [1, 2, 10],
      target: [0, 0, 0],
    }),
    selection: ['copy-2'],
  });

  expect(fake.bundleEncoders).toHaveLength(1);
  expect(fake.executedBundles).toHaveLength(2);
});

it('rebuilds a render bundle after the Scene revision changes', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  const frame = repeatedBoxFrame(2);
  backend.render(frame);
  frame.scene.addChild(new ICEMesh({
    id: 'extra',
    geometry: sharedBoxGeometry,
    material: instanceMaterial,
  }));
  backend.render(frame);

  expect(fake.bundleEncoders).toHaveLength(2);
});

it('reports one bundle warning and falls back to direct draws', async () => {
  const fake = fakeWebGPUDevice({ bundleCreationFails: true });
  const errors: Error[] = [];
  const backend = await readyBackend(fake, {
    onError: (error) => errors.push(error),
  });
  backend.render(repeatedBoxFrame(2));
  backend.render(repeatedBoxFrame(2));

  expect(fake.draws.length).toBeGreaterThan(0);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    code: 'ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE',
  });
});

it('uses the storage pipeline when the device and override support it', async () => {
  const fake = fakeWebGPUDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 1 << 20,
      minStorageBufferOffsetAlignment: 256,
    },
  });
  const backend = await readyBackend(fake, {}, {
    forceStoragePath: true,
  });
  backend.render(repeatedBoxFrame(2));

  expect(fake.draws[0]?.pipeline).toContain('storage');
});

it('falls back to vertex attributes when storage pipeline creation fails', async () => {
  const fake = fakeWebGPUDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 1 << 20,
      minStorageBufferOffsetAlignment: 256,
    },
    storagePipelineFails: true,
  });
  const errors: Error[] = [];
  const backend = await readyBackend(fake, {
    onError: (error) => errors.push(error),
  }, {
    forceStoragePath: true,
  });
  backend.render(repeatedBoxFrame(2));

  expect(fake.draws[0]?.pipeline).not.toContain('storage');
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    code: 'ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE',
  });
});

function boxMesh(id: string): ICEMesh {
  return new ICEMesh({
    id,
    selectionId: id,
    geometry: sharedBoxGeometry,
    material: sharedMaterial,
  });
}

function sceneFrame(
  children: readonly ICENode[],
  selection: readonly string[] = [],
): ICEFrame {
  const scene = new ICEScene({ id: 'scene' });
  for (const child of children) scene.addChild(child);
  return {
    frameId: 1,
    scene,
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 10],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection,
  };
}

function repeatedBoxFrame(
  count: number,
  selection: readonly string[] = [],
): ICEFrame {
  return sceneFrame(Array.from({ length: count }, (_, index) => (
    new ICEMesh({
      id: `copy-${index}`,
      selectionId: `copy-${index}`,
      geometry: sharedBoxGeometry,
      material: instanceMaterial,
      position: [index, 0, 0],
    })
  )), selection);
}

class TestRenderBatch extends ICENode {
  override get typeId(): string {
    return 'ice3:RenderBatch';
  }

  readonly geometry = sharedBoxGeometry;
  readonly material = instanceMaterial;
  readonly semanticIds = ['0', '1'];
  readonly semanticNodeIds = ['node-0', 'node-1'];
  readonly semanticSelectionIds = ['equipment-0', 'equipment-1'];
  readonly materialKey = '#2f81f7:#ffffff';
}

function batchedFrame(count: number): ICEFrame {
  return sceneFrame(Array.from(
    { length: count },
    (_, index) => new TestRenderBatch({ id: `batch-${index}` }),
  ));
}

function selectedBatchFrame(): ICEFrame {
  return sceneFrame([
    new TestEdgeRenderBatch({ id: 'batch-selected' }),
  ], ['equipment-0', 'equipment-1']);
}

function selectedBoxFrame(id: string): ICEFrame {
  return sceneFrame([boxMesh(id)], [id]);
}

class TestEdgeRenderBatch extends ICENode {
  override get typeId(): string {
    return 'ice3:RenderBatch';
  }

  readonly geometry = edgeBatchGeometry;
  readonly material = new ICEBasicMaterial({
    color: '#2f81f7',
    edgeColor: '#ffffff',
  });
  readonly semanticIds = ['0', '1'];
  readonly semanticNodeIds = ['node-0', 'node-1'];
  readonly semanticSelectionIds = ['equipment-0', 'equipment-1'];
  readonly materialKey = '#2f81f7:#ffffff';
}

const sharedMaterial = new ICEBasicMaterial({
  color: '#2f81f7',
  edgeColor: '#ffffff',
});
const instanceMaterial = new ICEBasicMaterial({ color: '#2f81f7' });
const sharedBoxGeometry = new ICEBoxGeometry({
  width: 1,
  height: 1,
  depth: 1,
});
const edgeBatchGeometry = new ICEIndexedGeometry({
  id: 'edge-batch-geometry',
  positions: new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
    -1, -1, 0.1,
    1, -1, 0.1,
    0, 1, 0.1,
  ]),
  indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
  edgeIndices: new Uint16Array([0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3]),
  semanticIndices: new Uint32Array([0, 0, 0, 1, 1, 1]),
});
