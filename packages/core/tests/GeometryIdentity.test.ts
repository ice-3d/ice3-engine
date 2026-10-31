import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEIndexedGeometry } from '../src/index';

it('derives stable geometry identity from the legacy ID', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'legacy/geometry',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });

  expect(geometry.identity).toEqual({
    geometryId: 'legacy/geometry',
    topologyDigest: '',
    attributeDigest: '',
  });
  expect(Object.isFrozen(geometry.identity)).toBe(true);
});

it('preserves packet geometry identity independently from the object ID', () => {
  const identity = {
    geometryId: 'component/body',
    topologyDigest: 'b'.repeat(64),
    attributeDigest: 'c'.repeat(64),
  };
  const geometry = new ICEIndexedGeometry({
    id: 'instance/42',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    identity,
  });

  expect(geometry.identity).toEqual(identity);
  expect(geometry.identity).not.toBe(identity);
});
