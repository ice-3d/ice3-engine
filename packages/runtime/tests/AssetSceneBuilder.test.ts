import { expect, it } from 'node-test';
import type { ICEPreparedAssetSnapshot } from '@ice3/assets';
import { ICEMesh } from '@ice3/core';
import { buildAssetScene } from '../src/asset/ICEAssetSceneBuilder';

const snapshotWithEdges: ICEPreparedAssetSnapshot = {
  assetId: 'fixture',
  bounds: { min: [0, 0, 0], max: [3, 1, 0] },
  stats: { nodeCount: 2, meshCount: 1, triangleCount: 1 },
  nodes: [
    {
      id: 'root',
      name: 'root',
      parent: null,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      visible: true,
    },
    {
      id: 'root/motor',
      name: 'motor',
      parent: 0,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1],
      visible: true,
    },
  ],
  geometries: [{
    id: 'fixture/geometry',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    edgeIndices: new Uint16Array([
      0, 1, 1, 2, 2, 0,
      0, 1, 1, 2, 2, 0,
      0, 1, 1, 2, 2, 0,
      0, 1, 1, 2, 2, 0,
    ]),
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  }],
  materials: [{
    id: 'fixture/material',
    baseColor: '#2f81f7',
    edgeColor: '#e6f2ff',
  }],
  meshes: [{
    id: 'fixture/mesh',
    node: 1,
    geometry: 0,
    material: 0,
  }],
};

it('instantiates the prepared node hierarchy and triangle primitive', () => {
  const built = buildAssetScene(snapshotWithEdges);
  const node = built.scene.findByID('root/motor') as ICEMesh;
  const root = built.scene.findByID('root')!;

  expect(node.geometry.indices).toEqual(new Uint32Array([0, 1, 2]));
  expect(node.getWorldPosition().toArray()).toEqual([2, 0, 0]);
  expect(root.displayName).toBe('root');
  expect(built.stats).toEqual({
    nodeCount: 2,
    meshCount: 1,
    triangleCount: 1,
  });
});

it('combines triangle and edge accessors in one ICE mesh', () => {
  const built = buildAssetScene(snapshotWithEdges);
  const mesh = built.scene.findByID('root/motor') as ICEMesh;

  expect(mesh.geometry.edgeIndices).toHaveLength(24);
  expect(mesh.material.edgeColor).toBe('#e6f2ff');
});

it('preserves prepared display names and equipment identity', () => {
  const built = buildAssetScene({
    ...snapshotWithEdges,
    nodes: [
      { ...snapshotWithEdges.nodes[0]!, name: 'Factory Root' },
      snapshotWithEdges.nodes[1]!,
    ],
  });
  const mesh = built.scene.findByID('root/motor') as ICEMesh;
  expect(mesh.displayName).toBe('motor');
  expect(mesh.selectionId).toBe('root/motor');
  expect(built.scene.findByID('root')?.displayName).toBe('Factory Root');
});

it('keeps secondary primitives in the same equipment selection group', () => {
  const snapshot = {
    ...snapshotWithEdges,
    meshes: [
      ...snapshotWithEdges.meshes,
      {
        id: 'fixture/mesh/extra',
        node: 1,
        geometry: 0,
        material: 0,
      },
    ],
  };
  const built = buildAssetScene(snapshot);
  const sourceNode = built.scene.findByID('root/motor') as ICEMesh;
  const secondary = sourceNode.children[0] as ICEMesh;
  expect(secondary.selectionId).toBe('root/motor');
  expect(secondary.displayName).toBe('motor');
});
