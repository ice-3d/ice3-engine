import { createHash } from 'node:crypto';

type FixtureOptions = {
  readonly profile?: boolean;
  readonly outOfRange?: boolean;
  readonly trsNode?: boolean;
  readonly badDigest?: boolean;
};

export function createMinimalPreparedGLB(
  options: FixtureOptions = {},
): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const edges = new Uint16Array([0, 1, 1, 2, 2, 0]);
  const binary = Buffer.alloc(56);
  Buffer.from(positions.buffer).copy(binary, 0);
  Buffer.from(indices.buffer).copy(binary, 36);
  Buffer.from(edges.buffer).copy(binary, 44);
  const digest = createHash('sha256').update(binary).digest('hex');

  const json = {
    asset: {
      version: '2.0',
      extras: options.profile === false
        ? {}
        : {
            ice3: {
              profile: 'ice3-prepared',
              profileVersion: '1.0',
              assetId: 'fixture',
              contentDigest: {
                algorithm: 'sha256',
                value: options.badDigest ? '0'.repeat(64) : digest,
                covers: 'binary-chunk',
              },
              coordinateSystem: {
                handedness: 'right',
                upAxis: 'y',
                linearUnit: 'meter',
              },
              bounds: { min: [0, 0, 0], max: [1, 1, 0] },
              stats: {
                nodeCount: 1,
                meshCount: 1,
                triangleCount: 1,
                edgeSegmentCount: 3,
              },
            },
          },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      ...(options.trsNode
        ? { translation: [0, 0, 0] }
        : { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }),
      mesh: 0,
      extras: { ice3: { id: 'fixture/node/0' } },
    }],
    meshes: [{
      primitives: [
        {
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
          mode: 4,
        },
        {
          attributes: { POSITION: 0 },
          indices: 2,
          material: 1,
          mode: 1,
          extras: { ice3: { role: 'edges', widthPx: 3 } },
        },
      ],
      extras: { ice3: { id: 'fixture/mesh/0' } },
    }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.5, 0.9, 1] },
        extras: { ice3: { id: 'fixture/material/0' } },
      },
      {
        pbrMetallicRoughness: { baseColorFactor: [0.9, 0.95, 1, 1] },
        extras: { ice3: { id: 'fixture/material/0/edges' } },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: options.outOfRange ? 100 : 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 44, byteLength: 12 },
    ],
    buffers: [{ byteLength: 56 }],
  };

  return packGLB(json, binary);
}

export function createOrdinaryGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ profile: false });
}

export function createOutOfRangeAccessorGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ outOfRange: true });
}

export function createTRSNodeGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ trsNode: true });
}

export function createBadDigestGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ badDigest: true });
}

function packGLB(json: unknown, binary: Buffer): ArrayBuffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(0x20, 20, 20 + jsonLength);
  jsonBytes.copy(output, 20);
  const binHeader = 20 + jsonLength;
  output.writeUInt32LE(binary.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  binary.copy(output, binHeader + 8);
  return output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength,
  );
}
