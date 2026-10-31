import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  applyPreviewGeometryDelta,
  parsePreviewGeometryPacket,
} from '../src/ICEPreviewGeometryPacket';
import {
  attributeDeltaFixture,
  fullPacketFixture,
  transformOnlyDeltaFixture,
} from './fixtures/previewGeometry';

it('applies a transform-only delta without geometry payload', () => {
  const base = parsePreviewGeometryPacket(fullPacketFixture());
  const next = applyPreviewGeometryDelta(base, transformOnlyDeltaFixture());
  expect(next.geometries).toEqual(base.geometries);
  expect(next.nodes[0]?.matrix[12]).toBe(4);
});

it('preserves stable geometry identity across packet revisions', () => {
  const base = parsePreviewGeometryPacket(fullPacketFixture());
  const next = applyPreviewGeometryDelta(base, attributeDeltaFixture());
  expect(next.geometries[0]?.geometryId).toBe(base.geometries[0]?.geometryId);
  expect(next.geometries[0]?.attributeDigest).not.toBe(
    base.geometries[0]?.attributeDigest,
  );
  expect(next.geometries[0]?.positions).not.toBe(base.geometries[0]?.positions);
  expect(next.geometries[0]?.indices).toBe(base.geometries[0]?.indices);
});

it('rejects a delta whose parent revision does not match', () => {
  const base = parsePreviewGeometryPacket(fullPacketFixture());
  const unrelated = transformOnlyDeltaFixture();
  expect(() => applyPreviewGeometryDelta(
    { ...base, revision: 6 },
    unrelated,
  )).toThrow(/parent revision/i);
});

it('rejects corrupted manifests before exposing typed geometry data', () => {
  const bytes = fullPacketFixture();
  const corrupted = bytes.slice();
  corrupted[120] = 0;
  expect(() => parsePreviewGeometryPacket(corrupted)).toThrow(/digest/i);
});
