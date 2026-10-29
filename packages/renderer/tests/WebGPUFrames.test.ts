import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
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

it('draws selection tint and selected edges only for selected identities', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(selectedBoxFrame('pump'));
  expect(fake.selectionDraws).toHaveLength(2);
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

function repeatedBoxFrame(count: number): ICEFrame {
  return sceneFrame(Array.from({ length: count }, (_, index) => (
    new ICEMesh({
      id: `copy-${index}`,
      selectionId: `copy-${index}`,
      geometry: sharedBoxGeometry,
      material: instanceMaterial,
      position: [index, 0, 0],
    })
  )));
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

function selectedBoxFrame(id: string): ICEFrame {
  return sceneFrame([boxMesh(id)], [id]);
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
