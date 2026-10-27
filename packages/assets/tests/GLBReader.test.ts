import { expect, it } from 'node-test';
import { readPreparedGLB } from '../src/index';
import {
  createMinimalPreparedGLB,
  createOrdinaryGLB,
  createOutOfRangeAccessorGLB,
  createTRSNodeGLB,
} from './createFixture';

it('reads a prepared triangle asset with zero-copy accessor views', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  expect(snapshot.assetId).toBe('fixture');
  expect(snapshot.geometries[0]!.positions).toBeInstanceOf(Float32Array);
  expect(snapshot.geometries[0]!.indices).toEqual(new Uint16Array([0, 1, 2]));
  expect(snapshot.geometries[0]!.edgeIndices).toEqual(
    new Uint16Array([0, 1, 1, 2, 2, 0]),
  );
});

it('rejects an ordinary GLB without the ICE3 profile', () => {
  expect(() => readPreparedGLB(createOrdinaryGLB())).toThrowError(
    /ICE3_ASSET_PROFILE_UNSUPPORTED/,
  );
});

it('rejects an accessor extending past the BIN chunk', () => {
  expect(() => readPreparedGLB(createOutOfRangeAccessorGLB())).toThrowError(
    /ICE3_ASSET_ACCESSOR_INVALID/,
  );
});

it('rejects node TRS when the ICE3 profile requires matrix transforms', () => {
  expect(() => readPreparedGLB(createTRSNodeGLB())).toThrowError(
    /ICE3_ASSET_PROFILE_UNSUPPORTED/,
  );
});
