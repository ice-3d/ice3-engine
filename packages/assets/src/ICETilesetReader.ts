import type { ICEGeometryBounds } from '@ice3/core';
import type {
  ICETilesetSnapshot,
  ICETilesetTile,
} from './ICETileset.js';

type JSONRecord = Record<string, unknown>;
type Matrix = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

const IDENTITY: Matrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const Y_UP_TO_Z_UP: Matrix = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
];
const Z_UP_TO_Y_UP: Matrix = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
];
const EPSILON = 1e-6;

export function readTileset(
  text: string,
  baseUrl: string,
): ICETilesetSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('tileset JSON is invalid');
  }
  const document = record(parsed);
  if (!document) throw invalid('tileset root must be an object');
  const asset = record(document.asset);
  if (asset?.version !== '1.1') {
    throw unsupported('asset.version must be 1.1');
  }
  const assetId = record(record(asset.extras)?.ice3)?.assetId;
  if (typeof assetId !== 'string' || !assetId.trim()) {
    throw invalid('asset.extras.ice3.assetId is required');
  }
  if (
    Array.isArray(document.extensionsRequired)
    && document.extensionsRequired.length > 0
  ) {
    throw unsupported('required tileset extensions are not supported');
  }
  const root = record(document.root);
  if (!root) throw invalid('root tile is missing');
  const tiles: ICETilesetTile[] = [];
  const ids = new Set<string>();
  const rootTile = parseTile(
    root,
    'root',
    new URL(baseUrl),
    IDENTITY,
    undefined,
    ids,
    tiles,
  );
  return {
    assetId,
    bounds: rootTile.bounds,
    tiles,
  };
}

function parseTile(
  input: JSONRecord,
  id: string,
  baseUrl: URL,
  parentTransform: Matrix,
  inheritedRefine: 'REPLACE' | undefined,
  ids: Set<string>,
  output: ICETilesetTile[],
): ICETilesetTile {
  if (ids.has(id)) {
    throw invalid(`duplicate tile id: ${id}`);
  }
  ids.add(id);
  if (input.region !== undefined || record(input.boundingVolume)?.region) {
    throw unsupported('region bounding volumes are not supported');
  }
  if (input.implicitTiling !== undefined) {
    throw unsupported('implicit tiling is not supported');
  }
  if (
    Array.isArray(input.extensionsRequired)
    && input.extensionsRequired.length > 0
  ) {
    throw unsupported('required tile extensions are not supported');
  }
  const localTransform = parseTransform(input.transform);
  const standardTransform = multiplyMatrices(parentTransform, localTransform);
  const bounds = parseBounds(
    record(input.boundingVolume),
    standardTransform,
  );
  const geometricError = input.geometricError;
  if (
    typeof geometricError !== 'number'
    || !Number.isFinite(geometricError)
    || geometricError < 0
  ) {
    throw invalid('geometricError must be a non-negative finite number');
  }
  const refine = input.refine === undefined ? inheritedRefine : input.refine;
  if (refine !== 'REPLACE') {
    throw unsupported('only REPLACE refinement is supported');
  }
  const content = record(input.content);
  if (content?.boundingVolume && record(content.boundingVolume)?.region) {
    throw unsupported('region content bounds are not supported');
  }
  const contentUri = content?.uri === undefined
    ? undefined
    : resolveContentUri(content.uri, baseUrl);
  const childrenInput = input.children;
  if (
    childrenInput !== undefined
    && (!Array.isArray(childrenInput) || childrenInput.length === 0)
  ) {
    throw invalid('children must be a non-empty array');
  }
  const children = (childrenInput ?? []).map((value, index) => {
    const child = record(value);
    if (!child) throw invalid(`child ${index} must be an object`);
    const parsed = parseTile(
      child,
      `${id}/${index}`,
      baseUrl,
      standardTransform,
      'REPLACE',
      ids,
      output,
    );
    assertContains(bounds, parsed.bounds, id);
    return parsed;
  });
  if (!contentUri && children.length === 0) {
    throw invalid(`tile ${id} has neither content nor children`);
  }
  const engineTransform = multiplyMatrices(
    multiplyMatrices(Z_UP_TO_Y_UP, standardTransform),
    Y_UP_TO_Z_UP,
  );
  const tile: ICETilesetTile = {
    id,
    bounds,
    ...(contentUri === undefined ? {} : { contentUri }),
    children,
    geometricError,
    ...(isIdentity(engineTransform)
      ? {}
      : { transform: [...engineTransform] }),
  };
  if (contentUri) output.push(tile);
  return tile;
}

function parseBounds(
  volume: JSONRecord | undefined,
  transform: Matrix,
): ICEGeometryBounds {
  if (!volume) throw invalid('tile boundingVolume is required');
  const hasBox = volume.box !== undefined;
  const hasSphere = volume.sphere !== undefined;
  if (hasBox === hasSphere) {
    throw unsupported('tile must use exactly one box or sphere');
  }
  if (hasBox) {
    const box = numbers(volume.box, 12);
    if (!box) throw invalid('box must contain 12 finite numbers');
    return transformTilesBounds(box, transform);
  }
  const sphere = numbers(volume.sphere, 4);
  if (!sphere) throw invalid('sphere must contain 4 finite numbers');
  const center = transformPoint(transform, sphere[0]!, sphere[1]!, sphere[2]!);
  const scale = Math.max(
    axisLength(transform, 0),
    axisLength(transform, 1),
    axisLength(transform, 2),
  );
  const radius = sphere[3]! * scale;
  if (!Number.isFinite(radius) || radius < 0) {
    throw invalid('sphere radius is invalid');
  }
  return {
    min: [center[0] - radius, center[1] - radius, center[2] - radius],
    max: [center[0] + radius, center[1] + radius, center[2] + radius],
  };
}

function transformTilesBounds(
  box: readonly number[],
  transform: Matrix,
): ICEGeometryBounds {
  const center = [box[0]!, box[1]!, box[2]!] as const;
  const axes = [
    [box[3]!, box[4]!, box[5]!] as const,
    [box[6]!, box[7]!, box[8]!] as const,
    [box[9]!, box[10]!, box[11]!] as const,
  ] as const;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const tilesPoint = [
          center[0] + axes[0][0] * x + axes[1][0] * y + axes[2][0] * z,
          center[1] + axes[0][1] * x + axes[1][1] * y + axes[2][1] * z,
          center[2] + axes[0][2] * x + axes[1][2] * y + axes[2][2] * z,
        ] as const;
        const transformed = transformPoint(transform, ...tilesPoint);
        const point = [
          transformed[0],
          transformed[2],
          -transformed[1],
        ] as const;
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = normalizeZero(Math.min(min[axis]!, point[axis]!));
          max[axis] = normalizeZero(Math.max(max[axis]!, point[axis]!));
        }
      }
    }
  }
  return { min, max };
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function resolveContentUri(value: unknown, baseUrl: URL): string {
  if (typeof value !== 'string' || !value) {
    throw invalid('content.uri must be a non-empty string');
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) {
    throw unsupported('content.uri must be relative');
  }
  let resolved: URL;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    throw unsupported('content.uri cannot be resolved');
  }
  const directory = new URL('.', baseUrl);
  if (!resolved.href.startsWith(directory.href)) {
    throw unsupported('content.uri escapes the tileset directory');
  }
  if (!resolved.pathname.toLowerCase().endsWith('.glb')) {
    throw unsupported('content.uri must reference a GLB');
  }
  return resolved.href;
}

function parseTransform(value: unknown): Matrix {
  if (value === undefined) return IDENTITY;
  const matrix = numbers(value, 16);
  if (!matrix) throw invalid('transform must contain 16 finite numbers');
  if (
    Math.abs(matrix[3]!) > EPSILON
    || Math.abs(matrix[7]!) > EPSILON
    || Math.abs(matrix[11]!) > EPSILON
    || Math.abs(matrix[15]! - 1) > EPSILON
  ) {
    throw invalid('transform must be affine');
  }
  return matrix as unknown as Matrix;
}

function assertContains(
  parent: ICEGeometryBounds,
  child: ICEGeometryBounds,
  id: string,
): void {
  if ([0, 1, 2].some((axis) => (
    child.min[axis]! < parent.min[axis]! - EPSILON
    || child.max[axis]! > parent.max[axis]! + EPSILON
  ))) {
    throw invalid(`child bounds escape parent tile ${id}`);
  }
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        const offset = column * 4 + row;
        output[offset] = (output[offset] ?? 0)
          + left[index * 4 + row]! * right[column * 4 + index]!;
      }
    }
  }
  return output as unknown as Matrix;
}

function transformPoint(
  matrix: Matrix,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function axisLength(matrix: Matrix, axis: number): number {
  return Math.hypot(
    matrix[axis * 4]!,
    matrix[axis * 4 + 1]!,
    matrix[axis * 4 + 2]!,
  );
}

function isIdentity(matrix: Matrix): boolean {
  return matrix.every((value, index) => (
    Math.abs(value - IDENTITY[index]!) <= EPSILON
  ));
}

function numbers(value: unknown, length: number): number[] | undefined {
  return Array.isArray(value)
    && value.length === length
    && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? value as number[]
    : undefined;
}

function record(value: unknown): JSONRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JSONRecord
    : undefined;
}

function invalid(message: string): Error {
  return new Error(`ICE3_TILESET_INVALID: ${message}`);
}

function unsupported(message: string): Error {
  return new Error(`ICE3_TILESET_UNSUPPORTED: ${message}`);
}
