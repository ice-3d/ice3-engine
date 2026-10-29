import type { ICEGeometryBounds } from '@ice3/core';
import type { ICEInstanceStoragePage } from './WebGPUInstanceStorage.js';
import {
  createEmptyGPUDataBuffer,
  writeGPUData,
} from './WebGPUResources.js';

const STORAGE_USAGE = 128 | 8;
const INDIRECT_USAGE = 256 | 128 | 8;

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
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const world = multiply(matrix, [x, y, z, 1]);
        const clip = multiply(viewProjection, world);
        if (
          clip[3]! > 0
          && Math.abs(clip[0]!) <= clip[3]!
          && Math.abs(clip[1]!) <= clip[3]!
          && Math.abs(clip[2]!) <= clip[3]!
        ) {
          return true;
        }
      }
    }
  }
  return false;
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

fn projected(point: vec3<f32>) -> vec4<f32> {
  return frame.worldViewProjection * vec4<f32>(point, 1.0);
}

fn inside(point: vec3<f32>) -> bool {
  let clip = projected(point);
  return clip.w > 0.0
    && abs(clip.x) <= clip.w
    && abs(clip.y) <= clip.w
    && abs(clip.z) <= clip.w;
}

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&instances)) {
    return;
  }
  let instance = instances[index];
  let center = instance.bounds.xyz;
  let radius = instance.bounds.w;
  let min = center - vec3<f32>(radius);
  let max = center + vec3<f32>(radius);
  var visibleInstance = false;
  for (var cornerIndex = 0u; cornerIndex < 8u; cornerIndex += 1u) {
    let corner = vec3<f32>(
      select(min.x, max.x, (cornerIndex & 1u) != 0u),
      select(min.y, max.y, (cornerIndex & 2u) != 0u),
      select(min.z, max.z, (cornerIndex & 4u) != 0u)
    );
    let world = instance.transform * vec4<f32>(corner, 1.0);
    if (inside(world.xyz)) {
      visibleInstance = true;
      break;
    }
  }
  if (!visibleInstance) {
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
