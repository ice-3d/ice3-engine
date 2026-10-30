import { describe, it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEEngineError,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEScene,
} from '../src/index';

const mesh = (id: string) =>
  new ICEMesh({
    id,
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  });

describe('scene ownership', () => {
  it('adds, finds, and removes nodes by stable ID', () => {
    const scene = new ICEScene({ id: 'scene' });
    const block = mesh('block');

    scene.addChild(block);
    expect(scene.findByID('block')).toBe(block);

    scene.removeChild(block);
    expect(scene.findByID('block')).toBeUndefined();
  });

  it('rejects duplicate IDs without changing the tree', () => {
    const scene = new ICEScene({ id: 'scene' });
    scene.addChild(mesh('same'));

    expect(() => scene.addChild(mesh('same'))).toThrowError(ICEEngineError);
    expect(scene.children).toHaveLength(1);
  });

  it('moves a node between parents without duplicating identity', () => {
    const scene = new ICEScene({ id: 'scene' });
    const first = mesh('first');
    const second = mesh('second');
    const child = mesh('child');
    scene.addChild(first).addChild(second);

    first.addChild(child);
    second.addChild(child);

    expect(first.children).toHaveLength(0);
    expect(second.children).toEqual([child]);
    expect(child.parent).toBe(second);
  });

  it('rejects parent cycles', () => {
    const root = mesh('root');
    const child = mesh('child');
    root.addChild(child);

    expect(() => child.addChild(root)).toThrowError(/cycle/i);
  });

  it('rejects a subtree containing an ID already owned by the scene', () => {
    const scene = new ICEScene({ id: 'scene' });
    scene.addChild(mesh('duplicate'));
    const branch = mesh('branch');
    branch.addChild(mesh('duplicate'));

    expect(() => scene.addChild(branch)).toThrowError(/duplicate/i);
    expect(scene.findByID('branch')).toBeUndefined();
    expect(scene.children).toHaveLength(1);
  });

  it('accepts general indexed geometry on a mesh', () => {
    const scene = new ICEScene({ id: 'scene' });
    const block = new ICEMesh({
      id: 'triangle',
      geometry: new ICEIndexedGeometry({
        id: 'triangle-geometry',
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
      }),
      material: new ICEBasicMaterial({ color: '#ffffff' }),
    });

    scene.addChild(block);
    expect(scene.findByID('triangle')).toBe(block);
  });

  it('uses a supplied local matrix without decomposing it', () => {
    const node = new ICENode({
      id: 'asset-node',
      position: [99, 99, 99],
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        2, 3, 4, 1,
      ],
    });

    expect(node.getWorldPosition().toArray()).toEqual([2, 3, 4]);
  });

  it('uses display names for presentation and falls back to stable IDs', () => {
    expect(new ICENode({ id: 'motor-1', displayName: '一号泵' }).displayName)
      .toBe('一号泵');
    expect(new ICENode({ id: 'motor-2' }).displayName).toBe('motor-2');
  });

  it('defaults mesh selection identity to its stable ID', () => {
    const node = new ICEMesh({
      id: 'motor-3',
      geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
      material: new ICEBasicMaterial({ color: '#ffffff' }),
    });
    expect(node.selectionId).toBe('motor-3');
  });

  it('accepts a shared selection identity for multiple mesh primitives', () => {
    const geometry = new ICEIndexedGeometry({
      id: 'shared-geometry',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const material = new ICEBasicMaterial({ color: '#ffffff' });
    const first = new ICEMesh({
      id: 'motor-4/primitive/0',
      selectionId: 'motor-4',
      geometry,
      material,
    });
    const second = new ICEMesh({
      id: 'motor-4/primitive/1',
      selectionId: 'motor-4',
      geometry,
      material,
    });
    expect([first.selectionId, second.selectionId])
      .toEqual(['motor-4', 'motor-4']);
  });
});

describe('scene revision', () => {
  it('changes for structure, visibility, and local transform mutations', () => {
    const scene = new ICEScene({ id: 'scene' });
    const node = mesh('revision-node');
    const initial = scene.revision;

    scene.addChild(node);
    const added = scene.revision;
    node.visible = false;
    const hidden = scene.revision;
    node.setLocalMatrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      4, 0, 0, 1,
    ]);
    const transformed = scene.revision;
    scene.removeChild(node);

    expect(added).toBeGreaterThan(initial);
    expect(hidden).toBeGreaterThan(added);
    expect(transformed).toBeGreaterThan(hidden);
    expect(scene.revision).toBeGreaterThan(transformed);
  });

  it('does not change when values are identical', () => {
    const scene = new ICEScene({ id: 'scene' });
    const node = mesh('stable-node');
    scene.addChild(node);
    const revision = scene.revision;
    node.visible = true;
    expect(scene.revision).toBe(revision);
  });

  it('changes the old and new roots when moving a subtree', () => {
    const first = new ICEScene({ id: 'first' });
    const second = new ICEScene({ id: 'second' });
    const branch = mesh('branch');
    first.addChild(branch);
    const firstRevision = first.revision;
    const secondRevision = second.revision;

    second.addChild(branch);

    expect(first.revision).toBeGreaterThan(firstRevision);
    expect(second.revision).toBeGreaterThan(secondRevision);
  });

  it('changes when a local matrix override is cleared', () => {
    const scene = new ICEScene({ id: 'scene' });
    const node = mesh('clear-matrix-node');
    scene.addChild(node);
    node.setLocalMatrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      4, 0, 0, 1,
    ]);
    const transformed = scene.revision;
    node.clearLocalMatrix();
    expect(scene.revision).toBeGreaterThan(transformed);
  });
});
