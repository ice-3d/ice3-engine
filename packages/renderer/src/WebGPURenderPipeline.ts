import { ICEEngineError } from '@ice3/core';

export const WEBGPU_UNIFORM_STRIDE = 256;
export const WEBGPU_UNIFORM_BYTES = 128;

const SHADER_SOURCE = (
  selectionMask: boolean,
  storageInstances: boolean,
  indirectInstances: boolean,
): string => `
struct FrameUniforms {
  worldViewProjection: mat4x4<f32>,
  color: vec4<f32>,
  clipOffset: vec2<f32>,
  useVertexColor: f32,
  useInstancing: f32,
  highlightSemantic: f32,
  useSemantic: f32,
  pickMode: f32,
  pickBase: f32,
  selectionBase: f32,
  useSelectionMask: f32,
  pageBase: f32,
  useIndirect: f32,
}

${storageInstances
  ? `
struct InstanceRecord {
  transform: mat4x4<f32>,
  bounds: vec4<f32>,
  semantic: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}`
  : ''}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) semantic: u32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
${selectionMask
  ? '@group(0) @binding(1) var<storage, read> selection: array<u32>;'
  : ''}
${storageInstances
  ? '@group(0) @binding(2) var<storage, read> instances: array<InstanceRecord>;'
  : ''}
${indirectInstances
  ? '@group(0) @binding(3) var<storage, read> visibleIndices: array<u32>;'
  : ''}

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
  ${storageInstances
    ? `
  @builtin(instance_index) instanceIndex: u32,
  @location(2) vertexSemantic: u32,
`
    : `
  @location(2) instanceColumn0: vec4<f32>,
  @location(3) instanceColumn1: vec4<f32>,
  @location(4) instanceColumn2: vec4<f32>,
  @location(5) instanceColumn3: vec4<f32>,
  @location(6) instanceSemantic: u32,
  @location(7) vertexSemantic: u32,
`}
) -> VertexOutput {
  ${storageInstances
    ? `
  let visibleIndex = ${
    indirectInstances
      ? 'visibleIndices[instanceIndex]'
      : 'instanceIndex - u32(frame.pageBase)'
  };
  let recordIndex = visibleIndex;
  let record = instances[recordIndex];
  let instanceMatrix = record.transform;
  let instanceSemantic = record.semantic;
  let localPosition = vec4<f32>(position, 1.0);
  let worldPosition = instanceMatrix * localPosition;
`
    : `
  let instanceMatrix = mat4x4<f32>(
    instanceColumn0,
    instanceColumn1,
    instanceColumn2,
    instanceColumn3
  );
  let localPosition = vec4<f32>(position, 1.0);
  let worldPosition = mix(
    localPosition,
    instanceMatrix * localPosition,
    frame.useInstancing
  );
`}
  var output: VertexOutput;
  output.position = frame.worldViewProjection * worldPosition;
  output.position.xy += frame.clipOffset * output.position.w;
  output.color = vec4<f32>(
    mix(vec3<f32>(1.0), color, frame.useVertexColor) * frame.color.rgb,
    frame.color.a
  );
  output.semantic = select(
    vertexSemantic,
    instanceSemantic,
    ${storageInstances ? 'true' : 'frame.useInstancing > 0.5'}
  );
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (frame.pickMode > 0.5) {
    let id = u32(frame.pickBase) + input.semantic + 1u;
    return vec4<f32>(
      f32(id & 255u),
      f32((id >> 8u) & 255u),
      f32((id >> 16u) & 255u),
      255.0
    ) / 255.0;
  }
  if (
    frame.useSemantic > 0.5
    && abs(f32(input.semantic) - frame.highlightSemantic) > 0.1
  ) {
    discard;
  }
  ${selectionMask
    ? `
  let isSelected =
    selection[u32(frame.selectionBase) + input.semantic] != 0u;
  if (frame.useSelectionMask > 0.5) {
    if (frame.useSemantic > 0.5 && !isSelected) {
      discard;
    }
    if (isSelected) {
      return vec4<f32>(
        mix(
          input.color.rgb,
          vec3<f32>(1.0, 208.0 / 255.0, 0.0),
          0.65
        ),
        1.0
      );
    }
  }`
    : ''}
  return input.color;
}
`;

const VERTEX_LAYOUT: GPUVertexBufferLayout[] = [
  {
    arrayStride: 24,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ],
  },
  {
    arrayStride: 80,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x4' },
      { shaderLocation: 3, offset: 16, format: 'float32x4' },
      { shaderLocation: 4, offset: 32, format: 'float32x4' },
      { shaderLocation: 5, offset: 48, format: 'float32x4' },
      { shaderLocation: 6, offset: 64, format: 'uint32' },
    ],
  },
  {
    arrayStride: 4,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 7, offset: 0, format: 'uint32' },
    ],
  },
];

const STORAGE_VERTEX_LAYOUT: GPUVertexBufferLayout[] = [
  VERTEX_LAYOUT[0]!,
  {
    arrayStride: 4,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 2, offset: 0, format: 'uint32' },
    ],
  },
];

export class WebGPURenderPipeline {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly triangle: GPURenderPipeline;
  readonly line: GPURenderPipeline;
  readonly selectionTriangle: GPURenderPipeline;
  readonly selectionLine: GPURenderPipeline;
  readonly selectionMask: boolean;
  readonly storageInstances: boolean;
  readonly indirectInstances: boolean;

  private constructor(
    readonly device: GPUDevice,
    readonly format: GPUTextureFormat,
    bindGroupLayout: GPUBindGroupLayout,
    pipelineLayout: GPUPipelineLayout,
    triangle: GPURenderPipeline,
    line: GPURenderPipeline,
    selectionTriangle: GPURenderPipeline,
    selectionLine: GPURenderPipeline,
    selectionMask: boolean,
    storageInstances: boolean,
    indirectInstances: boolean,
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.pipelineLayout = pipelineLayout;
    this.triangle = triangle;
    this.line = line;
    this.selectionTriangle = selectionTriangle;
    this.selectionLine = selectionLine;
    this.selectionMask = selectionMask;
    this.storageInstances = storageInstances;
    this.indirectInstances = indirectInstances;
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    options: {
      readonly selectionMask?: boolean;
      readonly storageInstances?: boolean;
      readonly indirectInstances?: boolean;
    } = {},
  ): Promise<WebGPURenderPipeline> {
    try {
      const storageInstances = Boolean(options.storageInstances);
      const indirectInstances = (
        storageInstances && Boolean(options.indirectInstances)
      );
      const selectionMask = Boolean(
        options.selectionMask || storageInstances,
      );
      const bindGroupEntries: GPUBindGroupLayoutEntry[] = [{
        binding: 0,
        visibility: 3,
        buffer: {
          type: 'uniform',
          hasDynamicOffset: true,
          minBindingSize: WEBGPU_UNIFORM_BYTES,
        },
      }];
      if (selectionMask) {
        bindGroupEntries.push({
          binding: 1,
          visibility: 2,
          buffer: {
            type: 'read-only-storage',
            minBindingSize: 4,
          },
        });
      }
      if (storageInstances) {
        bindGroupEntries.push({
          binding: 2,
          visibility: 1,
          buffer: {
            type: 'read-only-storage',
            minBindingSize: 96,
          },
        });
      }
      if (indirectInstances) {
        bindGroupEntries.push({
          binding: 3,
          visibility: 1,
          buffer: {
            type: 'read-only-storage',
            minBindingSize: 4,
          },
        });
      }
      const bindGroupLayout = device.createBindGroupLayout({
        entries: bindGroupEntries,
      });
      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });
      const module = device.createShaderModule({
        code: SHADER_SOURCE(
          selectionMask,
          storageInstances,
          indirectInstances,
        ),
      });
      const createPipeline = (
        label: string,
        topology: GPUPrimitiveTopology,
        selection = false,
      ) => device.createRenderPipelineAsync({
        label: indirectInstances
          ? `${label}:storage:indirect`
          : storageInstances
            ? `${label}:storage`
            : label,
        layout: pipelineLayout,
        vertex: {
          module,
          entryPoint: 'vertexMain',
          buffers: storageInstances
            ? STORAGE_VERTEX_LAYOUT
            : VERTEX_LAYOUT,
        },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{
            format,
            ...(selection
              ? {
                  blend: {
                    color: {
                      srcFactor: 'src-alpha' as GPUBlendFactor,
                      dstFactor: 'one-minus-src-alpha' as GPUBlendFactor,
                      operation: 'add' as GPUBlendOperation,
                    },
                    alpha: {
                      srcFactor: 'one' as GPUBlendFactor,
                      dstFactor: 'one-minus-src-alpha' as GPUBlendFactor,
                      operation: 'add' as GPUBlendOperation,
                    },
                  },
                }
              : {}),
          }],
        },
        primitive: {
          topology,
          cullMode: 'none',
        },
        depthStencil: {
          format: 'depth24plus',
          depthCompare: 'less-equal',
          depthWriteEnabled: !selection,
        },
        multisample: { count: 1 },
      });
      const [
        triangle,
        line,
        selectionTriangle,
        selectionLine,
      ] = await Promise.all([
        createPipeline('main:triangle', 'triangle-list'),
        createPipeline('main:line', 'line-list'),
        createPipeline('selection:triangle', 'triangle-list', true),
        createPipeline('selection:line', 'line-list', true),
      ]);
      return new WebGPURenderPipeline(
        device,
        format,
        bindGroupLayout,
        pipelineLayout,
        triangle,
        line,
        selectionTriangle,
        selectionLine,
        selectionMask,
        storageInstances,
        indirectInstances,
      );
    } catch (error) {
      throw new ICEEngineError(
        'ICE3_WEBGPU_PIPELINE_FAILED',
        'ICE3_WEBGPU_PIPELINE_FAILED: render pipelines are unavailable',
        { cause: error },
      );
    }
  }
}
