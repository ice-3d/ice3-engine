const MAGIC = 'ICE3PGP1';
const HEADER_BYTES = 120;
const MANIFEST_LENGTH_OFFSET = 40;
const BINARY_LENGTH_OFFSET = 48;
const MANIFEST_DIGEST_OFFSET = 56;
const CONTENT_DIGEST_OFFSET = 88;
const MAX_PACKET_BYTES = 256 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_GEOMETRIES = 250_000;
const MAX_RANGES = 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type ICEPreviewGeometryBackend = 'cpu' | 'gpu';
export type ICEPreviewGeometryResidencyMode =
  | 'cpu'
  | 'cold'
  | 'warm'
  | 'resident'
  | 'snapshot';
export type ICEPreviewGeometryRangeUsage = 'vertex_attributes' | 'indices';

export interface ICEPreviewGeometryRange {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly usage: ICEPreviewGeometryRangeUsage;
}

export interface ICEPreviewGeometryNode {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly matrix: readonly number[];
  readonly materialId: string | null;
  readonly geometryId: string | null;
  readonly visible: boolean;
}

export interface ICEPreviewGeometryRecord {
  readonly geometryId: string;
  readonly residentGeometryId: string | null;
  readonly topologyDigest: string;
  readonly attributeDigest: string;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly indexWidth: 2 | 4;
  readonly ranges: readonly ICEPreviewGeometryRange[];
}

export interface ICEPreviewGeometry extends ICEPreviewGeometryRecord {
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

export interface ICEPreviewGeometryMaterial {
  readonly materialId: string;
  readonly baseColor: readonly [number, number, number, number];
  readonly metallic: number;
  readonly roughness: number;
  readonly opacity: number;
}

export interface ICEPreviewGeometryManifest {
  readonly schemaVersion: number;
  readonly transportVersion: number;
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly sourceDigest: string;
  readonly backend: ICEPreviewGeometryBackend;
  readonly residencyMode: ICEPreviewGeometryResidencyMode;
  readonly nodes: readonly ICEPreviewGeometryNode[];
  readonly geometries: readonly ICEPreviewGeometryRecord[];
  readonly materials: readonly ICEPreviewGeometryMaterial[];
  readonly removedNodeIds: readonly string[];
  readonly removedGeometryIds: readonly string[];
}

export interface ICEPreviewGeometryPacket
  extends Omit<ICEPreviewGeometryManifest, 'geometries'> {
  readonly geometries: readonly ICEPreviewGeometry[];
  readonly binary: Uint8Array;
}

export type ICEPreviewGeometryDelta = ICEPreviewGeometryPacket;

export function parsePreviewGeometryPacket(
  input: Uint8Array | ArrayBuffer,
): ICEPreviewGeometryPacket {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_PACKET_BYTES) {
    throw new RangeError('ICE3 preview packet size is invalid');
  }
  if (decoder.decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new TypeError('ICE3 preview packet magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schemaVersion = view.getUint16(8, true);
  const transportVersion = view.getUint16(10, true);
  const headerBytes = view.getUint32(12, true);
  if (schemaVersion !== 1 || transportVersion !== 1 || headerBytes !== HEADER_BYTES) {
    throw new TypeError('ICE3 preview packet version is unsupported');
  }
  const manifestLength = readSafeU64(view, MANIFEST_LENGTH_OFFSET);
  const binaryLength = readSafeU64(view, BINARY_LENGTH_OFFSET);
  if (
    manifestLength === 0
    || manifestLength % 8 !== 0
    || HEADER_BYTES + manifestLength + binaryLength !== bytes.byteLength
  ) {
    throw new RangeError('ICE3 preview packet lengths are invalid');
  }

  const manifestStart = HEADER_BYTES;
  const manifestEnd = manifestStart + manifestLength;
  const manifestBytes = bytes.subarray(manifestStart, manifestEnd);
  const binary = bytes.subarray(manifestEnd);
  const expectedManifestDigest = bytes.subarray(
    MANIFEST_DIGEST_OFFSET,
    MANIFEST_DIGEST_OFFSET + 32,
  );
  if (!equalBytes(sha256(manifestBytes), expectedManifestDigest)) {
    throw new TypeError('ICE3 preview packet manifest digest is invalid');
  }
  const contentHash = sha256(concatBytes(manifestBytes, binary));
  const expectedContentDigest = bytes.subarray(
    CONTENT_DIGEST_OFFSET,
    CONTENT_DIGEST_OFFSET + 32,
  );
  if (!equalBytes(contentHash, expectedContentDigest)) {
    throw new TypeError('ICE3 preview packet content digest is invalid');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new TypeError('ICE3 preview packet manifest is invalid');
  }
  const manifest = validateManifest(candidate, binary.byteLength);
  return {
    ...manifest,
    geometries: manifest.geometries.map((geometry) => decodeGeometry(geometry, binary)),
    binary,
  };
}

export function applyPreviewGeometryDelta(
  base: ICEPreviewGeometryPacket,
  delta: ICEPreviewGeometryDelta,
): ICEPreviewGeometryPacket {
  if (delta.parentRevision !== base.revision) {
    throw new RangeError(
      `ICE3 preview packet parent revision ${delta.parentRevision ?? 'missing'} does not match ${base.revision}`,
    );
  }
  const nodes = mergeById(
    base.nodes,
    delta.nodes,
    delta.removedNodeIds,
    (node) => node.nodeId,
  );
  const geometries = mergeGeometries(base.geometries, delta, delta.removedGeometryIds);
  const materials = mergeById(
    base.materials,
    delta.materials,
    [],
    (material) => material.materialId,
  );
  return {
    schemaVersion: delta.schemaVersion,
    transportVersion: delta.transportVersion,
    revision: delta.revision,
    parentRevision: delta.parentRevision,
    sourceDigest: delta.sourceDigest,
    backend: delta.backend,
    residencyMode: delta.residencyMode,
    nodes,
    geometries,
    materials,
    removedNodeIds: [],
    removedGeometryIds: [],
    binary: delta.binary,
  };
}

function mergeGeometries(
  baseGeometries: readonly ICEPreviewGeometry[],
  delta: ICEPreviewGeometryPacket,
  removedGeometryIds: readonly string[],
): readonly ICEPreviewGeometry[] {
  const removed = new Set(removedGeometryIds);
  const updates = new Map(
    delta.geometries.map((geometry) => [geometry.geometryId, geometry]),
  );
  const output: ICEPreviewGeometry[] = [];
  for (const base of baseGeometries) {
    if (removed.has(base.geometryId)) {
      continue;
    }
    const update = updates.get(base.geometryId);
    output.push(update ? mergeGeometry(base, update) : base);
    updates.delete(base.geometryId);
  }
  output.push(...updates.values());
  return Object.freeze(output);
}

function mergeGeometry(
  base: ICEPreviewGeometry,
  update: ICEPreviewGeometry,
): ICEPreviewGeometry {
  if (base === update) {
    return base;
  }
  return freezeGeometry(
    update,
    base.attributeDigest === update.attributeDigest
      ? base.positions
      : update.positions,
    base.topologyDigest === update.topologyDigest
      ? base.indices
      : update.indices,
  );
}

function validateManifest(
  value: unknown,
  binaryLength: number,
): ICEPreviewGeometryManifest {
  if (!isRecord(value)) {
    throw invalidManifest();
  }
  const nodes = readArray(value.nodes, MAX_NODES).map(readNode);
  const geometries = readArray(value.geometries, MAX_GEOMETRIES).map(readGeometryRecord);
  const materials = readArray(value.materials, MAX_GEOMETRIES).map(readMaterial);
  const removedNodeIds = readStringArray(value.removedNodeIds, MAX_NODES);
  const removedGeometryIds = readStringArray(value.removedGeometryIds, MAX_GEOMETRIES);
  const manifest: ICEPreviewGeometryManifest = {
    schemaVersion: readVersion(value.schemaVersion, 1),
    transportVersion: readVersion(value.transportVersion, 1),
    revision: readSafeInteger(value.revision, 0, Number.MAX_SAFE_INTEGER),
    parentRevision: value.parentRevision === null
      ? null
      : readSafeInteger(value.parentRevision, 0, Number.MAX_SAFE_INTEGER),
    sourceDigest: readDigest(value.sourceDigest),
    backend: readEnum(value.backend, ['cpu', 'gpu'] as const),
    residencyMode: readEnum(
      value.residencyMode,
      ['cpu', 'cold', 'warm', 'resident', 'snapshot'] as const,
    ),
    nodes,
    geometries,
    materials,
    removedNodeIds,
    removedGeometryIds,
  };
  if (
    manifest.parentRevision !== null
    && manifest.parentRevision >= manifest.revision
  ) {
    throw invalidManifest();
  }
  ensureUnique(nodes, (node) => node.nodeId);
  ensureUnique(geometries, (geometry) => geometry.geometryId);
  ensureUnique(materials, (material) => material.materialId);
  for (const geometry of geometries) {
    for (const range of geometry.ranges) {
      if (
        range.byteOffset % 4 !== 0
        || range.byteLength === 0
        || range.byteOffset + range.byteLength > binaryLength
      ) {
        throw invalidManifest();
      }
    }
  }
  return manifest;
}

function readNode(value: unknown, index: number): ICEPreviewGeometryNode {
  if (!isRecord(value)) {
    throw new TypeError(`ICE3 preview node ${index} is invalid`);
  }
  const matrix = readArray(value.matrix, 16);
  if (matrix.some((entry) => (
    typeof entry !== 'number' || !Number.isFinite(entry)
  ))) {
    throw new TypeError(`ICE3 preview node ${index} matrix is invalid`);
  }
  return {
    nodeId: readNonEmptyString(value.nodeId),
    parentId: readNullableString(value.parentId),
    name: readString(value.name),
    matrix: Object.freeze(matrix as number[]),
    materialId: readNullableString(value.materialId),
    geometryId: readNullableString(value.geometryId),
    visible: readBoolean(value.visible),
  };
}

function readGeometryRecord(value: unknown, index: number): ICEPreviewGeometryRecord {
  if (!isRecord(value)) {
    throw new TypeError(`ICE3 preview geometry ${index} is invalid`);
  }
  const indexWidth = readSafeInteger(value.indexWidth, 1, 8);
  if (indexWidth !== 2 && indexWidth !== 4) {
    throw new TypeError(`ICE3 preview geometry ${index} index width is invalid`);
  }
  const ranges = readArray(value.ranges, MAX_RANGES).map(readRange);
  return {
    geometryId: readNonEmptyString(value.geometryId),
    residentGeometryId: readNullableString(value.residentGeometryId),
    topologyDigest: readDigest(value.topologyDigest),
    attributeDigest: readDigest(value.attributeDigest),
    vertexCount: readSafeInteger(value.vertexCount, 1, 100_000_000),
    indexCount: readSafeInteger(value.indexCount, 0, 300_000_000),
    indexWidth,
    ranges: Object.freeze(ranges),
  };
}

function readRange(value: unknown, index: number): ICEPreviewGeometryRange {
  if (!isRecord(value)) {
    throw new TypeError(`ICE3 preview range ${index} is invalid`);
  }
  return {
    byteOffset: readSafeInteger(value.byteOffset, 0, MAX_PACKET_BYTES),
    byteLength: readSafeInteger(value.byteLength, 1, MAX_PACKET_BYTES),
    usage: readEnum(
      value.usage,
      ['vertex_attributes', 'indices'] as const,
    ),
  };
}

function readMaterial(value: unknown, index: number): ICEPreviewGeometryMaterial {
  if (!isRecord(value)) {
    throw new TypeError(`ICE3 preview material ${index} is invalid`);
  }
  const baseColor = readFiniteArray(value.baseColor, 4);
  return {
    materialId: readNonEmptyString(value.materialId),
    baseColor: Object.freeze(baseColor) as [number, number, number, number],
    metallic: readFiniteNumber(value.metallic),
    roughness: readFiniteNumber(value.roughness),
    opacity: readFiniteNumber(value.opacity),
  };
}

function decodeGeometry(
  geometry: ICEPreviewGeometryRecord,
  binary: Uint8Array,
): ICEPreviewGeometry {
  const attributes = geometry.ranges.find(
    (range) => range.usage === 'vertex_attributes',
  );
  const topology = geometry.ranges.find((range) => range.usage === 'indices');
  if (!attributes && !topology) {
    return freezeGeometry(
      encodeIdentity(geometry),
      new Float32Array(),
      new Uint32Array(),
    );
  }
  const positions = attributes
    ? decodePositions(attributes, geometry.vertexCount, binary)
    : new Float32Array(geometry.vertexCount * 3);
  const indices = topology
    ? decodeIndices(topology, geometry.indexCount, geometry.indexWidth, binary)
    : new Uint32Array();
  return freezeGeometry(encodeIdentity(geometry), positions, indices);
}

function decodePositions(
  range: ICEPreviewGeometryRange,
  vertexCount: number,
  binary: Uint8Array,
): Float32Array {
  const bytesPerVertex = range.byteLength / vertexCount;
  const components = bytesPerVertex / 4;
  if (!Number.isInteger(components) || components < 3) {
    throw new TypeError('ICE3 preview position range has an invalid stride');
  }
  const source = new Float32Array(
    binary.buffer,
    binary.byteOffset + range.byteOffset,
    range.byteLength / 4,
  );
  if (components === 3) {
    return source;
  }
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const sourceOffset = vertex * components;
    positions[vertex * 3] = source[sourceOffset]!;
    positions[vertex * 3 + 1] = source[sourceOffset + 1]!;
    positions[vertex * 3 + 2] = source[sourceOffset + 2]!;
  }
  return positions;
}

function decodeIndices(
  range: ICEPreviewGeometryRange,
  indexCount: number,
  indexWidth: 2 | 4,
  binary: Uint8Array,
): Uint16Array | Uint32Array {
  if (range.byteLength !== indexCount * indexWidth) {
    throw new TypeError('ICE3 preview index range has an invalid length');
  }
  const offset = binary.byteOffset + range.byteOffset;
  return indexWidth === 2
    ? new Uint16Array(binary.buffer, offset, indexCount)
    : new Uint32Array(binary.buffer, offset, indexCount);
}

function freezeGeometry(
  identity: Pick<ICEPreviewGeometryRecord,
    'geometryId'
    | 'residentGeometryId'
    | 'topologyDigest'
    | 'attributeDigest'
    | 'vertexCount'
    | 'indexCount'
    | 'indexWidth'
    | 'ranges'>,
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): ICEPreviewGeometry {
  return Object.freeze({
    ...identity,
    positions,
    indices,
  });
}

function encodeIdentity(
  geometry: ICEPreviewGeometryRecord,
): ICEPreviewGeometryRecord {
  return geometry;
}

function mergeById<T>(
  base: readonly T[],
  updates: readonly T[],
  removed: readonly string[],
  id: (value: T) => string,
): readonly T[] {
  const removedIds = new Set(removed);
  const updateMap = new Map(updates.map((value) => [id(value), value]));
  const output = base
    .filter((value) => !removedIds.has(id(value)))
    .map((value) => updateMap.get(id(value)) ?? value);
  const baseIds = new Set(base.map(id));
  for (const value of updates) {
    if (!baseIds.has(id(value))) {
      output.push(value);
    }
  }
  return Object.freeze(output);
}

function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalidManifest();
  }
  return value;
}

function readStringArray(value: unknown, maximum: number): readonly string[] {
  return Object.freeze(readArray(value, maximum).map(readString));
}

function readFiniteArray(value: unknown, length: number): number[] {
  const values = readArray(value, length);
  if (
    values.length !== length
    || values.some((entry) => (
      typeof entry !== 'number' || !Number.isFinite(entry)
    ))
  ) {
    throw invalidManifest();
  }
  return values as number[];
}

function readVersion(value: unknown, expected: number): number {
  if (value !== expected) {
    throw new TypeError('ICE3 preview packet version is unsupported');
  }
  return expected;
}

function readSafeInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw invalidManifest();
  }
  return value;
}

function readFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidManifest();
  }
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw invalidManifest();
  }
  return value;
}

function readString(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidManifest();
  }
  return value;
}

function readNonEmptyString(value: unknown): string {
  const result = readString(value);
  if (!result.trim()) {
    throw invalidManifest();
  }
  return result;
}

function readNullableString(value: unknown): string | null {
  return value === null ? null : readString(value);
}

function readDigest(value: unknown): string {
  const digest = readString(value);
  if (!/^[0-9a-fA-F]{64}$/.test(digest)) {
    throw invalidManifest();
  }
  return digest.toLowerCase();
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw invalidManifest();
  }
  return value as T[number];
}

function ensureUnique<T>(values: readonly T[], id: (value: T) => string): void {
  if (new Set(values.map(id)).size !== values.length) {
    throw invalidManifest();
  }
}

function invalidManifest(): TypeError {
  return new TypeError('ICE3 preview packet manifest is invalid');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeU64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('ICE3 preview packet length exceeds safe integer range');
  }
  return Number(value);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(input);
  data[input.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15]!, 7)
        ^ rotateRight(words[index - 15]!, 18)
        ^ (words[index - 15]! >>> 3);
      const s1 = rotateRight(words[index - 2]!, 17)
        ^ rotateRight(words[index - 2]!, 19)
        ^ (words[index - 2]! >>> 10);
      words[index] = (
        words[index - 16]!
        + s0
        + words[index - 7]!
        + s1
      ) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < hash.length; index += 1) {
    outputView.setUint32(index * 4, hash[index]!, false);
  }
  return output;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
