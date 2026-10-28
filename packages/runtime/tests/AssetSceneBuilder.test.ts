import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import type { ICEPreparedAssetSnapshot } from '@ice3/assets';
import { ICEMesh, ICENode } from '@ice3/core';
import { buildAssetScene } from '../src/asset/ICEAssetSceneBuilder';
import { ICERenderBatch } from '../src/asset/ICERenderBatch';

const snapshotWithEdges: ICEPreparedAssetSnapshot = {
  assetId: 'fixture',
  bounds: { min: [0, 0, 0], max: [3, 1, 0] },
  stats: { nodeCount: 2, meshCount: 1, triangleCount: 1 },
  nodes: [
    {
      id: 'root',
      selectionId: 'root',
      name: 'root',
      parent: null,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      visible: true,
    },
    {
      id: 'root/motor',
      selectionId: 'root/motor',
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

it('uses selection identity independently from the LOD node ID', () => {
  const mesh = buildAssetScene({
    ...snapshotWithEdges,
    nodes: [
      snapshotWithEdges.nodes[0]!,
      {
        ...snapshotWithEdges.nodes[1]!,
        id: 'overview/node/1',
        selectionId: 'source/node/1',
      },
    ],
  }).scene.findByID('overview/node/1') as ICEMesh;

  expect(mesh.selectionId).toBe('source/node/1');
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

it('builds semantic nodes and batches without duplicate drawable devices', () => {
  const snapshot: ICEPreparedAssetSnapshot = {
    assetId: 'batched',
    bounds: { min: [0, 0, 0], max: [2, 1, 0] },
    stats: {
      nodeCount: 2,
      maxNodeDepth: 0,
      meshCount: 1,
      primitiveCount: 1,
      triangleCount: 2,
      edgeSegmentCount: 0,
      materialCount: 1,
      selectionGroupCount: 1,
    },
    contract: { status: 'legacy' },
    nodes: [
      {
        id: 'asset/node/0',
        selectionId: 'asset/node/0',
        name: 'semantic-device',
        parent: null,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        visible: true,
      },
      {
        id: 'asset/render-batch-node/0',
        selectionId: 'asset/render-batch-node/0',
        name: 'render-batch-0',
        parent: null,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        visible: true,
      },
    ],
    geometries: [{
      id: 'asset/batch/geometry',
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
        1, 0, 0, 1, 1, 0, 0, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      semanticIndices: new Uint32Array([0, 0, 0, 0, 0, 0]),
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    }],
    materials: [{ id: 'asset/batch/material', baseColor: '#ffffff' }],
    meshes: [{
      id: 'asset/batch/mesh',
      node: 1,
      geometry: 0,
      material: 0,
    }],
    batching: {
      version: '1.0',
      semanticIds: ['semantic:0'],
      semanticNodeIds: ['asset/node/0'],
      semanticSelectionIds: ['asset/node/0'],
      batches: [{
        id: 'batch:0',
        mesh: 0,
        primitive: 0,
        material: 0,
        mode: 4,
        triangleCount: 2,
        bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      }],
    },
  };
  const built = buildAssetScene(snapshot);
  const semantic = built.scene.findByID('asset/node/0');
  const batch = built.scene.findByID('asset/render-batch-node/0');

  expect(semantic).toBeInstanceOf(ICENode);
  expect(semantic).not.toBeInstanceOf(ICEMesh);
  expect(semantic?.selectionId).toBe('asset/node/0');
  expect(batch).toBeInstanceOf(ICERenderBatch);
  expect(batch?.children).toHaveLength(0);
});
