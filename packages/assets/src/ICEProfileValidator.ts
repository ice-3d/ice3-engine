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
  const contractVersion = profile.contractVersion;
  if (contractVersion !== undefined) {
    if (
      typeof contractVersion !== 'string'
      || !/^1(?:\.\d+){1,2}$/.test(contractVersion)
    ) {
      throw assetError(
        'ICE3_ASSET_CONTRACT_UNSUPPORTED',
        `unsupported asset contract version: ${String(contractVersion)}`,
      );
    }
    const preparation = record(profile.preparation);
    if (preparation?.runtimeConversionRequired !== false) {
      throw assetError(
        'ICE3_TOOL_RUNTIME_CONVERSION_REQUIRED',
        'asset requires unsupported runtime conversion',
      );
    }
    const budget = record(profile.budget);
    if (
      !budget
      || typeof budget.profile !== 'string'
      || !['pass', 'warning', 'error'].includes(String(budget.status))
      || !nonNegativeInteger(budget.warningCount)
      || !nonNegativeInteger(budget.errorCount)
    ) {
      throw assetError(
        'ICE3_ASSET_CONTRACT_UNSUPPORTED',
        'asset contract budget is invalid',
      );
    }
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
    const nodeProfile = record(record(node.extras)?.ice3);
    const id = nodeProfile?.id;
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw assetError('ICE3_ASSET_DUPLICATE_ID', 'node profile ID is invalid');
    }
    ids.add(id);
    const selectionId = nodeProfile?.selectionId;
    if (
      selectionId !== undefined
      && (typeof selectionId !== 'string' || !selectionId.trim())
    ) {
      throw assetError(
        'ICE3_ASSET_PROFILE_UNSUPPORTED',
        'node selection identity is invalid',
      );
    }
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
      || view.buffer !== 0
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
  if (contractVersion !== undefined) {
    validatePreparedStats(json, profile);
  }
  return { json, binary, profile };
}

function validatePreparedStats(json: JSONRecord, profile: JSONRecord): void {
  const stats = record(profile.stats);
  const nodes = records(json.nodes);
  const meshes = records(json.meshes);
  const accessors = records(json.accessors);
  let primitiveCount = 0;
  let triangleCount = 0;
  let edgeSegmentCount = 0;
  const selectionNodes = new Set<number>();
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.mesh === undefined) continue;
    const mesh = meshes[Number(node.mesh)];
    if (!mesh) continue;
    for (const primitive of records(mesh.primitives)) {
      primitiveCount += 1;
      const mode = Number(primitive.mode ?? 4);
      const accessor = accessors[Number(primitive.indices)];
      if (mode === 4) {
        const count = Number(accessor?.count);
        if (Number.isInteger(count) && count >= 0) triangleCount += count / 3;
        selectionNodes.add(nodeIndex);
      } else if (mode === 1) {
        const count = Number(accessor?.count);
        if (Number.isInteger(count) && count >= 0) edgeSegmentCount += count / 2;
      }
    }
  }
  const expected = {
    nodeCount: nodes.length,
    maxNodeDepth: sceneDepth(json),
    meshCount: meshes.length,
    primitiveCount,
    triangleCount,
    edgeSegmentCount,
    materialCount: records(json.materials).length,
    selectionGroupCount: selectionNodes.size,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (stats?.[key] !== value) {
      throw assetError(
        'ICE3_ASSET_STATS_MISMATCH',
        `asset stat ${key} does not match prepared data`,
      );
    }
  }
}

function sceneDepth(json: JSONRecord): number {
  const nodes = records(json.nodes);
  const scenes = records(json.scenes);
  const visit = (index: number, visiting = new Set<number>()): number => {
    if (visiting.has(index)) return 0;
    const next = new Set(visiting).add(index);
    const children = Array.isArray(nodes[index]?.children)
      ? nodes[index]!.children as number[]
      : [];
    return children.length === 0
      ? 0
      : 1 + Math.max(...children.map((child) => visit(Number(child), next)));
  };
  const roots = Array.isArray(scenes[0]?.nodes)
    ? scenes[0]!.nodes as number[]
    : [];
  return roots.length === 0
    ? 0
    : Math.max(...roots.map((root) => visit(Number(root))));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0;
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
