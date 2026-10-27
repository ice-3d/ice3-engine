import { expect, test } from 'node-test';
import { readTileset } from '../src/ICETilesetReader';

const tileset = (contentUri = 'parts/part-000.glb') => JSON.stringify({
  asset: {
    version: '1.1',
    extras: { ice3: { assetId: 'factory', contractVersion: '1.0' } },
  },
  geometricError: 10,
  root: {
    boundingVolume: {
      box: [1, -2, 0.5, 1, 0, 0, 0, 2, 0, 0, 0, 0.5],
    },
    geometricError: 0,
    refine: 'REPLACE',
    content: { uri: contentUri },
    extras: { ice3: { assetId: 'factory' } },
  },
});

test('parses a local Cartesian leaf and resolves a relative content URL', () => {
  const snapshot = readTileset(tileset(), 'https://example.test/scene/tileset.json');

  expect(snapshot.assetId).toBe('factory');
  expect(snapshot.bounds).toEqual({
    min: [0, 0, 0],
    max: [2, 1, 4],
  });
  expect(snapshot.tiles[0]!.contentUri).toBe(
    'https://example.test/scene/parts/part-000.glb',
  );
});

test('rejects unsupported and escaping content references', () => {
  expect(() => readTileset(tileset('../part.glb'), 'https://x.test/a/tileset.json'))
    .toThrow(/ICE3_TILESET_UNSUPPORTED/);
  expect(() => readTileset(tileset('/a/part.glb'), 'https://x.test/a/tileset.json'))
    .toThrow(/ICE3_TILESET_UNSUPPORTED/);
  expect(() => readTileset(
    tileset('https://x.test/a/part.glb'),
    'https://x.test/a/tileset.json',
  )).toThrow(/ICE3_TILESET_UNSUPPORTED/);
  expect(() => readTileset(tileset('part.json'), 'https://x.test/a/tileset.json'))
    .toThrow(/ICE3_TILESET_UNSUPPORTED/);
});

test('rejects region and implicit tiling before fetching tile content', () => {
  const withRegion = JSON.parse(tileset());
  withRegion.root.boundingVolume = { region: [0, 0, 0, 0, 0, 0] };
  expect(() => readTileset(JSON.stringify(withRegion), 'https://x.test/'))
    .toThrow(/ICE3_TILESET_UNSUPPORTED/);

  const withImplicit = JSON.parse(tileset());
  withImplicit.root.implicitTiling = { subdivisionScheme: 'QUADTREE' };
  expect(() => readTileset(JSON.stringify(withImplicit), 'https://x.test/'))
    .toThrow(/ICE3_TILESET_UNSUPPORTED/);
});

test('rejects transforms that are not affine', () => {
  const invalid = JSON.parse(tileset());
  invalid.root.transform = [
    1, 0, 0, 1,
    0, 1, 0, 2,
    0, 0, 1, 3,
    0, 0, 0, 2,
  ];

  expect(() => readTileset(JSON.stringify(invalid), 'https://x.test/'))
    .toThrow(/ICE3_TILESET_INVALID/);
});
