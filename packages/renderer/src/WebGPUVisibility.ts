import type { ICEGeometryBounds } from '@ice3/core';
import type { ICEInstanceStoragePage } from './WebGPUInstanceStorage.js';
import {
  createEmptyGPUDataBuffer,
  writeGPUData,
} from './WebGPUResources.js';

const STORAGE_USAGE = 128 | 8;
const INDIRECT_USAGE = 256 | 128 | 8 | 4;

export function createIndirectArguments(
  indexCount: number,
  firstIndex: number,
  baseVertex: number,
): Uint32Array | undefined {
  if (
    !Number.isInteger(indexCount)
    || indexCount < 0
    || !Number.isInteger(firstIndex)
    || firstIndex < 0
    || !Number.isInteger(baseVertex)
    || baseVertex < 0
  ) {
    return undefined;
  }
  return new Uint32Array([
    indexCount,
    0,
    firstIndex,
    baseVertex,
    0,
  ]);
}

export function isAabbVisible(
  matrix: ArrayLike<number>,
  bounds: ICEGeometryBounds,
  viewProjection: ArrayLike<number>,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const world = multiply(matrix, [x, y, z, 1]);
        minX = Math.min(minX, world[0]);
        minY = Math.min(minY, world[1]);
        minZ = Math.min(minZ, world[2]);
        maxX = Math.max(maxX, world[0]);
        maxY = Math.max(maxY, world[1]);
        maxZ = Math.max(maxZ, world[2]);
      }
    }
  }
  const row = (index: number) => [
    viewProjection[index]!,
    viewProjection[index + 4]!,
    viewProjection[index + 8]!,
    viewProjection[index + 12]!,
  ] as const;
  const r0 = row(0);
  const r1 = row(1);
  const r2 = row(2);
  const r3 = row(3);
  const planes = [
    addPlane(r3, r0),
    subtractPlane(r3, r0),
    addPlane(r3, r1),
    subtractPlane(r3, r1),
    addPlane(r3, r2),
    subtractPlane(r3, r2),
  ];
  return !planes.some((plane) => {
    const x = plane[0] >= 0 ? maxX : minX;
    const y = plane[1] >= 0 ? maxY : minY;
    const z = plane[2] >= 0 ? maxZ : minZ;
    return plane[0] * x + plane[1] * y + plane[2] * z + plane[3] < 0;
  });
}

export type ICEVisibilityEntry = Readonly<{
  readonly visibleBuffer: GPUBuffer;
  readonly indirectBuffer: GPUBuffer;
  readonly instanceCount: number;
}>;

const COMPUTE_SHADER = `
struct FrameUniforms {
  worldViewProjection: mat4x4<f32>,
}

struct InstanceRecord {
  transform: mat4x4<f32>,
  bounds: vec4<f32>,
  semantic: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

struct IndirectArguments {
  indexCount: u32,
  instanceCount: atomic<u32>,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceRecord>;
@group(0) @binding(2) var<storage, read_write> visible: array<u32>;
@group(0) @binding(3) var<storage, read_write> arguments: IndirectArguments;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&instances)) {
    return;
  }
  let instance = instances[index];
  let radius = instance.bounds.w;
  let localMin = instance.bounds.xyz - vec3<f32>(radius);
  let localMax = instance.bounds.xyz + vec3<f32>(radius);
  var worldMin = vec3<f32>(1e30);
  var worldMax = vec3<f32>(-1e30);
  for (var cornerIndex = 0u; cornerIndex < 8u; cornerIndex += 1u) {
    let corner = vec3<f32>(
      select(localMin.x, localMax.x, (cornerIndex & 1u) != 0u),
      select(localMin.y, localMax.y, (cornerIndex & 2u) != 0u),
      select(localMin.z, localMax.z, (cornerIndex & 4u) != 0u)
    );
    let world = (instance.transform * vec4<f32>(corner, 1.0)).xyz;
    worldMin = min(worldMin, world);
    worldMax = max(worldMax, world);
  }
  let r0 = vec4<f32>(
    frame.worldViewProjection[0][0],
    frame.worldViewProjection[1][0],
    frame.worldViewProjection[2][0],
    frame.worldViewProjection[3][0]
  );
  let r1 = vec4<f32>(
    frame.worldViewProjection[0][1],
    frame.worldViewProjection[1][1],
    frame.worldViewProjection[2][1],
    frame.worldViewProjection[3][1]
  );
  let r2 = vec4<f32>(
    frame.worldViewProjection[0][2],
    frame.worldViewProjection[1][2],
    frame.worldViewProjection[2][2],
    frame.worldViewProjection[3][2]
  );
  let r3 = vec4<f32>(
    frame.worldViewProjection[0][3],
    frame.worldViewProjection[1][3],
    frame.worldViewProjection[2][3],
    frame.worldViewProjection[3][3]
  );
  let planes = array<vec4<f32>, 6>(
    r3 + r0,
    r3 - r0,
    r3 + r1,
    r3 - r1,
    r3 + r2,
    r3 - r2
  );
  var culled = false;
  for (var planeIndex = 0u; planeIndex < 6u; planeIndex += 1u) {
    let plane = planes[planeIndex];
    let positive = select(worldMin, worldMax, plane.xyz >= vec3<f32>(0.0));
    if (dot(plane.xyz, positive) + plane.w < 0.0) {
      culled = true;
      break;
    }
  }
  if (culled) {
    return;
  }
  let slot = atomicAdd(&arguments.instanceCount, 1u);
  visible[slot] = index;
}
`;

export class WebGPUVisibilityEncoder {
  private readonly entries = new Map<
    GPUBuffer,
    Map<number, ICEVisibilityEntry>
  >();

  private constructor(
    private readonly device: GPUDevice,
    readonly bindGroupLayout: GPUBindGroupLayout,
    readonly pipeline: GPUComputePipeline,
  ) {}

  static async create(device: GPUDevice): Promise<WebGPUVisibilityEncoder> {
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 4,
          buffer: {
            type: 'uniform',
            hasDynamicOffset: true,
            minBindingSize: 64,
          },
        },
        {
          binding: 1,
          visibility: 4,
          buffer: { type: 'read-only-storage', minBindingSize: 96 },
        },
        {
          binding: 2,
          visibility: 4,
          buffer: { type: 'storage', minBindingSize: 4 },
        },
        {
          binding: 3,
          visibility: 4,
          buffer: { type: 'storage', minBindingSize: 20 },
        },
      ],
    });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const module = device.createShaderModule({ code: COMPUTE_SHADER });
    const pipeline = await device.createComputePipelineAsync({
      label: 'ice3:visibility',
      layout,
      compute: { module, entryPoint: 'computeMain' },
    });
    return new WebGPUVisibilityEncoder(device, bindGroupLayout, pipeline);
  }

  retain(
    page: ICEInstanceStoragePage,
    indexCount: number,
  ): ICEVisibilityEntry {
    const byIndexCount = this.entries.get(page.buffer);
    const existing = byIndexCount?.get(indexCount);
    if (existing) {
      return existing;
    }
    const visibleBuffer = createEmptyGPUDataBuffer(
      this.device,
      page.instanceCount * 4,
      STORAGE_USAGE,
      'ice3:visible-instances',
    );
    const indirectBuffer = createEmptyGPUDataBuffer(
      this.device,
      256,
      INDIRECT_USAGE,
      'ice3:indirect-arguments',
    );
    writeGPUData(
      this.device,
      indirectBuffer,
      createIndirectArguments(indexCount, 0, 0)!,
    );
    const entry = {
      visibleBuffer,
      indirectBuffer,
      instanceCount: page.instanceCount,
    };
    const entries = byIndexCount ?? new Map();
    entries.set(indexCount, entry);
    this.entries.set(page.buffer, entries);
    return entry;
  }

  encode(
    encoder: GPUCommandEncoder,
    entry: ICEVisibilityEntry,
    page: ICEInstanceStoragePage,
    uniformBuffer: GPUBuffer,
    uniformOffset: number,
  ): void {
    encoder.clearBuffer(entry.indirectBuffer, 4, 4);
    const bindGroup = this.device.createBindGroup({
      label: 'ice3:visibility-bindings',
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer, offset: 0, size: 112 },
        },
        {
          binding: 1,
          resource: { buffer: page.buffer, offset: 0, size: page.buffer.size },
        },
        {
          binding: 2,
          resource: {
            buffer: entry.visibleBuffer,
            offset: 0,
            size: entry.visibleBuffer.size,
          },
        },
        {
          binding: 3,
          resource: {
            buffer: entry.indirectBuffer,
            offset: 0,
            size: entry.indirectBuffer.size,
          },
        },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'ice3:visibility-pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup, [uniformOffset]);
    pass.dispatchWorkgroups(Math.ceil(page.instanceCount / 64));
    pass.end();
  }

  async readStats(
    entry: ICEVisibilityEntry,
    page: ICEInstanceStoragePage,
  ): Promise<Readonly<{
    visibleInstances: number;
    culledInstances: number;
    dispatchCount: number;
  }>> {
    const readback = this.device.createBuffer({
      label: 'ice3:visibility-stats',
      size: 4,
      usage: 1 | 8,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(entry.indirectBuffer, 4, readback, 0, 4);
    this.device.queue.submit([encoder.finish()]);
    try {
      await readback.mapAsync(1);
      const visibleInstances = new Uint32Array(
        readback.getMappedRange(),
      )[0]!;
      return {
        visibleInstances,
        culledInstances: page.instanceCount - visibleInstances,
        dispatchCount: Math.ceil(page.instanceCount / 64),
      };
    } finally {
      readback.unmap();
      readback.destroy();
    }
  }

  dispose(): void {
    for (const entries of this.entries.values()) {
      for (const entry of entries.values()) this.destroy(entry);
    }
    this.entries.clear();
  }

  private destroy(entry: ICEVisibilityEntry): void {
    entry.visibleBuffer.destroy();
    entry.indirectBuffer.destroy();
  }
}

function multiply(
  matrix: ArrayLike<number>,
  vector: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    matrix[0]! * vector[0] + matrix[4]! * vector[1]
      + matrix[8]! * vector[2] + matrix[12]! * vector[3],
    matrix[1]! * vector[0] + matrix[5]! * vector[1]
      + matrix[9]! * vector[2] + matrix[13]! * vector[3],
    matrix[2]! * vector[0] + matrix[6]! * vector[1]
      + matrix[10]! * vector[2] + matrix[14]! * vector[3],
    matrix[3]! * vector[0] + matrix[7]! * vector[1]
      + matrix[11]! * vector[2] + matrix[15]! * vector[3],
  ];
}

function addPlane(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
    left[3] + right[3],
  ];
}

function subtractPlane(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
    left[3] - right[3],
  ];
}
