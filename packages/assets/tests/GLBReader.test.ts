import { expect, it } from 'node-test';
import { readPreparedGLB } from '../src/index';
import {
  createMinimalPreparedGLB,
  createOddAccessorOffsetGLB,
  createForbiddenFeatureGLB,
  createDuplicateMeshIdGLB,
  createInvalidPrimitiveModeGLB,
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

it('rejects misaligned accessor component offsets with a profile diagnostic', () => {
  expect(() => readPreparedGLB(createOddAccessorOffsetGLB())).toThrowError(
    /ICE3_ASSET_ACCESSOR_INVALID/,
  );
});

it('rejects animation and texture content outside the M1 profile', () => {
  expect(() => readPreparedGLB(createForbiddenFeatureGLB())).toThrowError(
    /ICE3_ASSET_UNSUPPORTED_FEATURE/,
  );
});

it('rejects duplicate mesh semantic IDs', () => {
  expect(() => readPreparedGLB(createDuplicateMeshIdGLB())).toThrowError(
    /ICE3_ASSET_DUPLICATE_ID/,
  );
});

it('rejects primitive modes outside triangles and profile edges', () => {
  expect(() => readPreparedGLB(createInvalidPrimitiveModeGLB())).toThrowError(
    /ICE3_ASSET_UNSUPPORTED_FEATURE/,
  );
});
