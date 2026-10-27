import { createHash } from 'node:crypto';

type FixtureOptions = {
  readonly profile?: boolean;
  readonly outOfRange?: boolean;
  readonly trsNode?: boolean;
  readonly badDigest?: boolean;
  readonly oddAccessorOffset?: boolean;
  readonly forbiddenFeature?: boolean;
  readonly duplicateMeshId?: boolean;
  readonly invalidPrimitiveMode?: boolean;
  readonly floatOffset4?: boolean;
  readonly withVertexColors?: boolean;
  readonly selectionId?: string;
  readonly contract?: 'active' | 'legacy' | 'unsupported' | 'conversion';
  readonly missingBufferViewBuffer?: boolean;
};

export function createMinimalPreparedGLB(
  options: FixtureOptions = {},
): ArrayBuffer {
  const contractMode = options.contract ?? 'active';
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const edges = new Uint16Array([0, 1, 1, 2, 2, 0]);
  const positionOffset = options.floatOffset4 ? 4 : 0;
  const indexOffset = positionOffset + 36;
  const edgeOffset = Math.ceil((indexOffset + 6) / 4) * 4;
  const colorOffset = edgeOffset + 12;
  const binaryLength = colorOffset + (options.withVertexColors ? 36 : 0);
  const binary = Buffer.alloc(binaryLength);
  Buffer.from(positions.buffer).copy(binary, positionOffset);
  Buffer.from(indices.buffer).copy(binary, indexOffset);
  Buffer.from(edges.buffer).copy(binary, edgeOffset);
  if (options.withVertexColors) {
    Buffer.from(new Float32Array([
      0.8, 0.2, 0.1,
      0.2, 0.8, 0.1,
      0.1, 0.2, 0.8,
    ]).buffer).copy(binary, colorOffset);
  }
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
              ...(contractMode === 'legacy'
                ? {}
                : {
                    contractVersion: contractMode === 'unsupported' ? '2.0' : '1.0',
                    preparation: {
                      runtimeConversionRequired: contractMode === 'conversion',
                      sourceFormat: 'gltf-2.0',
                      unitsNormalized: true,
                      matrixTransformsBaked: true,
                      requiredCompressionDecoded: true,
                      edgesPrepared: true,
                      selectionGroupsPrepared: true,
                      options: { creaseAngleDegrees: 30, edges: true },
                    },
                    budget: {
                      profile: 'interactive-desktop-v1',
                      status: 'pass',
                      warningCount: 0,
                      errorCount: 0,
                    },
                  }),
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
                maxNodeDepth: 0,
                meshCount: 1,
                primitiveCount: 2,
                triangleCount: 1,
                edgeSegmentCount: 3,
                materialCount: 3,
                selectionGroupCount: 1,
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
      extras: {
        ice3: {
          id: 'fixture/node/0',
          ...(options.selectionId
            ? { selectionId: options.selectionId }
            : {}),
        },
      },
    }],
    meshes: [{
      primitives: [
        {
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
          mode: options.invalidPrimitiveMode ? 3 : 4,
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
    }, ...(options.duplicateMeshId ? [{
      primitives: [],
      extras: { ice3: { id: 'fixture/mesh/0' } },
    }] : [])],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.5, 0.9, 1] },
        extras: { ice3: { id: 'fixture/material/0' } },
      },
      {
        pbrMetallicRoughness: { baseColorFactor: [0.9, 0.95, 1, 1] },
        extras: { ice3: { id: 'fixture/material/0/edges' } },
      },
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
        extras: { ice3: { id: 'fixture/material/vertex-colors' } },
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
      {
        bufferView: 1,
        ...(options.oddAccessorOffset ? { byteOffset: 1 } : {}),
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
      ...(options.withVertexColors ? [{
        bufferView: 3,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
      }] : []),
    ],
    bufferViews: [
      {
        ...(options.missingBufferViewBuffer ? {} : { buffer: 0 }),
        byteOffset: positionOffset,
        byteLength: 36,
      },
      { buffer: 0, byteOffset: indexOffset, byteLength: 6 },
      { buffer: 0, byteOffset: edgeOffset, byteLength: 12 },
      ...(options.withVertexColors ? [{
        buffer: 0,
        byteOffset: colorOffset,
        byteLength: 36,
      }] : []),
    ],
    buffers: [{ byteLength: binaryLength }],
    ...(options.forbiddenFeature
      ? { animations: [{}], textures: [{}] }
      : {}),
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

export function createMissingBufferViewBufferGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ missingBufferViewBuffer: true });
}

export function createBadDigestGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ badDigest: true });
}

export function createOddAccessorOffsetGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ oddAccessorOffset: true });
}

export function createForbiddenFeatureGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ forbiddenFeature: true });
}

export function createDuplicateMeshIdGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ duplicateMeshId: true });
}

export function createInvalidPrimitiveModeGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ invalidPrimitiveMode: true });
}

export function createFourByteAlignedFloatGLB(): ArrayBuffer {
  return createMinimalPreparedGLB({ floatOffset4: true });
}

export function createVertexColorGLB(): ArrayBuffer {
  const bytes = Buffer.from(createMinimalPreparedGLB({ withVertexColors: true }));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/ +$/g, ''),
  );
  json.meshes[0].primitives[0].attributes.COLOR_0 = 3;
  json.meshes[0].primitives[0].material = 2;
  return packGLB(json, bytes.subarray(28 + jsonLength));
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
