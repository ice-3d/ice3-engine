import { it } from 'node:test';
import { expect } from '../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { cloneBenchmarkScene } from './cloneScene';

it('clones geometry references with unique node and selection IDs', () => {
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const source = new ICEScene({ id: 'source' });
  source.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry,
    material,
  }));

  const cloned = cloneBenchmarkScene(source, 2);
  const meshes = cloned.children.flatMap((copy) => copy.children);

  expect(meshes).toHaveLength(2);
  expect(new Set(meshes.map((node) => node.id)).size).toBe(2);
  expect(new Set(meshes.map((node) => (
    node as ICEMesh
  ).selectionId)).size).toBe(2);
  expect((meshes[0] as ICEMesh).geometry).toBe(geometry);
});
