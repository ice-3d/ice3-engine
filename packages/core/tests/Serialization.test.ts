import { expect, it } from 'node-test';
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
