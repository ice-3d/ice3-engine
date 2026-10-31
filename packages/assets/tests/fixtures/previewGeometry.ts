import { createHash } from 'node:crypto';
import { parsePreviewGeometryPacket } from '../../src/ICEPreviewGeometryPacket.js';
import type {
  ICEPreviewGeometryManifest,
  ICEPreviewGeometryPacket,
} from '../../src/ICEPreviewGeometryPacket.js';

const HEADER_BYTES = 120;
const encoder = new TextEncoder();

function encodePacket(
  manifest: ICEPreviewGeometryManifest,
  binary: Uint8Array,
): Uint8Array {
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const paddedLength = Math.ceil(manifestBytes.length / 8) * 8;
  const encodedManifest = new Uint8Array(paddedLength);
  encodedManifest.fill(0x20);
  encodedManifest.set(manifestBytes);
  const bytes = new Uint8Array(HEADER_BYTES + encodedManifest.length + binary.length);
  bytes.set(encoder.encode('ICE3PGP1'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 1, true);
  view.setUint16(10, 1, true);
  view.setUint32(12, HEADER_BYTES, true);
  view.setBigUint64(40, BigInt(encodedManifest.length), true);
  view.setBigUint64(48, BigInt(binary.length), true);
  bytes.set(createHash('sha256').update(encodedManifest).digest(), 56);
  bytes.set(
    createHash('sha256')
      .update(encodedManifest)
      .update(binary)
      .digest(),
    88,
  );
  bytes.set(encodedManifest, HEADER_BYTES);
  bytes.set(binary, HEADER_BYTES + encodedManifest.length);
  return bytes;
}

function baseManifest(): ICEPreviewGeometryManifest {
  return {
    schemaVersion: 1,
    transportVersion: 1,
    revision: 4,
    parentRevision: null,
    sourceDigest: 'a'.repeat(64),
    backend: 'gpu',
    residencyMode: 'resident',
    nodes: [{
      nodeId: 'pump-1/body',
      parentId: null,
      name: 'Pump/Body',
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      materialId: null,
      geometryId: 'component/body',
      visible: true,
    }],
    geometries: [{
      geometryId: 'component/body',
      residentGeometryId: 'resident-body',
      topologyDigest: 'b'.repeat(64),
      attributeDigest: 'c'.repeat(64),
      vertexCount: 4,
      indexCount: 6,
      indexWidth: 4,
      ranges: [
        { byteOffset: 0, byteLength: 48, usage: 'vertex_attributes' },
        { byteOffset: 48, byteLength: 24, usage: 'indices' },
      ],
    }],
    materials: [],
    removedNodeIds: [],
    removedGeometryIds: [],
  };
}

function sampleBinary(): Uint8Array {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    1, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);
  const binary = new Uint8Array(72);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), 48);
  return binary;
}

export function fullPacketFixture(): Uint8Array {
  return encodePacket(baseManifest(), sampleBinary());
}

export function transformOnlyDeltaFixture(): ICEPreviewGeometryPacket {
  const source = baseManifest();
  const matrix = [...source.nodes[0]!.matrix];
  matrix[12] = 4;
  return parsePreviewGeometryPacket(
    encodePacket({
      ...source,
      revision: 5,
      parentRevision: 4,
      nodes: [{ ...source.nodes[0]!, matrix }],
      geometries: [],
    }, new Uint8Array()),
  );
}

export function attributeDeltaFixture(): ICEPreviewGeometryPacket {
  const source = baseManifest();
  const binary = sampleBinary().slice(0, 48);
  new Float32Array(binary.buffer)[0] = 2;
  return parsePreviewGeometryPacket(
    encodePacket({
      ...source,
      revision: 5,
      parentRevision: 4,
      geometries: [{
        ...source.geometries[0]!,
        attributeDigest: 'd'.repeat(64),
        ranges: [{
          byteOffset: 0,
          byteLength: 48,
          usage: 'vertex_attributes',
        }],
      }],
    }, binary),
  );
}
