import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { readPreparedGLB } from '../src/index';
import {
  createMinimalPreparedGLB,
  createOddAccessorOffsetGLB,
  createForbiddenFeatureGLB,
  createDuplicateMeshIdGLB,
  createInvalidPrimitiveModeGLB,
  createMissingBufferViewBufferGLB,
  createFourByteAlignedFloatGLB,
  createVertexColorGLB,
  createOrdinaryGLB,
  createOutOfRangeAccessorGLB,
  createTRSNodeGLB,
  createBatchedPreparedGLB,
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

it('reads an explicit selection identity for LOD content', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    selectionId: 'semantic/device/7',
  }));

  expect(snapshot.nodes[0]!.id).toBe('fixture/node/0');
  expect(snapshot.nodes[0]!.selectionId).toBe('semantic/device/7');
});

it('reads equipment business metadata from prepared nodes', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    selectionId: 'semantic/device/7',
    metadata: {
      displayName: '进水泵 A',
      equipmentTag: 'P-101',
      area: 'IntakeArea',
      ports: ['suction', 'discharge'],
      connections: ['main-03-P-101-CV-101'],
    },
  }));

  expect(snapshot.nodes[0]!.metadata).toEqual({
    displayName: '进水泵 A',
    equipmentTag: 'P-101',
    area: 'IntakeArea',
    ports: ['suction', 'discharge'],
    connections: ['main-03-P-101-CV-101'],
  });
});

it('counts a shared mesh once while preserving every node selection', () => {
  const snapshot = readPreparedGLB(
    createMinimalPreparedGLB({ sharedNodeCount: 4 }),
  );

  expect(snapshot.stats).toMatchObject({
    nodeCount: 4,
    meshCount: 1,
    primitiveCount: 2,
    triangleCount: 1,
    selectionGroupCount: 4,
  });
  expect(snapshot.meshes).toHaveLength(4);
});

it('counts unique business selections without batching metadata', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    sharedNodeCount: 2,
    selectionId: 'fixture/equipment/7',
    selectionGroupCount: 1,
  }));

  expect(snapshot.nodes.map((node) => node.selectionId)).toEqual([
    'fixture/equipment/7',
    'fixture/equipment/7',
  ]);
  expect(snapshot.stats.selectionGroupCount).toBe(1);
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

it('rejects a prepared buffer view without its required buffer index', () => {
  expect(() => readPreparedGLB(createMissingBufferViewBufferGLB()))
    .toThrowError(/ICE3_ASSET_ACCESSOR_INVALID/);
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

it('rejects animation content outside the M1 profile', () => {
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

it('reads renderer-side directional shading metadata', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  expect(snapshot.materials[0]!.shading).toBe('directional');
});

it('reads renderer-side water surface shading metadata', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialShading: 'water',
  }));
  expect(snapshot.materials[0]!.shading).toBe('water');
});

it('preserves material opacity in the prepared display color', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialOpacity: 0.5,
  }));
  expect(snapshot.materials[0]!.baseColor).toBe('#3380e680');
});

it('reads validated render batch metadata', () => {
  const snapshot = readPreparedGLB(createBatchedPreparedGLB());

  expect(snapshot.batching).toEqual({
    version: '1.0',
    semanticIds: ['semantic:0'],
    semanticNodeIds: ['fixture/node/0'],
    semanticSelectionIds: ['fixture/node/0'],
    batches: [{
      id: 'batch:0',
      mesh: 0,
      primitive: 0,
      material: 0,
      mode: 4,
      triangleCount: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    }],
  });
  expect(snapshot.geometries[0]!.semanticIndices).toEqual(
    new Uint32Array([0, 0, 0]),
  );
});

it('allows multiple render nodes to share one business selection', () => {
  const snapshot = readPreparedGLB(
    createBatchedPreparedGLB('shared-semantic-selection'),
  );

  expect(snapshot.batching?.semanticNodeIds).toEqual([
    'fixture/node/0',
    'fixture/node/1',
  ]);
  expect(snapshot.batching?.semanticSelectionIds).toEqual([
    'fixture/equipment/7',
    'fixture/equipment/7',
  ]);
  expect(snapshot.stats.selectionGroupCount).toBe(1);
});

for (const issue of [
  'missing-semantic-attribute',
  'out-of-range-semantic-index',
  'duplicate-batch-id',
  'mismatched-semantic-arrays',
  'unsupported-version',
] as const) {
  it(`rejects invalid render batch metadata: ${issue}`, () => {
    expect(() => readPreparedGLB(createBatchedPreparedGLB(issue)))
      .toThrowError(/ICE3_ASSET_BATCH_INVALID/);
  });
}

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

it('resolves a base-colour texture reference to a loadable url', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialTexture: 'textures/steel.png',
  }));
  expect(snapshot.materials[0]!.map).toEqual({ url: 'textures/steel.png' });
});

it('leaves the map off when the primitive has no texture', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  expect(snapshot.materials[0]!.map).toBeUndefined();
});

it('rejects texture images that are not relative files next to the asset', () => {
  expect(() => readPreparedGLB(createMinimalPreparedGLB({
    materialTexture: 'textures/steel.png',
    materialTextureKind: 'absolute',
  }))).toThrowError(/ICE3_ASSET_UNSUPPORTED_FEATURE/);
  expect(() => readPreparedGLB(createMinimalPreparedGLB({
    materialTexture: 'textures/steel.png',
    materialTextureKind: 'embedded',
  }))).toThrowError(/ICE3_ASSET_UNSUPPORTED_FEATURE/);
});

it('resolves texture images against the asset url', () => {
  const snapshot = readPreparedGLB(
    createMinimalPreparedGLB({ materialTexture: 'textures/steel.png' }),
    { baseUrl: 'https://host.example/assets/plant/parts/part-000.glb' },
  );
  expect(snapshot.materials[0]!.map?.url).toBe(
    'https://host.example/assets/plant/parts/textures/steel.png',
  );
});

it('keeps the recorded path when no base url is available', () => {
  const snapshot = readPreparedGLB(
    createMinimalPreparedGLB({ materialTexture: 'textures/steel.png' }),
  );
  expect(snapshot.materials[0]!.map?.url).toBe('textures/steel.png');
});

it('resolves a normal map with its perturbation strength', () => {
  const snapshot = readPreparedGLB(
    createMinimalPreparedGLB({
      materialTexture: 'textures/steel.png',
      materialNormalTexture: 'textures/steel-normal.png',
      materialNormalScale: 0.6,
    }),
    { baseUrl: 'https://host.example/assets/plant/parts/part-000.glb' },
  );
  expect(snapshot.materials[0]!.map?.url).toBe(
    'https://host.example/assets/plant/parts/textures/steel.png',
  );
  expect(snapshot.materials[0]!.normalMap).toEqual({
    url: 'https://host.example/assets/plant/parts/textures/steel-normal.png',
    strength: 0.6,
  });
});

it('leaves the normal map off when the material has none', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialTexture: 'textures/steel.png',
  }));
  expect(snapshot.materials[0]!.normalMap).toBeUndefined();
});

it('reads metallic, roughness and emission from the material', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialMetallic: 0.9,
    materialRoughness: 0.25,
    materialEmissive: [0.1, 0.4, 0.2],
  }));
  const material = snapshot.materials[0]!;
  expect(material.metallic).toBe(0.9);
  expect(material.roughness).toBe(0.25);
  expect(material.emissive).toEqual([0.1, 0.4, 0.2]);
});

it('leaves surface factors off when the material has none', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  const material = snapshot.materials[0]!;
  expect(material.metallic).toBeUndefined();
  expect(material.roughness).toBeUndefined();
  expect(material.emissive).toBeUndefined();
});

it('packs the occlusion and metallic-roughness slots into one ORM map', () => {
  const snapshot = readPreparedGLB(
    createMinimalPreparedGLB({
      materialTexture: 'textures/steel.png',
      materialOrmTexture: 'textures/steel-orm.png',
    }),
    { baseUrl: 'https://host.example/assets/plant/tileset.json' },
  );
  const material = snapshot.materials[0]!;
  // 两个槽位指向同一张图：运行时只采样一次，两个通道都可信。
  expect(material.ormMap).toEqual({
    url: 'https://host.example/assets/plant/textures/steel-orm.png',
    occlusion: true,
    metallicRoughness: true,
  });
});

it('trusts only the metallic-roughness half when occlusion is absent', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialOrmTexture: 'textures/steel-orm.png',
    materialMetallicRoughnessOnly: true,
  }));
  const material = snapshot.materials[0]!;
  // 只有 metallicRoughnessTexture 时不能拿 R 通道当遮蔽，否则整片材质无故变暗。
  expect(material.ormMap).toEqual({
    url: 'textures/steel-orm.png',
    occlusion: false,
    metallicRoughness: true,
  });
});

it('leaves the ORM map off when the material has none', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB({
    materialTexture: 'textures/steel.png',
  }));
  expect(snapshot.materials[0]!.ormMap).toBeUndefined();
});
