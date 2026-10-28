import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
  ICETypeRegistry,
  deserializeScene,
  serializeScene,
} from '../src/index';

it('round-trips stable IDs and type IDs', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);

  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(
    new ICEMesh({
      id: 'block',
      geometry: new ICEBoxGeometry({ width: 2, height: 3, depth: 4 }),
      material: new ICEBasicMaterial({ color: '#ffffff' }),
    }),
  );

  const snapshot = serializeScene(scene);
  expect(snapshot.schemaVersion).toBe(1);

  const restored = deserializeScene(snapshot, registry);
  expect(restored.report.errors).toEqual([]);
  expect(restored.scene.findByID('block')?.typeId).toBe('ice3:Mesh');
});

it('reports unknown types and continues with valid siblings', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const snapshot = {
    schemaVersion: 1 as const,
    typeId: 'ice3:Scene' as const,
    scene: {
      id: 'scene',
      typeId: 'ice3:Scene',
      visible: true,
      children: [
        {
          id: 'unknown',
          typeId: 'custom:Unknown',
          visible: true,
          children: [],
        },
        {
          id: 'block',
          typeId: 'ice3:Mesh',
          visible: true,
          children: [],
          geometry: { typeId: 'ice3:BoxGeometry', width: 1, height: 1, depth: 1 },
          material: { typeId: 'ice3:BasicMaterial', color: '#ffffff' },
        },
      ],
    },
  };

  const restored = deserializeScene(snapshot, registry);
  expect(restored.report.errors.map((item) => item.code)).toContain(
    'ICE3_UNKNOWN_TYPE',
  );
  expect(restored.scene.findByID('unknown')).toBeUndefined();
  expect(restored.scene.findByID('block')).toBeDefined();
});

it('reports malformed registered nodes without throwing', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const snapshot = {
    schemaVersion: 1 as const,
    typeId: 'ice3:Scene' as const,
    scene: {
      id: 'scene',
      typeId: 'ice3:Scene',
      visible: true,
      position: [0, 0, 0] as const,
      rotation: [0, 0, 0] as const,
      scale: [1, 1, 1] as const,
      children: [
        {
          id: 'broken',
          typeId: 'ice3:Mesh',
          visible: true,
          position: [0, 0, 0] as const,
          rotation: [0, 0, 0] as const,
          scale: [1, 1, 1] as const,
          children: [],
          geometry: { typeId: 'ice3:BoxGeometry', width: 0, height: 1, depth: 1 },
          material: { typeId: 'ice3:BasicMaterial', color: '#ffffff' },
        },
      ],
    },
  };

  const restored = deserializeScene(snapshot, registry);
  expect(restored.report.errors.map((item) => item.code)).toContain(
    'ICE3_INVALID_NODE_DATA',
  );
  expect(restored.scene.findByID('broken')).toBeUndefined();
});

it('round-trips optional material edge color', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(
    new ICEMesh({
      id: 'block',
      geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
      material: new ICEBasicMaterial({
        color: '#2f81f7',
        edgeColor: '#e6f2ff',
      }),
    }),
  );

  const snapshot = serializeScene(scene);
  const restored = deserializeScene(snapshot, registry);
  const block = restored.scene.findByID('block') as ICEMesh;

  expect(block.material.edgeColor).toBe('#e6f2ff');
});

it('round-trips semantic node metadata', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'pump',
    metadata: {
      equipmentTag: 'P-101',
      area: 'IntakeArea',
      ports: ['suction', 'discharge'],
    },
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  }));

  const restored = deserializeScene(serializeScene(scene), registry);
  expect(restored.scene.findByID('pump')?.metadata).toEqual({
    equipmentTag: 'P-101',
    area: 'IntakeArea',
    ports: ['suction', 'discharge'],
  });
});

it('round-trips a matrix-native mesh transform', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(
    new ICEMesh({
      id: 'block',
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        2, 3, 4, 1,
      ],
      geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
      material: new ICEBasicMaterial({ color: '#ffffff' }),
    }),
  );

  const restored = deserializeScene(serializeScene(scene), registry);
  const block = restored.scene.findByID('block') as ICEMesh;

  expect(block.getWorldPosition().toArray()).toEqual([2, 3, 4]);
});

it('round-trips display and equipment selection names', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'motor-part',
    displayName: '一号泵',
    selectionId: 'motor-group',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));

  const restored = deserializeScene(serializeScene(scene), registry);
  const mesh = restored.scene.findByID('motor-part') as ICEMesh;
  expect(mesh.displayName).toBe('一号泵');
  expect(mesh.selectionId).toBe('motor-group');
});
