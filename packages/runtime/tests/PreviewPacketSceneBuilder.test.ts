import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  applyPreviewGeometryDelta,
  parsePreviewGeometryPacket,
} from '@ice3/assets';
import { ICEMesh } from '@ice3/core';
import {
  attributeDeltaFixture,
  fullPacketFixture,
  transformOnlyDeltaFixture,
} from '../../assets/tests/fixtures/previewGeometry';
import { buildPreviewPacketScene } from '../src/asset/ICEAssetSceneBuilder';

it('builds packet scenes by stable geometry identity and reuses transform-only geometry', () => {
  const basePacket = parsePreviewGeometryPacket(fullPacketFixture());
  const base = buildPreviewPacketScene(basePacket);
  const baseMesh = base.scene.findByID('pump-1/body') as ICEMesh;
  expect(baseMesh.geometry.identity?.geometryId).toBe('component/body');

  const transformed = applyPreviewGeometryDelta(
    basePacket,
    transformOnlyDeltaFixture(),
  );
  const next = buildPreviewPacketScene(transformed, base.geometries);
  const nextMesh = next.scene.findByID('pump-1/body') as ICEMesh;
  expect(nextMesh.geometry).toBe(baseMesh.geometry);
});

it('reuses topology arrays when a packet only changes vertex attributes', () => {
  const basePacket = parsePreviewGeometryPacket(fullPacketFixture());
  const base = buildPreviewPacketScene(basePacket);
  const updatedPacket = applyPreviewGeometryDelta(
    basePacket,
    attributeDeltaFixture(),
  );
  const next = buildPreviewPacketScene(updatedPacket, base.geometries);
  const baseGeometry = base.geometries.get('component/body')!;
  const nextGeometry = next.geometries.get('component/body')!;

  expect(nextGeometry.indices).toBe(baseGeometry.indices);
  expect(nextGeometry.positions).not.toBe(baseGeometry.positions);
  expect(next.geometryUpdates.get('component/body')?.positionRanges).toHaveLength(1);
});
