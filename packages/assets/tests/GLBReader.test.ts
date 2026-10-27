import { readFileSync } from 'node:fs';
import { expect, it } from 'node-test';
import { readPreparedGLB } from '../src/index';
import {
  createMinimalPreparedGLB,
  createOddAccessorOffsetGLB,
  createForbiddenFeatureGLB,
  createDuplicateMeshIdGLB,
  createInvalidPrimitiveModeGLB,
  createFourByteAlignedFloatGLB,
  createVertexColorGLB,
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

it('accepts float VEC3 data aligned to four bytes rather than twelve', () => {
  const snapshot = readPreparedGLB(createFourByteAlignedFloatGLB());
  expect(snapshot.geometries[0]!.positions).toHaveLength(9);
});

it('reads prepared per-vertex display colors', () => {
  const snapshot = readPreparedGLB(createVertexColorGLB());
  expect([...snapshot.geometries[0]!.colors!].map((value) => (
    Number(value.toFixed(1))
  ))).toEqual([
    0.8, 0.2, 0.1,
    0.2, 0.8, 0.1,
    0.1, 0.2, 0.8,
  ]);
  expect(snapshot.materials[0]!.baseColor).toBe('#ffffff');
});

it('reads v1 contract, preparation, extended stats, and budget', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  expect(snapshot.contract).toMatchObject({
    status: 'active',
    version: '1.0',
    preparation: {
      runtimeConversionRequired: false,
      matrixTransformsBaked: true,
    },
    budget: {
      profile: 'interactive-desktop-v1',
      status: 'pass',
    },
  });
  expect(snapshot.stats).toMatchObject({
    primitiveCount: 2,
    materialCount: 3,
    selectionGroupCount: 1,
  });
});

it('rejects unsupported contract majors and runtime conversion', () => {
  expect(() => readPreparedGLB(
    createMinimalPreparedGLB({ contract: 'unsupported' }),
  )).toThrow(/ICE3_ASSET_CONTRACT_UNSUPPORTED/);

  expect(() => readPreparedGLB(
    createMinimalPreparedGLB({ contract: 'conversion' }),
  )).toThrow(/ICE3_TOOL_RUNTIME_CONVERSION_REQUIRED/);
});

it('loads legacy assets without a contract', () => {
  expect(readPreparedGLB(
    createMinimalPreparedGLB({ contract: 'legacy' }),
  ).contract.status).toBe('legacy');
});

it('reads the frozen toolchain fixture with its active contract', () => {
  const bytes = readFileSync(new URL(
    '../../../examples/m1/assets/prepared-cube.glb',
    import.meta.url,
  ));
  const snapshot = readPreparedGLB(Uint8Array.from(bytes).buffer);
  expect(snapshot.contract).toMatchObject({
    status: 'active',
    version: '1.0',
    budget: {
      profile: 'interactive-desktop-v1',
      status: 'pass',
    },
  });
  expect(snapshot.stats).toMatchObject({
    triangleCount: 12,
    edgeSegmentCount: 12,
    selectionGroupCount: 1,
  });
});
