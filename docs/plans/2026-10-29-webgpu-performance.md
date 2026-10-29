# ICE3 WebGPU Performance Optimization Implementation Plan

> Document ID: ICE3-ENG-PLAN-005
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可信的 WebGPU 性能测量，并分阶段消除 Selection、上传和命令编码开销，最终在证明有效的大规模场景启用 Storage Buffer、Compute Visibility 和 Indirect Draw。

**Architecture:** 先增加 Scene revision、CPU 阶段计时、GPU timestamp 和规模化场景；再通过 Selection Mask、持久 Draw Storage、增量 Instance 上传和 Render Bundle 解决已确认的瓶颈；最后按设备能力逐层启用 Instance Storage Buffer 与 GPU-driven Visibility。所有优化层失败都保持 WebGPU 功能并回落到正确较慢路径。

**Tech Stack:** Node.js 24.22.1 LTS、npm 11、TypeScript 7、Node.js test runner、`expect`、Webpack 5、Playwright 1.64.1、WebGL2、WebGPU、WGSL、`@webgpu/types` 0.1.74。

**Spec:** [`docs/specs/2026-10-29-webgpu-performance-design.md`](../specs/2026-10-29-webgpu-performance-design.md)

## Global Constraints

- 所有命令使用 Node.js `24.22.1` LTS 和 npm 11 或更高版本。
- 在 `feature/webgpu-renderer` 功能分支开发；完整验证通过后才可合入 `main`。
- 所有 Git author 和 committer 名称必须是 `damoqiongqiu`。
- 每项 behavior 必须先写失败测试、观察正确失败，再写最小实现。
- 不增加 runtime dependency。
- 不增加公开 Renderer 配置开关；只新增只读 `ICEScene.revision` 公共状态。
- WebGPU、Adapter、Device、Buffer、Texture、Query Set 和原始 Limit 对象不进入公开 `ice3` API 或 Diagnostic。
- `@webgpu/types@0.1.74` 只作为 development dependency。
- Benchmark 固定 Canvas `1280 x 720`、DPR `1`、warm-up `60`、measurement `300`、至少 `5` 次重复。
- GPU 时间只接受合法 timestamp；不可用时输出 `null` 和稳定原因，不使用 rAF 或 CPU 时间代替。
- `wastewater-1x` 相对优化前 WebGPU 的 CPU 中位数和 p95 回退均不超过 10%；可用 GPU 时间回退不超过 5%。
- `selection` 的 Draw 数不得超过常规 Geometry Draw 与必要 Edge Overlay Draw 之和。
- Storage 路径只有在至少 10% CPU 中位数收益且 GPU 回退不超过 5% 时才默认启用。
- Compute/Indirect 路径只有在 CPU render 中位数至少改善 20%、端到端 CPU 准备改善 10% 且 GPU 回退不超过 5% 时才默认启用。
- 本机 Benchmark 输出写入 Git ignore 的 `output/benchmarks/`；不提交设备指纹或绝对结果路径。
- 文档、代码和 fixture 不得包含客户模型、外部品牌或未脱敏数据。
- 每个任务结束运行受影响测试并提交；最终运行 `npm run verify`、`npm run release:check` 和 `npm run benchmark:renderers`。

## Review Focus

- Scene 节点可见性或局部矩阵改变但 revision 未增加时，会让复用 Bundle/Schedule 使用陈旧变换；Task 1 的 revision 测试和 Task 7 的失效测试必须覆盖。
- 同一 Instance Batch 或 Render Batch 含多个 selection semantic 时，Mask 偏移或 Edge discard 错误会选中错误设备；Task 5 用一个 Batch 多选项测试覆盖。
- Fragment Storage、Bundle、Instance Storage 或 Indirect Draw 不可用时，任一异常不能导致黑屏、静默切换 WebGL2 或每帧重复 warning；Task 5、8、9、10 分别覆盖 fallback。
- timestamp Query 过早 Map、复用尚未 Resolve 的槽位或失败时伪造数据会污染性能结论；Task 3 覆盖零值、倒退、Map 失败和环形槽位耗尽。
- resize、Device Lost、backend dispose 后仍引用旧 Uniform、Bundle、Storage、Visibility 或 Query 资源会产生隐形 validation error；Task 7 至 Task 11 的失效和生命周期测试覆盖。

---

### Task 1: Scene Revision

**Files:**

- Modify: `packages/core/src/scene/ICENode.ts`
- Modify: `packages/core/src/scene/ICEScene.ts`
- Test: `packages/core/tests/Scene.test.ts`

**Interfaces:**

- Consumes: existing `ICENode.addChild()`, `removeChild()`, `visible`, and `setLocalMatrix()`.
- Produces: `ICENode.revision: number` and `ICEScene.revision: number`, both returning the root Scene's monotonically increasing revision.

- [ ] **Step 1: Add failing revision tests**

Append to `packages/core/tests/Scene.test.ts`:

```ts
describe('scene revision', () => {
  it('changes for structure, visibility, and local transform mutations', () => {
    const scene = new ICEScene({ id: 'scene' });
    const node = mesh('revision-node');
    const initial = scene.revision;

    scene.addChild(node);
    const added = scene.revision;
    node.visible = false;
    const hidden = scene.revision;
    node.setLocalMatrix([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      4, 0, 0, 1,
    ]);
    const transformed = scene.revision;
    scene.removeChild(node);

    expect(added).toBeGreaterThan(initial);
    expect(hidden).toBeGreaterThan(added);
    expect(transformed).toBeGreaterThan(hidden);
    expect(scene.revision).toBeGreaterThan(transformed);
  });

  it('does not change when values are identical', () => {
    const scene = new ICEScene({ id: 'scene' });
    const node = mesh('stable-node');
    scene.addChild(node);
    const revision = scene.revision;
    node.visible = true;
    expect(scene.revision).toBe(revision);
  });

  it('changes the old and new roots when moving a subtree', () => {
    const first = new ICEScene({ id: 'first' });
    const second = new ICEScene({ id: 'second' });
    const branch = mesh('branch');
    first.addChild(branch);
    const firstRevision = first.revision;
    const secondRevision = second.revision;

    second.addChild(branch);

    expect(first.revision).toBeGreaterThan(firstRevision);
    expect(second.revision).toBeGreaterThan(secondRevision);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/core/tests/Scene.test.ts
```

Expected: FAIL because `ICENode` has no `revision` property.

- [ ] **Step 3: Implement root revision propagation**

In `ICENode`, replace the public `visible = true` field with a setter and add
the revision state:

```ts
private _visible = true;
private _revision = 0;

get visible(): boolean {
  return this._visible;
}

set visible(value: boolean) {
  if (value === this._visible) return;
  this._visible = value;
  this.markSceneChanged();
}

get revision(): number {
  return this.getRoot()._revision;
}

private markSceneChanged(): void {
  this.getRoot()._revision += 1;
}
```

Call `this.markSceneChanged()` after a successful attach in `addChild()`,
after removing a child in `removeChild()`, and after assigning a valid local
matrix in `setLocalMatrix()`. In `addChild()`, moving an attached node through
`node._parent.removeChild(node, { dispose: false })` must happen before attaching
to the new root so both roots receive revisions.

`ICEScene` inherits the getter and does not maintain a second counter:

```ts
export class ICEScene extends ICENode {
  constructor(options: ICENodeOptions) {
    super(options);
  }

  override get typeId(): string {
    return 'ice3:Scene';
  }
}
```

- [ ] **Step 4: Verify GREEN and regression**

Run:

```bash
npm test -- packages/core/tests/Scene.test.ts
npm test -- packages/core
```

Expected: revision tests pass and all Core tests pass. Serialization output must
remain unchanged because revision is runtime state, not Scene data.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scene/ICENode.ts packages/core/src/scene/ICEScene.ts packages/core/tests/Scene.test.ts
git commit -m "feat: track scene revision"
```

---

### Task 2: CPU Stage Profiling

**Files:**

- Create: `packages/renderer/src/RendererProfiler.ts`
- Create: `packages/renderer/tests/RendererProfiler.test.ts`
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `benchmarks/core/types.ts`
- Modify: `benchmarks/web/main.ts`
- Modify: `benchmarks/report.ts`
- Modify: `benchmarks/report.test.ts`

**Interfaces:**

- Consumes: existing `render(frame)` phase boundaries in both backends.
- Produces: `ICEFrameStageProfile`, `RendererProfiler`, backend
  `enableProfiling(enabled: boolean): void`, and `lastFrameProfile`.

```ts
export type ICEFrameStageProfile = Readonly<{
  collectMs: number;
  prepareAndUploadMs: number;
  encodeMs: number;
  submitMs: number;
}>;
```

- [ ] **Step 1: Write the failing profiler test**

Create `packages/renderer/tests/RendererProfiler.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { RendererProfiler } from '../src/RendererProfiler';

it('records four non-negative stage durations when enabled', () => {
  const profiler = new RendererProfiler();
  profiler.enable(true);
  profiler.begin();
  profiler.mark('collect');
  profiler.mark('prepareAndUpload');
  profiler.mark('encode');
  profiler.mark('submit');
  const profile = profiler.end();

  expect(profile).not.toBeNull();
  for (const value of Object.values(profile!)) {
    expect(value).toBeGreaterThanOrEqual(0);
  }
});

it('performs no profile work while disabled', () => {
  const profiler = new RendererProfiler();
  profiler.begin();
  profiler.mark('collect');
  expect(profiler.end()).toBeNull();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/RendererProfiler.test.ts
```

Expected: FAIL because the profiler module does not exist.

- [ ] **Step 3: Implement the profiler**

Create `RendererProfiler.ts` with:

```ts
export type ICEFrameStageProfile = Readonly<{
  collectMs: number;
  prepareAndUploadMs: number;
  encodeMs: number;
  submitMs: number;
}>;

type Stage = 'collect' | 'prepareAndUpload' | 'encode' | 'submit';

export class RendererProfiler {
  private enabled = false;
  private frameStartedAt = 0;
  private cursor = 0;
  private readonly marks = new Map<Stage, number>();

  enable(value: boolean): void {
    this.enabled = value;
    this.marks.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  begin(): void {
    if (!this.enabled) return;
    this.frameStartedAt = performance.now();
    this.cursor = this.frameStartedAt;
    this.marks.clear();
  }

  mark(stage: Stage): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.marks.set(stage, Math.max(0, now - this.cursor));
    this.cursor = now;
  }

  end(): ICEFrameStageProfile | null {
    if (!this.enabled) return null;
    return {
      collectMs: this.marks.get('collect') ?? 0,
      prepareAndUploadMs: this.marks.get('prepareAndUpload') ?? 0,
      encodeMs: this.marks.get('encode') ?? 0,
      submitMs: this.marks.get('submit')
        ?? Math.max(0, performance.now() - this.cursor),
    };
  }
}
```

Export the class and type from `packages/renderer/src/index.ts`.

- [ ] **Step 4: Instrument both render backends**

Add to each backend:

```ts
private readonly profiler = new RendererProfiler();
private lastFrameProfile: ICEFrameStageProfile | null = null;

enableProfiling(enabled: boolean): void {
  this.profiler.enable(enabled);
  this.lastFrameProfile = null;
}

get frameProfile(): ICEFrameStageProfile | null {
  return this.lastFrameProfile;
}
```

At the start of `render()`, call `this.profiler.begin()`. Mark `collect` after
Scene/renderable/batch collection, `prepareAndUpload` after buffer writes,
`encode` after command encoding, and `submit` after `queue.submit()` or the
WebGL2 draw submission. Store `this.lastFrameProfile = this.profiler.end()`
before returning. Keep all calls inside `if (this.profiler.isEnabled)` branches
where a mark would otherwise add production overhead.

Add these to the benchmark result:

```ts
export type ICEBenchmarkCpuStageSamples = Readonly<{
  collectMs: readonly number[];
  prepareAndUploadMs: readonly number[];
  encodeMs: readonly number[];
  submitMs: readonly number[];
}>;
```

`benchmarks/web/main.ts` enables profiling once per backend and pushes the four
`backend.frameProfile` fields after every measured `render()`.

- [ ] **Step 5: Add report schema and failing report assertions**

Extend `ICEBenchmarkRunInput.samples` with `cpuStages:
ICEBenchmarkCpuStageSamples`. Extend report metrics with four summaries. Add to
`benchmarks/report.test.ts`:

```ts
it('reports CPU stage summaries alongside total CPU time', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [{
      backend: 'webgpu',
      scenario: 'wastewater-1x',
      warmupFrames: 60,
      measuredFrames: 2,
      initializationMs: 5,
      samples: {
        cpuFrameMs: [1, 2],
        cpuStages: {
          collectMs: [0.1, 0.1],
          prepareAndUploadMs: [0.2, 0.2],
          encodeMs: [0.3, 0.3],
          submitMs: [0.4, 0.4],
        },
        gpuFrameMs: null,
        pickMs: [],
      },
    }],
  });
  expect(report.runs[0]?.metrics.cpuStages.collectMs.median).toBe(0.1);
  expect(report.runs[0]?.metrics.cpuStages.submitMs.p95).toBe(0.4);
});
```

Run:

```bash
npm test -- benchmarks/report.test.ts
```

Expected: FAIL because stage samples are absent from the report schema.

- [ ] **Step 6: Implement report summaries and Markdown columns**

Summarize every stage with existing `summarizeSamples()`. Add Markdown columns
named `Collect ms`, `Prepare ms`, `Encode ms`, and `Submit ms`. Keep total CPU
median and p95 columns. The runner groups raw stage arrays with `flatMap`, using
the same grouping as `cpuFrameMs`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- packages/renderer/tests/RendererProfiler.test.ts
npm test -- packages/renderer
npm test -- benchmarks
npm run typecheck
```

Expected: all pass. A normal backend render with profiling disabled continues
to leave `frameProfile` equal to `null`.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/RendererProfiler.ts packages/renderer/src/index.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/tests/RendererProfiler.test.ts benchmarks/core/types.ts benchmarks/web/main.ts benchmarks/report.ts benchmarks/report.test.ts
git commit -m "feat: profile renderer frame stages"
```

---

### Task 3: WebGPU Timestamp Profiler

**Files:**

- Modify: `packages/renderer/src/WebGPUProbe.ts`
- Create: `packages/renderer/src/WebGPUTimestampProfiler.ts`
- Create: `packages/renderer/tests/WebGPUTimestampProfiler.test.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `benchmarks/web/main.ts`
- Modify: `benchmarks/report.ts`

**Interfaces:**

- Consumes: `GPUDevice.features.has('timestamp-query')`, `GPUQuerySet`, and
  `GPUCommandEncoder.resolveQuerySet()`.
- Produces: `ICEWebGPUProbeOptions.optionalFeatures`,
  `WebGPUTimestampProfiler.create()`, `resolveFrame()`, and `drain()`.

- [ ] **Step 1: Extend the fake with query and optional-feature capture**

Add to `fakeWebGPUDevice()`:

```ts
const deviceRequests: GPUDeviceDescriptor[] = [];
const querySets: Array<{
  type: GPUQueryType;
  count: number;
  destroyed: boolean;
}> = [];
let timestampValues = [1_000_000_000, 1_002_000_000];

device.features = new Set<GPUFeatureName>(['timestamp-query']);
device.createQuerySet = (description: GPUQuerySetDescriptor) => {
  const querySet = {
    ...description,
    destroyed: false,
    destroy() {
      querySet.destroyed = true;
    },
  };
  querySets.push(querySet);
  return querySet as GPUQuerySet;
};
```

Extend `queue.writeBuffer()` so writes targeting a `timestamp-resolve` buffer
store their bytes, and extend `queue.readBuffer()` to write the current
`BigUint64Array(timestampValues)` into the destination. Add return helpers:

```ts
deviceRequests,
querySets,
setTimestampValues(values: readonly number[]) {
  timestampValues = [...values];
},
```

Record the descriptor passed to `adapter.requestDevice(descriptor)` in both
probe and backend fake adapters.

- [ ] **Step 2: Write failing query lifecycle tests**

Create `packages/renderer/tests/WebGPUTimestampProfiler.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUTimestampProfiler } from '../src/WebGPUTimestampProfiler';
import { fakeWebGPUDevice } from './fake-webgpu';

it('returns a two-millisecond GPU duration', async () => {
  const fake = fakeWebGPUDevice();
  fake.setTimestampValues([1_000_000_000, 1_002_000_000]);
  const profiler = new WebGPUTimestampProfiler(fake.device, 4);
  const encoder = fake.device.createCommandEncoder();
  profiler.resolveFrame(encoder, 1);
  expect(await profiler.drain()).toEqual([2]);
  profiler.dispose();
  expect(fake.querySets[0]?.destroyed).toBe(true);
});

it('rejects zero and backwards durations', async () => {
  const fake = fakeWebGPUDevice();
  fake.setTimestampValues([1_000_000_000, 1_000_000_000]);
  const profiler = new WebGPUTimestampProfiler(fake.device, 2);
  profiler.resolveFrame(fake.device.createCommandEncoder(), 1);
  expect(await profiler.drain()).toEqual([]);
  expect(profiler.unavailableReason).toBe('invalid-timestamp');
});

it('never overwrites an unresolved ring slot', () => {
  const fake = fakeWebGPUDevice();
  const profiler = new WebGPUTimestampProfiler(fake.device, 1);
  profiler.resolveFrame(fake.device.createCommandEncoder(), 1);
  expect(() => (
    profiler.resolveFrame(fake.device.createCommandEncoder(), 2)
  )).toThrowError(/ICE3_TIMESTAMP_SLOT_BUSY/);
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUTimestampProfiler.test.ts
```

Expected: FAIL because `WebGPUTimestampProfiler` does not exist.

- [ ] **Step 4: Add optional probe features**

Extend the probe options:

```ts
export type ICEWebGPUProbeOptions = {
  readonly gpu?: GPU;
  readonly timeoutMs?: number;
  readonly createCanvas?: () => OffscreenCanvas | HTMLCanvasElement;
  readonly optionalFeatures?: readonly GPUFeatureName[];
};
```

Before `requestDevice()`, compute:

```ts
const features = (options.optionalFeatures ?? [])
  .filter((feature) => adapter.features.has(feature));
device = await adapter.requestDevice({
  ...(features.length > 0 ? { requiredFeatures: features } : {}),
});
```

Add `enabledFeatures: ReadonlySet<GPUFeatureName>` to the supported result and
copy `device.features`. Never request an unsupported optional feature.

- [ ] **Step 5: Implement a bounded query ring**

Create `WebGPUTimestampProfiler.ts` with one Query Set and one Resolve Buffer per
slot:

```ts
type Slot = {
  readonly querySet: GPUQuerySet;
  readonly buffer: GPUBuffer;
  pending: boolean;
};

export class WebGPUTimestampProfiler {
  private readonly slots: Slot[];
  private readonly pending: number[] = [];
  private reason: string | undefined;

  constructor(device: GPUDevice, slotCount = 64) {
    if (!Number.isInteger(slotCount) || slotCount < 1) {
      throw new Error('ICE3_TIMESTAMP_INVALID');
    }
    this.slots = Array.from({ length: slotCount }, (_, index) => ({
      querySet: device.createQuerySet({
        label: `ice3:timestamp:${index}`,
        type: 'timestamp',
        count: 2,
      }),
      buffer: device.createBuffer({
        label: `ice3:timestamp-resolve:${index}`,
        size: 256,
        usage: 512 | 8 | 1,
      }),
      pending: false,
    }));
  }

  get unavailableReason(): string | undefined {
    return this.reason;
  }

  resolveFrame(encoder: GPUCommandEncoder, frameId: number): void {
    const index = frameId % this.slots.length;
    const slot = this.slots[index]!;
    if (slot.pending) throw new Error('ICE3_TIMESTAMP_SLOT_BUSY');
    encoder.resolveQuerySet(slot.querySet, 0, 2, slot.buffer, 0);
    this.pending.push(index);
    slot.pending = true;
  }
}
```

Implement `drain(): Promise<readonly number[]>` so it maps each pending slot,
reads two `bigint` values, validates `end > start`, stores
`Number(end - start) / 1_000_000`, unmaps, and clears `pending`. A Map failure,
zero duration, or backwards duration appends no sample and sets
`unavailableReason` to `map-failed` or `invalid-timestamp`. `dispose()` destroys
every Query Set and Buffer and clears pending state.

The backend renderer accepts Query Set writes through its Render Pass descriptor:

```ts
const timestampWrites = this.timestampProfiler
  ? {
      querySet: this.timestampProfiler.currentQuerySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    }
  : undefined;
```

Expose `currentQuerySet` only on the internal profiler. Do not add Query Set to
Diagnostic or benchmark JSON.

- [ ] **Step 6: Integrate timestamp collection into the benchmark**

Create the benchmark WebGPU backend with:

```ts
const probe = await probeWebGPU({
  optionalFeatures: ['timestamp-query'],
});
```

The WebGPU backend constructs a profiler only if
`probe.enabledFeatures.has('timestamp-query')`. Benchmark `finish()` drains and
appends durations in frame order. In a measurement batch of 30 frames, call
`finish()` before draining. If the Adapter lacks the feature, return
`gpuFrameMs: null` and `gpuFrameTimeUnavailableReason:
'timestamp-query unavailable'`.

`benchmarks/report.ts` must accept `gpuFrameMs: []` as unavailable and never
compute GPU improvement without two non-empty valid summaries.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUTimestampProfiler.test.ts
npm test -- packages/renderer
npm test -- benchmarks
npm run typecheck
```

Expected: all pass. A zero, backwards, failed Map, or unavailable feature
produces no synthetic GPU value.

- [ ] **Step 8: Run the instrumented baseline**

Run:

```bash
npm run benchmark:renderers
```

Record the two generated paths from `output/benchmarks/`. Verify CPU stage sum
tracks total CPU time within measurement noise and existing scenarios retain
`gpuFrameMs = null` when the browser does not expose a valid timer. Do not commit
the generated files.

- [ ] **Step 9: Commit**

```bash
git add packages/renderer/src/WebGPUProbe.ts packages/renderer/src/WebGPUTimestampProfiler.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUProbe.test.ts packages/renderer/tests/WebGPUTimestampProfiler.test.ts packages/renderer/tests/fake-webgpu.ts benchmarks/web/main.ts benchmarks/report.ts benchmarks/report.test.ts
git commit -m "feat: capture WebGPU timestamps"
```

---

### Task 4: Scale and Visibility Scenarios

**Files:**

- Create: `benchmarks/core/cloneScene.ts`
- Create: `benchmarks/core/cloneScene.test.ts`
- Modify: `benchmarks/core/scenarios.ts`
- Modify: `benchmarks/core/scenarios.test.ts`
- Modify: `benchmarks/core/types.ts`
- Modify: `benchmarks/web/main.ts`
- Modify: `benchmarks/run-renderers.mjs`

**Interfaces:**

- Consumes: `ICEScene`, `ICEMesh`, and `ICERenderBatch` from existing runtime.
- Produces: `cloneBenchmarkScene(source, copies): ICEScene`,
  `culling-20k`, `instanced-50k`, `wastewater-1x|5x|20x`.

- [ ] **Step 1: Write failing clone and scale tests**

Create `benchmarks/core/cloneScene.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { cloneBenchmarkScene } from './cloneScene';

it('clones geometry references with unique node and selection IDs', () => {
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const source = new ICEScene({ id: 'source' });
  source.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry,
    material,
  }));

  const cloned = cloneBenchmarkScene(source, 2);
  const meshes = cloned.children.flatMap((copy) => copy.children);

  expect(meshes).toHaveLength(2);
  expect(new Set(meshes.map((node) => node.id)).size).toBe(2);
  expect(new Set(meshes.map((node) => (
    node as ICEMesh
  ).selectionId)).size).toBe(2);
  expect((meshes[0] as ICEMesh).geometry).toBe(geometry);
});
```

Add to `scenarios.test.ts`:

```ts
it('declares scale and GPU-culling workloads', () => {
  expect(benchmarkScene('instanced-50k').instanceCount).toBe(50_000);
  expect(benchmarkScene('culling-20k').instanceCount).toBe(20_000);
  expect(benchmarkScene('culling-20k').visibleInstanceHint).toBe(5_000);
  expect(benchmarkScene('wastewater-5x').scale).toBe(5);
  expect(benchmarkScene('wastewater-20x').scale).toBe(20);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- benchmarks/core
```

Expected: FAIL because the clone helper and Scenario IDs do not exist.

- [ ] **Step 3: Implement deterministic Scene cloning**

Define `ICEBenchmarkScene` additions:

```ts
readonly scale: number;
readonly visibleInstanceHint?: number;
```

Implement cloning by wrapping each copy in a translated `ICENode` container and
recursively recreating known node types. Preserve Geometry and Material object
identity:

```ts
const copyId = (copy: number, id: string): string => (
  `${id}:benchmark-copy/${copy}`
);

function copyChildren(
  source: ICENode,
  target: ICENode,
  copy: number,
): void {
  for (const child of source.children) {
    const json = child.toJSON();
    const id = copyId(copy, child.id);
    let next: ICENode;
    if (child instanceof ICEMesh) {
      next = new ICEMesh({
        id,
        displayName: child.displayName,
        selectionId: copyId(copy, child.selectionId),
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
        geometry: child.geometry,
        material: child.material,
      });
    } else if (child instanceof ICERenderBatch) {
      next = new ICERenderBatch({
        id,
        displayName: child.displayName,
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
        geometry: child.geometry,
        material: child.material,
        semanticIds: child.semanticIds,
        semanticNodeIds: child.semanticNodeIds.map((value) => copyId(copy, value)),
        semanticSelectionIds: child.semanticSelectionIds.map(
          (value) => copyId(copy, value),
        ),
        materialKey: child.materialKey,
      });
    } else {
      next = new ICENode({
        id,
        displayName: child.displayName,
        position: json.position,
        rotation: json.rotation,
        scale: json.scale,
        ...(json.matrix ? { matrix: json.matrix } : {}),
      });
    }
    target.addChild(next);
    copyChildren(child, next, copy);
  }
}

export function cloneBenchmarkScene(
  source: ICEScene,
  copies: number,
): ICEScene {
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error('ICE3_BENCHMARK_INVALID: copies must be positive');
  }
  const scene = new ICEScene({ id: `${source.id}:scale/${copies}` });
  for (let copy = 0; copy < copies; copy += 1) {
    const container = new ICENode({
      id: `${source.id}:benchmark-copy-group/${copy}`,
      position: [copy * 500, 0, copy * 500],
    });
    scene.addChild(container);
    copyChildren(source, container, copy);
  }
  return scene;
}
```

For a copy count of `1`, benchmark loading still uses the source Scene directly
so the real Asset baseline is not altered.

- [ ] **Step 4: Add Scenario construction**

Create `instanced-50k` with the existing shared Box and a deterministic
200-by-250 grid. Create `culling-20k` with four groups of 5,000 instances:

- One group is inside the fixed Camera frustum.
- Three groups are translated far behind or outside the frustum.

Set `visibleInstanceHint = 5000`. The hint is benchmark metadata, not a GPU
readback and not a claimed measured count.

After `wastewater-mixed` finishes loading, call:

```ts
const scaled = benchmark.scale > 1
  ? cloneBenchmarkScene(handle.scene, benchmark.scale)
  : handle.scene;
engine.setScene(scaled).start();
```

Update the overlay scenario list and runner order to include:

```ts
'instanced-50k',
'culling-20k',
'wastewater-1x',
'wastewater-5x',
'wastewater-20x',
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- benchmarks/core
npm run typecheck
npm run benchmark:renderers
```

Expected: tests pass. On a WebGPU-capable machine, all new scenarios produce
reports; the 20x run may be slow but must not throw or reuse duplicate IDs.
If this device cannot complete 20x within the benchmark timeout, record the
resource failure and reduce the default repetitions only through an explicit
CLI argument, not by silently changing recorded sample counts.

- [ ] **Step 6: Commit**

```bash
git add benchmarks/core/cloneScene.ts benchmarks/core/cloneScene.test.ts benchmarks/core/scenarios.ts benchmarks/core/scenarios.test.ts benchmarks/core/types.ts benchmarks/web/main.ts benchmarks/run-renderers.mjs
git commit -m "feat: add scalable WebGPU benchmarks"
```

---

### Task 5: Selection Mask

**Files:**

- Create: `packages/renderer/src/WebGPUSelectionMask.ts`
- Create: `packages/renderer/tests/WebGPUSelectionMask.test.ts`
- Modify: `packages/renderer/src/WebGPURenderPipeline.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/tests/WebGPUFrames.test.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Modify: `tests/e2e/renderer-selection.spec.ts`

**Interfaces:**

- Consumes: each Draw's semantic list and normalized Selection IDs.
- Produces: `buildSelectionMask(ranges, selection)` and
  `WebGPUSelectionMaskBuffer`.

```ts
export type ICESelectionMaskLayout = Readonly<{
  words: Uint32Array;
  bases: readonly number[];
}>;
```

- [ ] **Step 1: Write failing pure Mask tests**

Create `packages/renderer/tests/WebGPUSelectionMask.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { buildSelectionMask } from '../src/WebGPUSelectionMask';

it('maps multiple semantic ranges without selected-object draws', () => {
  const result = buildSelectionMask(
    [['pump-a', 'pump-b'], ['valve', 'tank']],
    ['tank', 'pump-b', 'pump-b'],
  );
  expect(result.bases).toEqual([0, 2]);
  expect([...result.words]).toEqual([0, 1, 0, 1]);
});

it('returns one aligned word for an empty selection', () => {
  const result = buildSelectionMask([[]], []);
  expect(result.bases).toEqual([0]);
  expect(result.words.byteLength).toBe(4);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUSelectionMask.test.ts
```

Expected: FAIL because `buildSelectionMask` does not exist.

- [ ] **Step 3: Implement the Mask data and buffer**

Use this implementation:

```ts
export function buildSelectionMask(
  ranges: readonly (readonly string[])[],
  selection: readonly string[],
): ICESelectionMaskLayout {
  const selected = new Set(selection);
  const bases: number[] = [];
  let count = 0;
  for (const range of ranges) {
    bases.push(count);
    count += range.length;
  }
  const words = new Uint32Array(Math.max(1, count));
  ranges.forEach((range, rangeIndex) => {
    const base = bases[rangeIndex]!;
    range.forEach((id, index) => {
      words[base + index] = selected.has(id) ? 1 : 0;
    });
  });
  return { words, bases };
}
```

`WebGPUSelectionMaskBuffer` owns a `STORAGE | COPY_DST` Buffer and writes only
when `words` differ from the last upload. Expose `buffer`, `generation`, and
`totalBytes`; increment `generation` only when the Buffer is replaced.
`dispose()` is idempotent.

- [ ] **Step 4: Add the Masked selection Shader path**

`WebGPURenderPipeline.create()` accepts:

```ts
options?: {
  readonly selectionMask?: boolean;
}
```

When enabled, Bind Group layout binding 1 is a read-only Storage Buffer visible
to Fragment. Add this Shader field and logic:

```wgsl
@group(0) @binding(1) var<storage, read> selection: array<u32>;

let maskIndex = u32(frame.selectionBase) + input.semantic;
let isSelected = selection[maskIndex] != 0u;

if (frame.useSelectionMask > 0.5 && isSelected) {
  return vec4<f32>(
    mix(input.color.rgb, vec3<f32>(1.0, 208.0 / 255.0, 0.0), 0.65),
    1.0
  );
}
```

Use the same test in the selection Edge Pipeline so non-selected Edge vertices
discard. Expand `WEBGPU_UNIFORM_BYTES` from 112 to 128 and use floats 28 and 29
for `selectionBase` and `useSelectionMask`.

- [ ] **Step 5: Integrate Mask ranges and fallback**

For each Draw, collect its semantic IDs into a range and apply the returned
base. Create one Mask Buffer per frame-resource generation. Bind it once per
frame. Remove per-selected-object triangle draws.

Edge behavior:

- If a Batch has no selected semantic, keep its normal material Edge draws.
- If any semantic is selected, add one Masked Selection Edge Overlay for the
  Batch.
- The overlay uses the same Mask and discards unselected Edges.

If Masked pipeline creation or Mask Buffer allocation fails:

1. Destroy partial Mask resources.
2. Recreate the previous non-Masked pipeline.
3. Use the existing per-selected-object Selection path.
4. Report `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE` once.
5. Continue rendering without changing Selection IDs or Pick behavior.

- [ ] **Step 6: Update frame and browser tests**

Replace the old 501-Draw expectation with:

```ts
it('does not add one triangle draw per selected instance', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  const frame = repeatedSelectionFrame(2000, 500);

  backend.render(frame);

  expect(backend.stats.drawCalls).toBe(1);
  expect(fake.draws).toHaveLength(1);
});
```

Add an Edge Batch fixture with two selected semantics and expect one tint Draw
plus one `selection:line` overlay. Add an E2E assertion that the wastewater
selected device still renders yellow pixels and Pick returns the same ID.

- [ ] **Step 7: Verify GREEN and benchmark**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUSelectionMask.test.ts
npm test -- packages/renderer
npm run test:e2e -- tests/e2e/renderer-selection.spec.ts tests/e2e/wastewater-plant.spec.ts
npm run benchmark:renderers
```

Expected: Selection Draw no longer scales with selected count. Compare
`selection` and `wastewater-1x` with the Task 3 baseline. If wastewater-1x CPU
median or p95 regresses by more than 10%, stop and profile before proceeding.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/WebGPUSelectionMask.ts packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUSelectionMask.test.ts packages/renderer/tests/WebGPUFrames.test.ts packages/renderer/tests/fake-webgpu.ts tests/e2e/renderer-selection.spec.ts
git commit -m "perf: mask WebGPU selections"
```

---

### Task 6: Incremental Instances and Persistent Draw Storage

**Files:**

- Create: `packages/renderer/src/WebGPUDrawStorage.ts`
- Create: `packages/renderer/tests/WebGPUDrawStorage.test.ts`
- Modify: `packages/renderer/src/WebGPUInstanceCache.ts`
- Modify: `packages/renderer/tests/WebGPUInstanceCache.test.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`

**Interfaces:**

- Consumes: existing `ICEInstanceBatch` arrays and per-Draw frame parameters.
- Produces: `WebGPUDrawStorage.begin()`, `append()`, `uniformData`,
  `drawCount`, and incremental `WebGPUInstanceCache` writes.

- [ ] **Step 1: Write failing incremental upload tests**

Append to `WebGPUInstanceCache.test.ts`:

```ts
it('does not rewrite unchanged instance arrays', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = instanceBatch();
  cache.retain(batch);
  const initialWrites = writes.length;

  cache.retain(batch);

  expect(writes).toHaveLength(initialWrites);
});

it('rewrites matrices without rewriting unchanged semantics', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = instanceBatch();
  cache.retain(batch);
  const before = writes.length;

  cache.retain({
    ...batch,
    instanceMatrices: new Float32Array(batch.instanceMatrices.length),
  });

  expect(writes.slice(before).map((write) => write.size)).toEqual([128]);
});
```

Add a local `instanceBatch()` helper with two aligned matrices and semantics.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUInstanceCache.test.ts
```

Expected: FAIL because every `retain()` currently rewrites both buffers.

- [ ] **Step 3: Store content snapshots and write only changes**

Add these private fields to each cached entry:

```ts
matrixBytes?: Uint8Array;
semanticBytes?: Uint8Array;
```

On `retain()`, compare a byte snapshot with `sameBytes()`. Write the matrix only
when changed, semantic only when changed, and assign the new snapshot only
after a successful write. Buffer replacement resets both snapshots. Increment
`generation` only when a Buffer is created or recreated; content writes do not
invalidate Render Bundles.

- [ ] **Step 4: Write the failing Draw Storage test**

Create `WebGPUDrawStorage.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUDrawStorage } from '../src/WebGPUDrawStorage';

it('reuses typed storage when draw count stays within capacity', () => {
  const storage = new WebGPUDrawStorage(2);
  storage.begin(2);
  storage.append({
    matrix: new Float32Array(16),
    color: [1, 1, 1, 1],
    useVertexColor: false,
    useInstancing: false,
    selectionBase: 0,
    useSelectionMask: 1,
  });
  const first = storage.uniformData;
  storage.begin(2);
  storage.append({
    matrix: new Float32Array(16),
    color: [0, 0, 0, 1],
    useVertexColor: false,
    useInstancing: false,
    selectionBase: 0,
    useSelectionMask: 1,
  });

  expect(storage.uniformData).toBe(first);
  expect(storage.drawCount).toBe(1);
});
```

- [ ] **Step 5: Implement persistent Draw Storage**

Allocate Uniform storage with:

```ts
ensureCapacity(count: number): void {
  const next = Math.max(this.minimumCapacity, drawCountPowerOfTwo(count));
  if (next === this.capacity) return;
  this.capacity = next;
  this.data = new Float32Array(next * WEBGPU_UNIFORM_STRIDE / 4);
  this.generation += 1;
}
```

`append()` writes into `data` at `drawCount * 64`, increments `drawCount`, and
returns the element index. Matrices are copied with `data.set(matrix, offset)`,
never by wrapping a temporary `PendingDraw` object or cloning the matrix.

Replace per-Draw `new Float32Array(matrix)` in the WebGPU backend with
`drawStorage.append()`. Reuse the draw descriptor array and avoid
`new Set()`/new Draw List allocation on every frame. Keep Command Encoder
creation per frame.

- [ ] **Step 6: Verify GREEN and benchmark**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUInstanceCache.test.ts
npm test -- packages/renderer/tests/WebGPUDrawStorage.test.ts
npm test -- packages/renderer
npm run benchmark:renderers
```

Expected: unchanged Scene frames produce no Instance writes. Compare
`instanced-grid`, `instanced-50k`, and `wastewater-1x`; no real-scene threshold
may regress beyond the spec limit.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/WebGPUDrawStorage.ts packages/renderer/src/WebGPUInstanceCache.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUDrawStorage.test.ts packages/renderer/tests/WebGPUInstanceCache.test.ts
git commit -m "perf: reuse WebGPU frame storage"
```

---

### Task 7: Revisioned Render Plan

**Files:**

- Create: `packages/renderer/src/WebGPURenderPlan.ts`
- Create: `packages/renderer/tests/WebGPURenderPlan.test.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/src/WebGPUPicker.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**

- Consumes: `scene.revision`, `collectRenderables()`,
  `collectInstanceBatches()`, and `collectRenderBatches()`.
- Produces: `WebGPURenderPlan` with stable arrays and
  `WebGPURenderPlanCache.get(scene)`.

- [ ] **Step 1: Write failing cache tests**

Create `WebGPURenderPlan.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import { WebGPURenderPlanCache } from '../src/WebGPURenderPlan';

it('reuses a plan until scene revision changes', () => {
  const scene = new ICEScene({ id: 'scene' });
  const cache = new WebGPURenderPlanCache();
  const first = cache.get(scene);
  expect(cache.get(scene)).toBe(first);

  scene.addChild(new ICEMesh({
    id: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));
  const second = cache.get(scene);

  expect(second).not.toBe(first);
  expect(second.revision).toBe(scene.revision);
  expect(second.renderables).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPURenderPlan.test.ts
```

Expected: FAIL because the cached Plan does not exist.

- [ ] **Step 3: Implement the Plan**

Use the existing collector scratch arrays inside one Plan:

```ts
export type WebGPURenderPlan = Readonly<{
  scene: ICEScene;
  revision: number;
  renderables: readonly ICEGeometryRenderable[];
  instances: readonly ICEInstanceBatch[];
  batches: readonly ICERenderBatchDraw[];
  instancedMeshIds: ReadonlySet<string>;
}>;
```

On a revision change, clear the three scratch arrays with the collectors,
rebuild `instancedMeshIds`, then return a new frozen Plan descriptor that
references those arrays. On the same Scene and revision, return the exact same
descriptor and arrays.

Use the Plan in the renderer and Picker. Camera and Selection changes reuse the
Plan. A different Scene object always rebuilds. `invalidate()` and `dispose()`
clear the cached scene references and arrays.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- packages/renderer/tests/WebGPURenderPlan.test.ts
npm test -- packages/renderer
```

Expected: Plan and all existing rendering/Pick tests pass. Changing a Node's
`visible` or local matrix allocates a new Plan; Selection changes do not.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/WebGPURenderPlan.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/WebGPUPicker.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPURenderPlan.test.ts
git commit -m "perf: cache revisioned WebGPU render plans"
```

---

### Task 8: Render Bundle Cache and Optional-Layer Diagnostic

**Files:**

- Create: `packages/renderer/src/WebGPUBundleCache.ts`
- Create: `packages/renderer/tests/WebGPUBundleCache.test.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Modify: `packages/renderer/tests/WebGPUFrames.test.ts`
- Modify: `docs/diagnostics.md`

**Interfaces:**

- Consumes: a synchronous `record(bundleEncoder)` function, a resource key,
  Canvas format, and depth format.
- Produces: `WebGPUBundleCache.get(key, record)`, `bundleRecreations`, and
  `invalidate()`.

```ts
export type ICEWebGPUOptimizationFailureReason =
  | 'limit-too-low'
  | 'pipeline-failed'
  | 'resource-failed'
  | 'runtime-failed'
  | 'threshold-not-met';
```

- [ ] **Step 1: Extend the fake Render Bundle API**

Add to the fake Command Encoder:

```ts
beginRenderBundleEncoder(description: GPURenderBundleEncoderDescriptor) {
  const calls: string[] = [];
  return {
    description,
    calls,
    setPipeline: () => calls.push('setPipeline'),
    setBindGroup: () => calls.push('setBindGroup'),
    setVertexBuffer: () => calls.push('setVertexBuffer'),
    setIndexBuffer: () => calls.push('setIndexBuffer'),
    drawIndexed: () => calls.push('drawIndexed'),
    finish: () => ({ calls }),
  };
},
```

Add `executeBundles(bundles)` to fake Render Passes and record executed Bundles.
Allow `bundleCreationFails` and `bundleExecutionFails` fake options.

- [ ] **Step 2: Write failing reuse/fallback tests**

Create `WebGPUBundleCache.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUBundleCache } from '../src/WebGPUBundleCache';
import { fakeWebGPUDevice } from './fake-webgpu';

it('reuses a bundle for the same key', () => {
  const fake = fakeWebGPUDevice();
  const cache = new WebGPUBundleCache(fake.device, 'bgra8unorm');
  const first = cache.get('scene:1', () => undefined);
  const second = cache.get('scene:1', () => {
    throw new Error('must not record twice');
  });
  expect(second).toBe(first);
  expect(cache.bundleRecreations).toBe(1);
});

it('invalidates on a new key and on resize', () => {
  const fake = fakeWebGPUDevice();
  const cache = new WebGPUBundleCache(fake.device, 'bgra8unorm');
  cache.get('scene:1', () => undefined);
  cache.get('scene:2', () => undefined);
  expect(cache.bundleRecreations).toBe(2);
  cache.invalidate();
  expect(cache.current).toBeNull();
});
```

Add a backend test where Scene revision or uniform Buffer generation changes
and assert the Bundle recreates; changing Camera or Selection content only does
not recreate it.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUBundleCache.test.ts
```

Expected: FAIL because the Bundle Cache does not exist.

- [ ] **Step 4: Implement Bundle creation and backend fallback**

`WebGPUBundleCache.get()` compares the exact key and returns the current Bundle.
Otherwise it begins:

```ts
const encoder = device.createRenderBundleEncoder({
  label: `ice3:bundle:${key}`,
  colorFormats: [format],
  depthStencilFormat: 'depth24plus',
});
record(encoder);
const bundle = encoder.finish();
```

The backend factors its Draw loop into a function accepting either
`GPURenderPassEncoder | GPURenderBundleEncoder`. A valid Bundle is executed
with `pass.executeBundles([bundle])`; `frameStats.drawCalls` still adds the Plan
Draw count.

The Bundle key includes:

```text
scene revision
Draw Storage generation
Geometry Cache generation
Instance Cache buffer generation
Selection Mask buffer generation
Uniform Buffer generation
Canvas format
```

Key excludes Camera values and Selection content because those update existing
Buffer contents.

On `bundleCreationFails` or `bundleExecutionFails`, destroy partial resources,
invalidate the cache, set `bundleActive = false`, record this Diagnostic once,
and return to the direct encoder path:

```ts
onError?.(new ICEEngineError(
  'ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE',
  `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE: bundle/${reason}`,
));
```

Pass this error through the backend's existing `onError`, which Runtime already
maps to `lastDiagnostic` and `DIAGNOSTIC`. Add the code to
`docs/diagnostics.md` in the Rendering table.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUBundleCache.test.ts
npm test -- packages/renderer
npm run docs:check
```

Expected: reused static frames execute the same Bundle; fallback draws are
visible in the fake; warning count is one.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPUBundleCache.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/types.ts packages/renderer/tests/WebGPUBundleCache.test.ts packages/renderer/tests/WebGPUFrames.test.ts packages/renderer/tests/fake-webgpu.ts docs/diagnostics.md
git commit -m "perf: reuse WebGPU render bundles"
```

---

### Task 9: Instance Storage Buffer Tier

**Files:**

- Create: `packages/renderer/src/WebGPUCapabilities.ts`
- Create: `packages/renderer/tests/WebGPUCapabilities.test.ts`
- Create: `packages/renderer/src/WebGPUInstanceStorage.ts`
- Create: `packages/renderer/tests/WebGPUInstanceStorage.test.ts`
- Modify: `packages/renderer/src/WebGPURenderPipeline.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`

**Interfaces:**

- Consumes: `maxStorageBufferBindingSize`,
  `maxStorageBuffersPerShaderStage`, and read-only Storage access in Vertex.
- Produces: capability tier `storage`; a Storage Pipeline variant; 256-byte
  alignment constants; `ICEWebGPUOptimizationStats`; and fallback diagnostics.

- [ ] **Step 1: Write failing capability and pagination tests**

Create `WebGPUCapabilities.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { detectWebGPUAcceleration } from '../src/WebGPUCapabilities';
import { fakeWebGPUDevice } from './fake-webgpu';

it('starts at baseline without storage limits', () => {
  const fake = fakeWebGPUDevice();
  expect(detectWebGPUAcceleration(fake.device)).toMatchObject({
    tier: 'baseline',
    storage: false,
  });
});

it('enables storage when vertex storage limits are sufficient', () => {
  const fake = fakeWebGPUDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      minStorageBufferOffsetAlignment: 256,
    },
  });
  expect(detectWebGPUAcceleration(fake.device)).toMatchObject({
    tier: 'storage',
    storage: true,
  });
});
```

Create `WebGPUInstanceStorage.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUInstanceStorage } from '../src/WebGPUInstanceStorage';
import { fakeWebGPUDevice } from './fake-webgpu';

it('splits records by storage binding and alignment limits', () => {
  const fake = fakeWebGPUDevice();
  const storage = new WebGPUInstanceStorage(fake.device, {
    maxBindingBytes: 256,
    minOffsetAlignment: 256,
  });
  const pages = storage.plan(10, 96);
  expect(pages).toEqual([{ firstInstance: 0, instanceCount: 2 }]);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUCapabilities.test.ts packages/renderer/tests/WebGPUInstanceStorage.test.ts
```

Expected: FAIL because both modules do not exist. The fake `device.limits` does
not yet include these values.

- [ ] **Step 3: Implement capability detection and storage pages**

Use Baseline limits when values are absent because the current fake represents
old minimal devices. A device enters `storage` only when all are true:

```ts
const maxBindingBytes = device.limits.maxStorageBufferBindingSize ?? 0;
const maxBuffers = device.limits.maxStorageBuffersPerShaderStage ?? 0;
const alignment = device.limits.minStorageBufferOffsetAlignment ?? 256;
const storage = (
  maxBindingBytes >= 256
  && maxBuffers >= 2
  && alignment >= 4
  && Number.isInteger(alignment)
);
```

`plan(instanceCount, recordBytes)` uses:

```ts
const recordStride = Math.ceil(recordBytes / 16) * 16;
const perPage = Math.max(
  1,
  Math.floor(maxBindingBytes / recordStride),
);
```

Each page returns `firstInstance` and `instanceCount`. Use one read-only
interleaved record array with a 96-byte stride:

```wgsl
struct InstanceRecord {
  transform: mat4x4<f32>,
  bounds: vec4<f32>,
  semantic: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}
```

`transform` is 64 bytes, `bounds` stores local center xyz plus radius in 16
bytes, `semantic` is 4 bytes, and 12 bytes of padding preserve 16-byte struct
alignment. A 256-byte test binding therefore contains two complete records.

If a batch exceeds a binding, split it into consecutive pages.

Add the safe internal status used by Benchmark and tests:

```ts
export type ICEWebGPUOptimizationStats = Readonly<{
  tier: 'baseline' | 'storage' | 'gpu-driven';
  selectionMaskActive: boolean;
  bundleActive: boolean;
  storageActive: boolean;
  visibilityActive: boolean;
  instanceUploadBytes: number;
  bundleRecreations: number;
  timestampUnavailableReason?: string;
}>;
```

No field contains a GPU object or raw Limit value.

- [ ] **Step 4: Add Storage Pipeline variant**

Add the following Bind Group entries to a dedicated Pipeline. Binding 1 remains
the Selection Mask from Task 5:

```ts
{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
{ binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
```

Add the WGSL declarations:

```wgsl
@group(0) @binding(1) var<storage, read> selection: array<u32>;
@group(0) @binding(2) var<storage, read> instances: array<InstanceRecord>;
```

When `frame.useStorageInstances > 0.5`, take the matrix from
`instances[instanceIndex].transform` and semantic from
`instances[instanceIndex].semantic`. Keep the existing view-projection,
selection, edge, and pick behavior.

Create Storage and non-Storage pipelines as separate objects. A failed Storage
Pipeline creation leaves the existing pipeline untouched.

- [ ] **Step 5: Choose the path and test fallback**

Use Storage only when:

- capability detection returns `storage`;
- Pipeline creation succeeds;
- every page fits the binding limit;
- at least one benchmark/device policy marker enables it after the Task 11
  threshold review.

Before the policy decision, expose an internal `forceStoragePath?: boolean`
constructor option used only by unit tests and the benchmark runner. The normal
application path uses the tested default policy and never accepts this option
through `ice3`.

Add backend tests:

```ts
it('uses storage pipeline when enabled and supported', async () => {
  const fake = fakeWebGPUDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 1 << 20,
      minStorageBufferOffsetAlignment: 256,
    },
  });
  const backend = await readyBackend(fake, {}, { forceStoragePath: true });
  backend.render(repeatedBoxFrame(2));
  expect(fake.draws[0]?.pipeline).toContain('storage');
});

it('falls back to vertex attributes when storage pipeline fails', async () => {
  const fake = fakeWebGPUDevice({ storagePipelineFails: true });
  const errors: unknown[] = [];
  const backend = await readyBackend(
    fake,
    { onError: (error) => errors.push(error) },
    { forceStoragePath: true },
  );
  backend.render(repeatedBoxFrame(2));
  expect(fake.draws[0]?.pipeline).not.toContain('storage');
  expect(errors).toHaveLength(1);
});
```

- [ ] **Step 6: Verify GREEN and compare paths**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUCapabilities.test.ts
npm test -- packages/renderer/tests/WebGPUInstanceStorage.test.ts
npm test -- packages/renderer
npm run benchmark:renderers
```

Compare `instanced-50k` and `wastewater-5x` Storage and Vertex Attribute paths
on the same device. Default `forceStoragePath` to `false` if either path misses
the 10% CPU benefit or exceeds the 5% GPU regression. Record the decision in
the plan's execution notes, commit the resulting constant with its rationale,
and do not claim a Storage benefit from API presence alone.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/WebGPUCapabilities.ts packages/renderer/src/WebGPUInstanceStorage.ts packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUCapabilities.test.ts packages/renderer/tests/WebGPUInstanceStorage.test.ts packages/renderer/tests/WebGPURendererBackend.test.ts packages/renderer/tests/fake-webgpu.ts
git commit -m "perf: add WebGPU instance storage path"
```

---

### Task 10: Compute Visibility and Indirect Draw

**Files:**

- Create: `packages/renderer/src/WebGPUVisibility.ts`
- Create: `packages/renderer/tests/WebGPUVisibility.test.ts`
- Modify: `packages/renderer/src/WebGPURenderPipeline.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Modify: `packages/renderer/tests/WebGPURendererBackend.test.ts`

**Interfaces:**

- Consumes: Storage Instance pages, Camera View-Projection, and Geometry local
  bounds.
- Produces: `createIndirectArguments()`, `isAabbVisible()`,
  `WebGPUVisibilityEncoder`, compact visible Instance indices, and a Compute
  Pipeline.

- [ ] **Step 1: Write failing CPU-reference tests**

Create `WebGPUVisibility.test.ts`:

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { createIndirectArguments } from '../src/WebGPUVisibility';

it('creates the WebGPU indexed-indirect argument layout', () => {
  expect([...createIndirectArguments(36, 12, 4)]).toEqual([
    36, 0, 12, 4, 0,
  ]);
});

it('uses the batch threshold and never returns fractional instances', () => {
  expect(createIndirectArguments(36, 5.9, 0)).toBeUndefined();
});
```

Add a reference test with one Box visible in front of the Camera and one
translated behind it. Use `isAabbVisible()` to assert `[true, false]`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUVisibility.test.ts
```

Expected: FAIL because the visibility module does not exist.

- [ ] **Step 3: Implement alignment and CPU reference**

`createIndirectArguments()` accepts integer, non-negative values and creates:

```ts
return new Uint32Array([
  indexCount,
  0,
  firstIndex,
  baseVertex,
  0,
]);
```

Return `undefined` for invalid/fractional input. `isAabbVisible()` transforms
the eight local corners by the instance matrix and View-Projection, returns true
when any corner lies in `-w <= clip.xyz <= w`, and checks all six frustum planes.

This CPU function is the correctness reference and explicit benchmark fallback,
not an approximation used to replace computed results on production frames.

- [ ] **Step 4: Add Compute and Indirect Pipeline support to the fake**

Add `createComputePipelineAsync()`, `beginComputePass()`, `dispatchWorkgroups()`,
`clearBuffer()`, `copyBufferToBuffer()`, and `drawIndexedIndirect()`.

The fake records:

```ts
computePasses: Array<{
  pipeline: string;
  workgroups: number;
  bindGroups: unknown[];
}>;
indirectDraws: Array<{
  buffer: FakeBuffer;
  offset: number;
  indexCount: number;
  instanceCount: number;
}>;
```

Allow tests to set the value written into the indirect `instanceCount` field and
simulate `computePipelineFails`, `indirectFails`, and
`minStorageBufferOffsetAlignment`.

- [ ] **Step 5: Implement the Compute Shader and visible list**

Use one instance per invocation. The Compute Shader reads the instance matrix,
local AABB, Camera matrix, and Indirect Buffer. If an AABB intersects the
frustum, atomically append its instance index:

```wgsl
if (!visible) {
  return;
}
let slot = atomicAdd(&arguments.instanceCount, 1u);
visibleIndices[slot] = instanceIndex;
```

The Storage Render Shader reads:

```wgsl
let sourceInstance = visibleIndices[instanceIndex];
let instance = instances[sourceInstance];
let transform = instance.transform;
let semanticValue = instance.semantic;
```

Use `drawIndexedIndirect()` from an `INDIRECT | STORAGE | COPY_DST` Buffer.
Before Compute, clear `instanceCount` to zero with `encoder.clearBuffer()` while
preserving the CPU-initialized index fields. Put each argument block at a
256-byte or device-aligned offset.

For one Instance Batch with a normal Draw and an Edge Overlay, create one
Indirect Buffer per encoded Draw and copy the resolved visible count into every
subsequent Buffer after Compute and before the Render Pass.

- [ ] **Step 6: Apply the threshold and test fallback**

Apply `gpu-driven` only when:

- capability tier is `storage`;
- `maxStorageBuffersPerShaderStage >= 3`;
- the initial threshold of 1024 instances is met;
- Compute Pipeline and all Storage/Indirect resources are created;
- the benchmark policy from Task 11 enables the path.

On Compute or Indirect failure:

1. Finish or abandon the current encoder without submitting a partial frame.
2. Destroy partial Visibility resources.
3. Set `visibilityActive = false`.
4. Render from the existing Plan/Storage path.
5. Report the optimization warning once.

Add tests for:

```ts
it('uses indirect draw for a large instanced batch', async () => {
  const fake = fakeWebGPUDevice({ computeSupported: true });
  const backend = await readyBackend(
    fake,
    {},
    { forceGpuDriven: true },
  );
  backend.render(repeatedBoxFrame(2048));
  expect(fake.computePasses.length).toBe(1);
  expect(fake.indirectDraws.length).toBe(1);
});

it('renders from the plan when compute is unavailable', async () => {
  const fake = fakeWebGPUDevice({ computePipelineFails: true });
  const backend = await readyBackend(
    fake,
    {},
    { forceGpuDriven: true },
  );
  backend.render(repeatedBoxFrame(2048));
  expect(fake.draws.length).toBeGreaterThan(0);
  expect(fake.indirectDraws).toHaveLength(0);
});
```

- [ ] **Step 7: Add asynchronous debug counts**

Expose an internal `readVisibilityStats()` that copies counter data to a
`COPY_DST | MAP_READ` Buffer and maps it asynchronously. It is called only by the
Benchmark debug path after measurement, never inside `render()`.

The result reports `visibleInstances`, `culledInstances`, and `dispatchCount`.
Do not block selection, capture, or normal frame submission on this result.

- [ ] **Step 8: Verify GREEN and performance**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUVisibility.test.ts
npm test -- packages/renderer
npm run typecheck
npm run benchmark:renderers
```

Compare `culling-20k` CPU visibility, Storage, and Compute/Indirect in the same
report. Enable `gpu-driven` by default only if it meets:

- CPU render median improvement at least 20%;
- end-to-end CPU preparation improvement at least 10%;
- valid GPU time regression no more than 5%.

If any threshold fails, keep the implementation tests but default the path off,
record the negative result, and continue to Task 11 with the measured fallback.

- [ ] **Step 9: Commit**

```bash
git add packages/renderer/src/WebGPUVisibility.ts packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUVisibility.test.ts packages/renderer/tests/WebGPURendererBackend.test.ts packages/renderer/tests/fake-webgpu.ts
git commit -m "perf: add GPU visibility and indirect draws"
```

---

### Task 11: Lifecycle, Visual Matrix, and Final Performance Decision

**Files:**

- Modify: `packages/renderer/tests/WebGPULifecycle.test.ts`
- Modify: `packages/renderer/tests/WebGPUPicker.test.ts`
- Create: `tests/e2e/renderer-performance.spec.ts`
- Modify: `benchmarks/report.ts`
- Modify: `benchmarks/report.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/guides/development-and-troubleshooting.md`
- Modify: `docs/README.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: all optimization layers and safe `ICEWebGPUOptimizationStats`.
- Produces: final default path selection, complete visual/lifecycle coverage,
  and a report that labels each backend tier and unavailable reason.

- [ ] **Step 1: Add failing lifecycle tests**

Add to `WebGPULifecycle.test.ts`:

```ts
it('recreates frame resources after Device Lost', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(repeatedBoxFrame(2));
  await fake.loseDevice('unknown');
  await fake.completeReplacementDevice();
  await new Promise((resolve) => setTimeout(resolve, 0));

  backend.render(repeatedBoxFrame(2));

  expect(backend.stats.drawCalls).toBeGreaterThan(0);
  const activeBuffers = fake.buffers.filter((buffer) => !buffer.destroyed);
  expect(activeBuffers.length).toBeGreaterThan(0);
});

it('reports each optimization warning at most once', async () => {
  const fake = fakeWebGPUDevice({
    batchCreationFails: true,
  });
  const errors: unknown[] = [];
  const backend = await readyBackend(
    fake,
    { onError: (error) => errors.push(error) },
  );
  backend.render(repeatedBoxFrame(2));
  backend.render(repeatedBoxFrame(2));
  expect(errors).toHaveLength(1);
});
```

Update the Pick tests so a Picker after Mask/Storage/Compute resources exist
still returns the exact same ID and never receives a GPU handle through its
public input.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPULifecycle.test.ts
```

Expected: FAIL because new optional resources are not recreated or warnings
repeat on each frame.

- [ ] **Step 3: Fix resource ownership and one-time diagnostics**

Track each optional resource under the current Device generation. In
`recoverDevice()`:

1. Invalidate Bundle and Plan caches.
2. Destroy Selection, Instance Storage, Visibility, Indirect, Bundle and
   Timestamp resources.
3. Request the replacement Device with the same optional features.
4. Re-run capability detection.
5. Recreate Pipelines and frame resources.
6. Emit a new optimization warning only if the replacement capability is lower.

Keep a per-Device `Set<string>` named `optimizationWarnings`; insert the stable
layer/reason key before calling `onError`.

- [ ] **Step 4: Add E2E visual and frame-validity coverage**

Create `tests/e2e/renderer-performance.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('keeps the wastewater scene visible with the selected renderer', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await page.evaluate(() => window.__ice3M1.setCameraPose(
    [285, 150, 220],
    [135, 0, 40],
  ));
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    return canvas ? [canvas.width, canvas.height] : [0, 0];
  })).not.toEqual([0, 0]);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer.renderedBatches,
  )).toBeGreaterThan(0);
});
```

Add a resize assertion that records a non-background pixel before and after
changing the viewport, and a Selection assertion that remains yellow and still
Picks the same equipment ID.

- [ ] **Step 5: Produce the final report and default policy**

Run each backend/path with the final implementation:

```bash
npm run benchmark:renderers -- --headless --repetitions 5
```

Extend the report with:

- tier name;
- Storage on/off;
- Compute/Indirect on/off;
- Draw count;
- instance upload bytes and count;
- CPU stage summaries;
- GPU unavailable reason;
- warnings generated by optimization fallback.

Use thresholds from the spec to set **one source constant** in
`WebGPUCapabilities.ts`:

```ts
export const WEBGPU_STORAGE_DEFAULT = false; // Set true only after measured pass
export const WEBGPU_GPU_DRIVEN_DEFAULT = false; // Set true only after measured pass
export const WEBGPU_INSTANCE_VISIBILITY_THRESHOLD = 1024;
```

Replace each `false` only when the fixed-hardware report passes. Leave a short
comment naming the scenario and measured reason for enabling it. If a path
misses the threshold, keep `false`; do not delete its implementation or tests.

- [ ] **Step 6: Update architecture and troubleshooting docs**

Add to `docs/architecture.md`:

- Scene revision invalidation.
- Optimization tiers and fallback.
- Async GPU timing and no per-frame visibility Readback.
- Resource invalidation on resize and Device Lost.

Add to the troubleshooting guide:

- How to read CPU stage columns.
- Why GPU timing can be `n/a`.
- How to recognize `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE`.
- The benchmark command and rule that local results do not prove cross-device
  performance.

Update both README files with the benchmark command and optimization overview.
Do not add external product names or commit benchmark output.

- [ ] **Step 7: Run complete verification**

Run:

```bash
PATH="/Users/felix/.nvm/versions/node/v24.22.1/bin:$PATH" npm run verify
PATH="/Users/felix/.nvm/versions/node/v24.22.1/bin:$PATH" npm run release:check
PATH="/Users/felix/.nvm/versions/node/v24.22.1/bin:$PATH" npm run benchmark:renderers
npm pack --workspaces --dry-run
```

Expected:

- documentation, architecture, typecheck, unit, E2E and release checks pass;
- Real WebGPU path renders after every optimization fallback;
- WebGL2 fallback tests pass;
- final benchmark report contains 1x/5x/20x and new pressure scenarios;
- every numeric improvement can be traced to valid samples;
- no external GPU handles enter public declarations;
- workspace Git status contains no generated benchmark files.

- [ ] **Step 8: Commit final delivery**

```bash
git add packages/renderer benchmarks tests/e2e docs README.md
git commit -m "perf: finalize measured WebGPU acceleration"
```

---

## Completion Evidence

After implementation, the final handoff must include:

1. The commit list for Tasks 1 through 11.
2. The exact verification commands and their outcomes.
3. Paths to the final ignored JSON and Markdown benchmark reports.
4. A table for `wastewater-1x`, `5x`, and `20x` with CPU median, p95, valid GPU
   time, Draw count, upload bytes, and selected optimization tier.
5. The measured `wastewater-1x` regression check.
6. The measured Storage and Compute default-path decisions.
7. Any fallback that remained disabled and the exact threshold it missed.

The delivery is incomplete if it reports only initialization speed, only Draw
count, or API usage without steady-state performance data.

## Execution Notes

Implementation outcome on the fixed development host:

- Selection Draw count changed from `501` to `1`; WebGPU Selection CPU median
  is `0.1 ms`.
- Final five-run `wastewater-1x` result is `0.2 ms` CPU median and `0.3 ms`
  p95, within the no-regression gate.
- Final five-run `wastewater-5x` and `20x` WebGPU CPU medians are `1.0 ms` and
  `4.0 ms`; Draw counts are `200` and `800`.
- The adapter did not provide a usable GPU timestamp result, so final
  `gpuFrameMs` is `null` with `map-failed`/feature-unavailable evidence.
- Storage missed the required 10% CPU gain (approximately 9% at 50k), so
  `WEBGPU_STORAGE_DEFAULT` remains `false`.
- CPU visibility plus Storage measured `0.3 ms` on `culling-20k`, while
  Compute/Indirect measured `0.4 ms`; the required 20% CPU improvement was not
  reached, so `WEBGPU_GPU_DRIVEN_DEFAULT` remains `false`.

The final full benchmark is generated under `output/benchmarks/`; the
timestamped path is recorded in the SDD execution ledger. Storage and
GPU-driven implementations, forced-path benchmarks, fallback tests, and native
API validation remain available for future hardware or workload profiles.
