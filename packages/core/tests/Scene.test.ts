import { describe, expect, it } from 'node-test';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEEngineError,
  ICEMesh,
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
});
