import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/core';
import { ICERenderBatch } from '@ice3/runtime';
import type {
  ICEBenchmarkScenarioId,
  ICEBenchmarkScene,
} from './types.js';

const SHARED_MATERIAL = new ICEBasicMaterial({ color: '#2f81f7' });
const SHARED_BOX = new ICEBoxGeometry({
  width: 1,
  height: 1,
  depth: 1,
});

export function benchmarkScene(
  scenario: ICEBenchmarkScenarioId,
): ICEBenchmarkScene {
  switch (scenario) {
    case 'unique-meshes':
    case 'picking':
      return uniqueMeshScene(scenario === 'picking' ? 100 : 0);
    case 'instanced-grid':
      return instancedScene(10_000);
    case 'instanced-50k':
      return instancedScene(50_000);
    case 'culling-20k':
      return cullingScene();
    case 'static-batches':
      return batchScene();
    case 'selection':
      return uniqueMeshScene(0, true);
    case 'wastewater-mixed':
    case 'wastewater-1x':
    case 'wastewater-5x':
    case 'wastewater-20x':
      return {
        ...emptyScene(),
        assetUrl: '/assets/wastewater-plant/tiled/tileset.json',
        scale: scenario === 'wastewater-20x'
          ? 20
          : scenario === 'wastewater-5x'
            ? 5
            : 1,
      };
  }
}

function uniqueMeshScene(
  pickCount: number,
  withSelection = false,
): ICEBenchmarkScene {
  const scene = new ICEScene({ id: 'benchmark-unique-meshes' });
  const selection: string[] = [];
  for (let index = 0; index < 2000; index += 1) {
    const id = `benchmark/mesh/${index.toString().padStart(4, '0')}`;
    const mesh = new ICEMesh({
      id,
      selectionId: id,
      geometry: SHARED_BOX,
      material: SHARED_MATERIAL,
      position: [(index % 50) * 2, 0, Math.floor(index / 50) * 2],
    });
    scene.addChild(mesh);
    if (withSelection && index % 4 === 0) selection.push(id);
  }
  return {
    scene,
    camera: benchmarkCamera(),
    meshCount: 2000,
    instanceCount: 0,
    batchCount: 0,
    trianglesPerBatch: 0,
    selection,
    pickCount,
    scale: 1,
  };
}

function instancedScene(count: number): ICEBenchmarkScene {
  const scene = new ICEScene({ id: 'benchmark-instances' });
  const width = Math.ceil(Math.sqrt(count));
  const meshes: ICENode[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `benchmark/instance/${index.toString().padStart(5, '0')}`;
    meshes.push(new ICEMesh({
      id,
      selectionId: id,
      geometry: SHARED_BOX,
      material: SHARED_MATERIAL,
      position: [(index % width) * 1.4, 0, Math.floor(index / width) * 1.4],
    }));
  }
  scene.addChild(new BenchmarkMeshCollection(
    'benchmark/instance-collection',
    meshes,
  ));
  return {
    scene,
    camera: benchmarkCamera(),
    meshCount: 0,
    instanceCount: count,
    batchCount: 0,
    trianglesPerBatch: 0,
    selection: [],
    pickCount: 0,
    scale: 1,
  };
}

function cullingScene(): ICEBenchmarkScene {
  const scene = new ICEScene({ id: 'benchmark-culling' });
  const groupOffsets = [
    [0, 0, 0],
    [0, 0, -10_000],
    [10_000, 0, 0],
    [-10_000, 0, 0],
  ] as const;
  const meshes: ICENode[] = [];
  for (let group = 0; group < groupOffsets.length; group += 1) {
    const offset = groupOffsets[group]!;
    for (let index = 0; index < 5_000; index += 1) {
      const id = `benchmark/culling/${group}/${index}`;
      meshes.push(new ICEMesh({
        id,
        selectionId: id,
        geometry: SHARED_BOX,
        material: SHARED_MATERIAL,
        position: [
          offset[0] + (index % 50) * 2,
          offset[1],
          offset[2] + Math.floor(index / 50) * 2,
        ],
      }));
    }
  }
  scene.addChild(new BenchmarkMeshCollection(
    'benchmark/culling-collection',
    meshes,
  ));
  return {
    scene,
    camera: benchmarkCamera(),
    meshCount: 0,
    instanceCount: 20_000,
    batchCount: 0,
    trianglesPerBatch: 0,
    selection: [],
    pickCount: 0,
    scale: 1,
    visibleInstanceHint: 5_000,
  };
}

class BenchmarkMeshCollection extends ICENode {
  constructor(id: string, private readonly meshes: readonly ICENode[]) {
    super({ id });
  }

  override get children(): readonly ICENode[] {
    return this.meshes;
  }
}

function batchScene(): ICEBenchmarkScene {
  const scene = new ICEScene({ id: 'benchmark-batches' });
  const triangleIndices = new Uint32Array(30_000);
  for (let index = 0; index < 10_000; index += 1) {
    triangleIndices[index * 3] = 0;
    triangleIndices[index * 3 + 1] = 1;
    triangleIndices[index * 3 + 2] = 2;
  }
  for (let index = 0; index < 64; index += 1) {
    const selectionId = `benchmark/batch/equipment/${index}`;
    const geometry = new ICEIndexedGeometry({
      id: `benchmark/batch/geometry/${index}`,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: triangleIndices,
      semanticIndices: new Uint32Array([0, 0, 0]),
    });
    scene.addChild(new ICERenderBatch({
      id: `benchmark/batch/${index}`,
      position: [(index % 8) * 2, 0, Math.floor(index / 8) * 2],
      geometry,
      material: SHARED_MATERIAL,
      semanticIds: ['0'],
      semanticNodeIds: [`benchmark/node/${index}`],
      semanticSelectionIds: [selectionId],
      materialKey: '#2f81f7:',
    }));
  }
  return {
    scene,
    camera: benchmarkCamera(),
    meshCount: 0,
    instanceCount: 0,
    batchCount: 64,
    trianglesPerBatch: 10_000,
    selection: [],
    pickCount: 0,
    scale: 1,
  };
}

function emptyScene(): ICEBenchmarkScene {
  return {
    scene: new ICEScene({ id: 'benchmark-mixed' }),
    camera: benchmarkCamera(),
    meshCount: 0,
    instanceCount: 0,
    batchCount: 0,
    trianglesPerBatch: 0,
    selection: [],
    pickCount: 0,
    scale: 1,
  };
}

function benchmarkCamera(): ICEPerspectiveCamera {
  return new ICEPerspectiveCamera({
    id: 'benchmark-camera',
    fov: 45,
    near: 0.1,
    far: 5000,
    position: [100, 110, 140],
    target: [50, 0, 20],
  });
}
