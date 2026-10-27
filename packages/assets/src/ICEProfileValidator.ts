type JSONRecord = Record<string, unknown>;

export interface ICEProfileValidation {
  readonly json: JSONRecord;
  readonly binary: Uint8Array;
  readonly profile: JSONRecord;
}

export function validatePreparedProfile(
  json: JSONRecord,
  binary: Uint8Array,
): ICEProfileValidation {
  const asset = record(json.asset);
  const profile = record(record(asset?.extras)?.ice3);
  if (
    profile?.profile !== 'ice3-prepared'
    || profile.profileVersion !== '1.0'
    || typeof profile.assetId !== 'string'
  ) {
    throw assetError(
      'ICE3_ASSET_PROFILE_UNSUPPORTED',
      'GLB is not an ICE3 Prepared Profile',
    );
  }
  if (Array.isArray(json.extensionsRequired) && json.extensionsRequired.length > 0) {
    throw assetError(
      'ICE3_ASSET_PROFILE_UNSUPPORTED',
      'required glTF extensions are unsupported',
    );
  }
  for (const field of [
    'animations',
    'skins',
    'cameras',
    'textures',
    'images',
    'samplers',
    'lights',
  ]) {
    if (Array.isArray(json[field]) && json[field].length > 0) {
      throw assetError(
        'ICE3_ASSET_UNSUPPORTED_FEATURE',
        `${field} are unsupported by the M1 profile`,
      );
    }
  }
  if (
    records(json.scenes).length !== 1
    || json.scene !== 0
    || records(json.buffers).length !== 1
    || records(json.buffers)[0]?.uri !== undefined
    || Number(records(json.buffers)[0]?.byteLength) > binary.byteLength
  ) {
    throw assetError('ICE3_ASSET_INVALID_GLB', 'profile container fields are invalid');
  }
  const ids = new Set<string>();
  for (const node of records(json.nodes)) {
    const id = record(record(node.extras)?.ice3)?.id;
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw assetError('ICE3_ASSET_DUPLICATE_ID', 'node profile ID is invalid');
    }
    ids.add(id);
    const matrix = node.matrix;
    if (
      !Array.isArray(matrix)
      || matrix.length !== 16
      || matrix.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      || node.translation !== undefined
      || node.rotation !== undefined
      || node.scale !== undefined
    ) {
      throw assetError(
        'ICE3_ASSET_PROFILE_UNSUPPORTED',
        'nodes must use matrix transforms',
      );
    }
  }
  for (const [field, kind] of [
    ['meshes', 'mesh'],
    ['materials', 'material'],
  ] as const) {
    for (const entry of records(json[field])) {
      const id = record(record(entry.extras)?.ice3)?.id;
      if (typeof id !== 'string' || !id || ids.has(id)) {
        throw assetError(
          'ICE3_ASSET_DUPLICATE_ID',
          `${kind} profile ID is invalid`,
        );
      }
      ids.add(id);
    }
  }
  const views = records(json.bufferViews);
  for (const [index, view] of views.entries()) {
    const offset = Number(view.byteOffset ?? 0);
    const length = Number(view.byteLength);
    if (
      !Number.isInteger(offset)
      || !Number.isInteger(length)
      || offset % 4 !== 0
      || offset < 0
      || length < 0
      || offset + length > binary.byteLength
      || view.byteStride !== undefined
    ) {
      throw assetError(
        'ICE3_ASSET_ACCESSOR_INVALID',
        `bufferView ${index} is invalid`,
      );
    }
  }
  const accessors = records(json.accessors);
  for (const [index, accessor] of accessors.entries()) {
    if (
      !views[Number(accessor.bufferView)]
      || accessor.sparse !== undefined
      || accessor.normalized === true
    ) {
      throw assetError(
        'ICE3_ASSET_ACCESSOR_INVALID',
        `accessor ${index} is unsupported`,
      );
    }
  }
  for (const mesh of records(json.meshes)) {
    for (const primitive of records(mesh.primitives)) {
      const mode = Number(primitive.mode ?? 4);
      if (mode !== 4 && mode !== 1) {
        throw assetError(
          'ICE3_ASSET_UNSUPPORTED_FEATURE',
          'only triangle and edge primitives are supported',
        );
      }
      if (
        mode === 1
        && record(record(primitive.extras)?.ice3)?.role !== 'edges'
      ) {
        throw assetError(
          'ICE3_ASSET_PROFILE_UNSUPPORTED',
          'line primitives must use the edge role',
        );
      }
      if (mode === 4) {
        const attributes = record(primitive.attributes);
        const colorIndex = attributes?.COLOR_0;
        if (colorIndex !== undefined) {
          const position = accessors[Number(attributes?.POSITION)];
          const colors = accessors[Number(colorIndex)];
          if (
            colors?.componentType !== 5126
            || colors.type !== 'VEC3'
            || colors.count !== position?.count
          ) {
            throw assetError(
              'ICE3_ASSET_ACCESSOR_INVALID',
              'COLOR_0 must be float VEC3 matching POSITION',
            );
          }
        }
      }
    }
  }
  return { json, binary, profile };
}

export function records(value: unknown): JSONRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JSONRecord => (
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      ))
    : [];
}

export function record(value: unknown): JSONRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JSONRecord
    : undefined;
}

function assetError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}
