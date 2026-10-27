import { expect, it } from 'node-test';
import { ICEIndexedGeometry } from '../src/index';

it('derives bounds and rejects invalid indices', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });

  expect(geometry.getBounds()).toEqual({
    min: [0, 0, 0],
    max: [2, 3, 0],
  });
  expect(() => new ICEIndexedGeometry({
    id: 'broken',
    positions: geometry.positions,
    indices: new Uint16Array([0, 1, 3]),
  })).toThrow(/index/i);
});

it('serializes stable geometry identity and edge indices', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    edgeIndices: new Uint16Array([0, 1, 1, 2, 2, 0]),
  });

  expect(geometry.toJSON()).toEqual({
    typeId: 'ice3:IndexedGeometry',
    id: 'triangle',
    positionCount: 3,
    indexCount: 3,
    edgeIndexCount: 6,
    colorCount: 0,
    bounds: {
      min: [0, 0, 0],
      max: [1, 1, 0],
    },
  });
});

it('carries optional per-vertex display colors', () => {
  const colors = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  const geometry = new ICEIndexedGeometry({
    id: 'colored',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    colors,
  });

  expect(geometry.colors).toBe(colors);
  expect(geometry.toJSON().colorCount).toBe(3);
  expect(() => new ICEIndexedGeometry({
    id: 'broken-colors',
    positions: geometry.positions,
    indices: geometry.indices,
    colors: new Float32Array([1, 0, 0]),
  })).toThrow(/color/i);
});
