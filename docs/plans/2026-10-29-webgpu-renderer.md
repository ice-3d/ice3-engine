# ICE3 WebGPU Renderer Implementation Plan

> Document ID: ICE3-ENG-PLAN-004
>
> Status: Draft
>
> Owner: ICE3 Engine maintainers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加与 WebGL2 功能等价的 WebGPU Renderer、可靠的运行时后端选择与 fallback，以及可重复的 WebGL2/WebGPU 性能比较报告。

**Architecture:** 先在现有 Renderer backend 契约中统一异步拾取，再建立可注入的 WebGPU Probe 和独立资源、Pipeline、Picker 单元。Runtime 通过 `initAsync()` 选择 `auto | webgpu | webgl2`，所有 GPU 对象仍封装在 `@ice3/renderer` 内。性能测试复用同一 Scene 和 Engine 路径，强制运行两个后端并输出分位数和相对改进百分比。

**Tech Stack:** Node.js 24.22.1 LTS、npm 11、TypeScript 7、Node.js test runner、`expect`、Webpack 5、Playwright 1.64.1、WebGL2、WebGPU、`@webgpu/types` 0.1.74。

**Spec:** [`docs/specs/2026-10-29-webgpu-renderer-design.md`](../specs/2026-10-29-webgpu-renderer-design.md)

## Global Constraints

- 所有命令使用 Node.js `24.22.1` LTS 和 npm 11 或更高版本。
- 在 `feature/webgpu-renderer` 功能分支开发；完成完整验证后才可合入 `main`。
- 所有 Git author 和 committer 名称必须是 `damoqiongqiu`。
- 每项 Behavior 必须先写失败测试、观察正确失败，再写最小实现。
- 不增加 WebGL1 回退，不增加运行中跨图形 API 热切换。
- WebGPU、Adapter、Device、Buffer、Texture 和 GPU handle 不进入公开 `ice3` API 或 Diagnostic。
- `@webgpu/types@0.1.74` 只作为 development dependency。
- 自动探测的 Adapter timeout 固定为 3000 ms。
- 最低 Limits 固定为 `maxTextureDimension2D >= 4096`、`maxBufferSize >= 268435456`、`maxVertexBuffers >= 2`、`maxBindGroups >= 2`。
- 基准固定 Canvas `1280 x 720`、DPR `1`、warm-up `60`、measurement `300`、重复至少 `5` 次。
- 固定硬件性能结果写入被 Git ignore 的 `output/benchmarks/`，共享 CI 不设置绝对性能阈值。
- 不使用客户模型、客户数据、外部品牌或本机绝对结果路径。
- 每个任务结束时运行受影响测试；最终运行 `npm run verify`、`npm run release:check` 和 `npm run benchmark:renderers`。

## Review Focus

- 浏览器暴露 `navigator.gpu` 但 Adapter、Device 或 Pipeline 初始化失败时，`auto` 必须成功绘制 WebGL2，显式 WebGPU 必须报错。
- Pointer click 的 WebGPU Readback 尚未完成时发生新点击或 Engine destroy，旧 Promise 不得提交 Selection 或访问已释放资源。
- Device Lost 与主动 `dispose()` 必须区分；主动销毁不能被报告为运行故障。
- WebGPU 不可用或 GPU timer 不可用时，Benchmark 必须输出明确 unsupported/null，不能把缺失数据记录为零延迟或成功。
- Resize 后不得继续使用旧尺寸的 depth texture、pick texture 或 viewport；首帧不能出现空白或跨后端旧资源。

---

### Task 1: 统一异步拾取契约

**Files:**

- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/FakeRendererBackend.ts`
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Modify: `packages/runtime/src/ICE3.ts`
- Modify: `packages/runtime/tests/Projection.test.ts`
- Modify: `packages/runtime/tests/RenderBatchPicking.test.ts`
- Test: `packages/runtime/tests/AsyncPick.test.ts`

**Interfaces:**

- Consumes: `ICERendererBackend.pick(frame, point)` from the current renderer contract.
- Produces: `pick?(frame, point): Promise<string | undefined>`, `ICE3.pick(point): Promise<ICENode | undefined>`, `ICE3.pickItem(point): Promise<{ readonly item?: ICESceneItem }>`.

- [ ] **Step 1: Write the failing async API test**

```ts
// packages/runtime/tests/AsyncPick.test.ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from '@ice3/runtime';
import { FakeRendererBackend } from '@ice3/renderer';
import { createHost } from '../../../tests/test-dom.ts';

it('returns a Promise from pick and pickItem', async () => {
  const backend = new FakeRendererBackend({ picking: true });
  const scene = new ICEScene({ id: 'scene' });
  const mesh = new ICEMesh({
    id: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2f81f7' }),
  });
  scene.addChild(mesh);
  backend.pickResult = 'pump';
  const engine = new ICE3({ backend }).init(createHost());
  engine.setScene(scene).setCamera(new ICEPerspectiveCamera({
    id: 'camera',
    position: [0, 0, 4],
    target: [0, 0, 0],
  }));

  const picked = engine.pick({ x: 10, y: 10 });
  const itemResult = engine.pickItem({ x: 10, y: 10 });

  expect(picked).toBeInstanceOf(Promise);
  expect(itemResult).toBeInstanceOf(Promise);
  await expect(picked).resolves.toBe(mesh);
  await expect(itemResult).resolves.toMatchObject({
    item: { nodeId: 'pump' },
  });
});
```

If `tests/test-dom.ts` does not exist, create it as a test utility exporting
`createHost(): HTMLElement` exactly as below:

```ts
export function createHost(): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 640 },
    clientHeight: { configurable: true, value: 360 },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({
        x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360,
        width: 640, height: 360, toJSON: () => ({}),
      }),
    },
  });
  document.body.appendChild(host);
  return host;
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- packages/runtime/tests/AsyncPick.test.ts
```

Expected: FAIL because `pick()` and `pickItem()` return Scene values directly instead of Promises.

- [ ] **Step 3: Implement the Promise contract**

Change the renderer interface to:

```ts
pick?(
  frame: ICEFrame,
  point: ICEScreenPoint,
): Promise<string | undefined>;
```

Change `FakeRendererBackend.pick` to:

```ts
async pick(): Promise<string | undefined> {
  if (this.pickError) throw this.pickError;
  return this.pickResult;
}
```

Change the public WebGL2 method to wrap its existing synchronous Picker:

```ts
async pick(frame: ICEFrame, point: ICEScreenPoint): Promise<string | undefined> {
  if (!this.picker || !this.geometryCache) {
    throw new ICEEngineError(
      'ICE3_PICK_UNAVAILABLE',
      'ICE3_PICK_UNAVAILABLE: picker is not initialized',
    );
  }
  return this.picker.pick(
    { ...frame, point },
    this.geometryCache,
    collectRenderables(frame.scene, this.renderablesScratch),
    collectRenderBatches(frame.scene, this.batchesScratch),
    collectInstanceBatches(collectRenderables(frame.scene, this.renderablesScratch)),
    this.instanceCache!,
  );
}
```

In `ICE3`, change `pick()`, `pickItem()`, and `samplePick()` to async. Update direct picking tests to use `await`.

- [ ] **Step 4: Add the pointer race test**

```ts
it('commits only the latest pointer click when picks finish out of order', async () => {
  const backend = new FakeRendererBackend({ picking: true });
  let resolveFirst!: (value: string | undefined) => void;
  const first = new Promise<string | undefined>((resolve) => {
    resolveFirst = resolve;
  });
  let pickCount = 0;
  backend.pick = () => (pickCount++ === 0 ? first : Promise.resolve('valve'));
  const host = createHost();
  const engine = new ICE3({ backend }).init(host);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ff0000' }),
  }));
  scene.addChild(new ICEMesh({
    id: 'valve',
    selectionId: 'valve',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#00ff00' }),
  }));
  engine.setScene(scene).setCamera(new ICEPerspectiveCamera({
    id: 'camera',
    position: [0, 0, 4],
    target: [0, 0, 0],
  })).start();
  const committed: string[][] = [];
  engine.on<{ selection: readonly string[] }>('SELECTION_CHANGE', (event) => {
    committed.push([...(event.param?.selection ?? [])]);
  });
  const overlay = host.querySelector<HTMLCanvasElement>(
    'canvas[data-layer="overlay"]',
  )!;
  Object.defineProperty(overlay, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360,
      width: 640, height: 360, toJSON: () => ({}),
    }),
  });
  const click = () => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 20 },
        clientY: { value: 20 },
        pointerId: { value: 1 },
        button: { value: 0 },
      });
      overlay.dispatchEvent(event);
    }
  };

  click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveFirst('pump');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(committed.at(-1)).toEqual(['valve']);
});
```

The public Pick calls may return their own result; pointer-driven selection must use a
monotonic `pickGeneration`. Increment it in `resolveSceneClick()`, and only call
`setSelection()` when the completed generation is still current and state is active.

- [ ] **Step 5: Run the focused and runtime suites**

Run:

```bash
npm test -- packages/runtime/tests/AsyncPick.test.ts packages/runtime/tests/Projection.test.ts packages/runtime/tests/RenderBatchPicking.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/types.ts packages/renderer/src/FakeRendererBackend.ts packages/renderer/src/WebGL2RendererBackend.ts packages/runtime/src/ICE3.ts packages/runtime/tests/Projection.test.ts packages/runtime/tests/RenderBatchPicking.test.ts packages/runtime/tests/AsyncPick.test.ts tests/test-dom.ts
git commit -m "feat: make exact picking asynchronous"
```

---

### Task 2: 提取 Renderer 中立的 Scene Batch 输入

**Files:**

- Create: `packages/renderer/src/Renderables.ts`
- Create: `packages/renderer/src/RenderBatch.ts`
- Create: `packages/renderer/src/InstanceBatch.ts`
- Modify: `packages/renderer/src/WebGL2GeometryBatch.ts`
- Modify: `packages/renderer/src/WebGL2RenderBatch.ts`
- Modify: `packages/renderer/src/WebGL2InstanceBatch.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/tests/RendererBatchInputs.test.ts`

**Interfaces:**

- Consumes: `ICEScene`, `ICEMesh`, `ICEBasicMaterial` and `ICEGeometry` from `@ice3/core`.
- Produces: `collectRenderables()`, `collectRenderBatches()`, `collectInstanceBatches()` and their input types without any WebGL names.

- [ ] **Step 1: Write the failing neutral-module test**

```ts
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
} from '@ice3/core';
import {
  collectInstanceBatches,
  collectRenderables,
} from '../src/index';

it('collects renderables and instances without a graphics API', () => {
  const scene = new ICEScene({ id: 'scene' });
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  scene.addChild(new ICEMesh({ id: 'a', geometry, material }));
  scene.addChild(new ICEMesh({ id: 'b', geometry, material, position: [2, 0, 0] }));

  const renderables = collectRenderables(scene);
  const instances = collectInstanceBatches(renderables);

  expect(renderables.map((item) => item.id)).toEqual(['a', 'b']);
  expect(instances).toHaveLength(1);
  expect(instances[0]?.meshIds).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/RendererBatchInputs.test.ts
```

Expected: FAIL because the neutral collection entry points do not exist.

- [ ] **Step 3: Move generic collection code**

Move `collectRenderables`, `selectionIdentity` and `ICEGeometryRenderable` into
`Renderables.ts`. Move `ICERenderBatchNode`, `ICERenderBatchDraw` and
`collectRenderBatches` into `RenderBatch.ts`. Move `ICEInstanceBatch` and
`collectInstanceBatches` into `InstanceBatch.ts`.

Keep compatibility re-exports from the existing `WebGL2*` files and export the neutral
names from `packages/renderer/src/index.ts`.

- [ ] **Step 4: Verify refactor**

Run:

```bash
npm test -- packages/renderer/tests/RendererBatchInputs.test.ts
npm test -- packages/renderer/tests
npm run typecheck
```

Expected: new test passes and existing Renderer behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/Renderables.ts packages/renderer/src/RenderBatch.ts packages/renderer/src/InstanceBatch.ts packages/renderer/src/WebGL2GeometryBatch.ts packages/renderer/src/WebGL2RenderBatch.ts packages/renderer/src/WebGL2InstanceBatch.ts packages/renderer/src/index.ts packages/renderer/tests/RendererBatchInputs.test.ts
git commit -m "refactor: separate renderer batch inputs"
```

---

### Task 3: WebGPU 能力探测

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.base.json`
- Create: `packages/renderer/src/WebGPUProbe.ts`
- Create: `packages/renderer/tests/fake-webgpu.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/tests/WebGPUProbe.test.ts`

**Interfaces:**

- Consumes: browser `navigator.gpu` and WebGPU standard types.
- Produces:

```ts
export type ICEWebGPUProbeFailureReason =
  | 'document-unavailable'
  | 'api-unavailable'
  | 'adapter-unavailable'
  | 'adapter-timeout'
  | 'feature-missing'
  | 'limit-too-low'
  | 'device-failed'
  | 'context-failed'
  | 'pipeline-failed'
  | 'device-lost';

export type ICEWebGPUProbeResult =
  | {
      readonly supported: true;
      readonly adapter: GPUAdapter;
      readonly device: GPUDevice;
      readonly format: GPUTextureFormat;
    }
  | {
      readonly supported: false;
      readonly reason: ICEWebGPUProbeFailureReason;
      readonly detail?: string;
    };

export function probeWebGPU(options?: {
  readonly gpu?: GPU;
  readonly timeoutMs?: number;
  readonly createCanvas?: () => OffscreenCanvas | HTMLCanvasElement;
}): Promise<ICEWebGPUProbeResult>;
```

- [ ] **Step 1: Add the type dependency**

Run:

```bash
npm install --save-dev @webgpu/types@0.1.74
```

Add `"types": ["@webgpu/types"]` to `tsconfig.base.json` compiler options.

- [ ] **Step 2: Write the probe failure tests**

```ts
it('reports api-unavailable without navigator.gpu', async () => {
  await expect(probeWebGPU({ gpu: undefined })).resolves.toEqual({
    supported: false,
    reason: 'api-unavailable',
  });
});

it('rejects an adapter below the ICE3 buffer limit', async () => {
  const { gpu, canvas } = fakeWebGPUEnvironment({
    adapterLimits: { maxBufferSize: 1024 },
  });
  await expect(probeWebGPU({ gpu, createCanvas: canvas })).resolves.toMatchObject({
    supported: false,
    reason: 'limit-too-low',
  });
});

it('reports a failed pipeline request', async () => {
  const { gpu, canvas } = fakeWebGPUEnvironment({
    pipelineFails: true,
  });
  await expect(probeWebGPU({ gpu, createCanvas: canvas })).resolves.toMatchObject({
    supported: false,
    reason: 'pipeline-failed',
  });
});

it('caches a successful result for the same GPU object', async () => {
  const fake = fakeWebGPUEnvironment();
  const first = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: fake.canvas,
  });
  const second = await probeWebGPU({
    gpu: fake.gpu,
    createCanvas: fake.canvas,
  });
  expect(first.supported).toBe(true);
  expect(second).toBe(first);
  expect(fake.adapterRequestCount()).toBe(1);
});
```

Define the focused fake in `packages/renderer/tests/fake-webgpu.ts`:

```ts
export function fakeWebGPUEnvironment(options: {
  adapterLimits?: Partial<Record<keyof GPUSupportedLimits, number>>;
  adapter?: GPUAdapter | null;
  pipelineFails?: boolean;
} = {}) {
  const limits = {
    maxTextureDimension2D: 8192,
    maxBufferSize: 1 << 30,
    maxVertexBuffers: 8,
    maxBindGroups: 4,
    ...options.adapterLimits,
  };
  const device = {
    destroy() {},
    lost: new Promise(() => {}),
    createShaderModule() { return {}; },
    createRenderPipelineAsync: async () => {
      if (options.pipelineFails) throw new Error('pipeline failed');
      return {};
    },
    createCommandEncoder() {
      return {
        beginRenderPass() {
          return { end() {} };
        },
        finish() { return {}; },
      };
    },
    queue: {
      submit() {},
    },
  } as unknown as GPUDevice;
  const canvas = {
    width: 64,
    height: 64,
    getContext: () => ({
      configure() {},
      currentTexture: { createView: () => ({}) },
    }),
  } as unknown as HTMLCanvasElement;
  let adapterRequests = 0;
  const adapter = options.adapter === undefined
    ? {
        limits,
        features: new Set(),
        requestDevice: async () => device,
      } as unknown as GPUAdapter
    : options.adapter;
  const gpu = {
    requestAdapter: async () => {
      adapterRequests += 1;
      return adapter;
    },
    getPreferredCanvasFormat: () => 'bgra8unorm' as GPUTextureFormat,
  } as unknown as GPU;
  return {
    adapter,
    device,
    gpu,
    canvas,
    adapterRequestCount: () => adapterRequests,
  };
}
```

Also test: null Adapter, overdue `requestAdapter`, failed `requestDevice`, null Canvas
Context, immediately rejected `device.lost`, and a successful result containing the same
Adapter/Device instance returned by the fakes.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUProbe.test.ts
```

Expected: FAIL because `probeWebGPU` does not exist.

- [ ] **Step 4: Implement the probe**

Use `globalThis.navigator?.gpu` when `options.gpu` is not supplied. Compare every required
limit before requesting a Device. Race only the Adapter request against the timeout:

```ts
const timeout = Symbol('timeout');
const adapter = await Promise.race([
  gpu.requestAdapter({ powerPreference: 'high-performance' }),
  new Promise<typeof timeout>((resolve) => {
    setTimeout(() => resolve(timeout), timeoutMs);
  }),
]);
if (adapter === timeout) return failure('adapter-timeout');
if (!adapter) return failure('adapter-unavailable');
```

Create the test Canvas at `64 x 64`, get a WebGPU context, configure it with
`gpu.getPreferredCanvasFormat()`, create a WGSL shader module, and await
`createRenderPipelineAsync`. Submit one render pass that clears the test Canvas. Clear the
test Canvas reference after completion. On every failure path call `device?.destroy()`;
never expose the reason only through an exception.

Cache successful probes in a module-level `WeakMap<GPU, Promise<ICEWebGPUProbeResult>>`.
Cache failures only while their Promise is pending; delete rejected/failed entries so a later
explicit initialization can retry. Tests using different fake GPU objects therefore never
share a Device.

- [ ] **Step 5: Run probe tests**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUProbe.test.ts
npm run typecheck
```

Expected: all probe branches pass and WebGPU types compile.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json packages/renderer/src/WebGPUProbe.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUProbe.test.ts packages/renderer/tests/fake-webgpu.ts
git commit -m "feat: add WebGPU capability probe"
```

---

### Task 4: WebGPU Geometry 和 Instance 资源缓存

**Files:**

- Create: `packages/renderer/src/WebGPUResources.ts`
- Create: `packages/renderer/src/WebGPUGeometryCache.ts`
- Create: `packages/renderer/src/WebGPUInstanceCache.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Test: `packages/renderer/tests/WebGPUGeometryCache.test.ts`
- Test: `packages/renderer/tests/WebGPUInstanceCache.test.ts`

**Interfaces:**

- Consumes: `GPUDevice`, `ICEGeometry`, `ICEInstanceBatch`.
- Produces:

```ts
type WebGPUGeometryEntry = Readonly<{
  vertexBuffer: GPUBuffer;
  triangleIndexBuffer: GPUBuffer;
  edgeIndexBuffer: GPUBuffer | null;
  semanticBuffer: GPUBuffer | null;
  triangleCount: number;
  edgeCount: number;
  indexFormat: GPUIndexFormat;
  vertexCount: number;
  bytes: number;
}>;

class WebGPUGeometryCache {
  retain(geometry: ICEGeometry): WebGPUGeometryEntry;
  pin(geometry: ICEGeometry): WebGPUGeometryEntry;
  unpin(geometry: ICEGeometry): void;
  beginFrame(): void;
  endFrame(): void;
  clear(): void;
  dispose(): void;
  readonly totalBytes: number;
  readonly uploadCount: number;
  readonly evictionCount: number;
}
```

Extend `fake-webgpu.ts` with `fakeWebGPUDevice(options)` returning a complete fake device plus
observable arrays named `buffers`, `writes`, `submissions`, `renderPasses`, `draws`,
`contexts` and `depthTextures`. Each fake buffer records `size`, `usage`, `destroyed` and a
unique `label`; `queue.writeBuffer(buffer, offset, data)` stores `{ buffer, offset, data }`.
`createTexture()` records `{ size, usage, destroyed }`. `fake.canvas()` returns one stable
object whose `getContext('webgpu')` returns `fake.context`; `fake.context` contains
`configure(configuration)`, `unconfigure()`, `currentTexture`, and the recorded
`configuration` value.

- [ ] **Step 1: Write the failing interleaving and disposal test**

```ts
it('uploads position and color into one aligned vertex buffer', () => {
  const { device, buffers, writes } = fakeWebGPUDevice();
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  });
  const cache = new WebGPUGeometryCache({ device });

  const entry = cache.retain(geometry);

  expect(entry.vertexCount).toBe(3);
  expect(entry.indexFormat).toBe('uint16');
  expect(buffers[0]?.size).toBe(72);
  expect(new Float32Array(writes[0]!.data.buffer))
    .toEqual(new Float32Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 0, 1, 0,
      0, 1, 0, 0, 0, 1,
    ]));
  cache.dispose();
  expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
});
```

Write a second test that constructs entries with `maxBytes: 100`, retains two distantly-aged
entries, calls `beginFrame()`/`endFrame()` across the configured grace period, and asserts the
older unpinned entry is destroyed while the pinned entry remains.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUGeometryCache.test.ts
```

Expected: FAIL because the cache and interleaving behavior do not exist.

- [ ] **Step 3: Implement geometry residency**

Interleave every vertex as six float values: `position.xyz` and `color.rgb`. If
`geometry.colors` is absent, fill color with `1, 1, 1`.

Create:

- `vertexBuffer` with `GPUBufferUsage.VERTEX | COPY_DST`
- triangle and edge index buffers with `INDEX | COPY_DST`
- uint32 semantic buffer with `VERTEX | COPY_DST`

Align every allocated byte length to a multiple of 4. Map `Uint16Array` to `uint16` and
`Uint32Array` to `uint32`. Use one `queue.writeBuffer()` per resource. On allocation failure,
destroy resources created so far and throw `ICE3_GPU_RESOURCE_FAILED`.

- [ ] **Step 4: Write the failing instance cache test**

```ts
it('writes aligned instance matrices and semantic indices', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = {
    id: 'instance:pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
    instanceMatrices: new Float32Array(32),
    semanticIds: ['pump-a', 'pump-b'],
    semanticIndices: new Uint32Array([0, 1]),
    meshIds: ['a', 'b'],
    materialKey: '#ffffff:',
  };

  const entry = cache.retain(batch);

  expect(entry.instanceCount).toBe(2);
  expect(writes.map((write) => write.size)).toEqual([128, 8]);
});
```

- [ ] **Step 5: Verify RED, implement, and verify GREEN**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUInstanceCache.test.ts
```

Expected before implementation: FAIL because `WebGPUInstanceCache` does not exist.

Use one dynamic matrix buffer with stride `64`, one semantic buffer with stride `4`, and
`device.queue.writeBuffer()` on every `retain()`. `beginFrame()` clears the active set;
`endFrame()` destroys inactive batches. Then run:

```bash
npm test -- packages/renderer/tests/WebGPUGeometryCache.test.ts packages/renderer/tests/WebGPUInstanceCache.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPUResources.ts packages/renderer/src/WebGPUGeometryCache.ts packages/renderer/src/WebGPUInstanceCache.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUGeometryCache.test.ts packages/renderer/tests/WebGPUInstanceCache.test.ts
git commit -m "feat: add WebGPU geometry residency"
```

---

### Task 5: WebGPU 基础 Pipeline 与 Renderer

**Files:**

- Create: `packages/renderer/src/WebGPURenderPipeline.ts`
- Create: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/tests/WebGPURendererBackend.test.ts`

**Interfaces:**

- Consumes: `ICEWebGPUProbeResult` success variant and `WebGPUGeometryCache`.
- Produces:

```ts
class WebGPURendererBackend implements ICERendererBackend {
  static create(context: {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
    readonly format: GPUTextureFormat;
  }): Promise<WebGPURendererBackend>;
  readonly capabilities: Readonly<{
    backend: 'webgpu';
    maxTextureSize: number;
    picking: boolean;
  }>;
  initialize(options: {
    readonly canvas: HTMLCanvasElement;
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
  }): void;
  resize(viewport: ICEViewport, dpr: number): void;
  render(frame: ICEFrame): void;
  dispose(): void;
}
```

- [ ] **Step 1: Write the failing backend initialization test**

```ts
it('configures the canvas and renders a clear frame', async () => {
  const fake = fakeWebGPUDevice();
  const canvas = fake.canvas();
  const backend = await WebGPURendererBackend.create(fake.context);

  backend.initialize({ canvas });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);
  backend.render(emptyFrame());

  expect(fake.contexts[0]?.configuration).toMatchObject({
    device: fake.context.device,
    format: 'bgra8unorm',
    alphaMode: 'premultiplied',
  });
  expect(fake.submissions).toHaveLength(1);
  expect(fake.renderPasses[0]?.clearValue).toEqual({
    r: 0.035, g: 0.055, b: 0.09, a: 1,
  });
  expect(backend.stats.drawCalls).toBe(0);
  expect(backend.capabilities.backend).toBe('webgpu');
});
```

Define `emptyFrame()` in the same test file:

```ts
function emptyFrame(): ICEFrame {
  return {
    frameId: 1,
    scene: new ICEScene({ id: 'scene' }),
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 4],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection: [],
  };
}
```

Add this reusable helper to `fake-webgpu.ts`:

```ts
export async function readyBackend(
  fake: ReturnType<typeof fakeWebGPUDevice>,
  callbacks: {
    onContextLost?: () => void;
    onContextRestored?: () => void;
  } = {},
): Promise<WebGPURendererBackend> {
  const backend = await WebGPURendererBackend.create(fake.context);
  backend.initialize({ canvas: fake.canvas(), ...callbacks });
  backend.resize({ x: 0, y: 0, width: 320, height: 180 }, 1);
  return backend;
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPURendererBackend.test.ts
```

Expected: FAIL because `WebGPURendererBackend` does not exist.

- [ ] **Step 3: Implement the mandatory WGSL and pipelines**

Create one shader module containing a vertex shader that accepts:

```wgsl
struct FrameUniforms {
  worldViewProjection: mat4x4<f32>,
  color: vec4<f32>,
  clipOffset: vec2<f32>,
  useVertexColor: f32,
  useInstancing: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) instanceColumn0: vec4<f32>,
  @location(3) instanceColumn1: vec4<f32>,
  @location(4) instanceColumn2: vec4<f32>,
  @location(5) instanceColumn3: vec4<f32>,
  @location(6) instanceSemantic: u32,
) -> VertexOutput {
  let instanceMatrix = mat4x4<f32>(
    instanceColumn0, instanceColumn1, instanceColumn2, instanceColumn3
  );
  let localPosition = vec4<f32>(position, 1.0);
  let worldPosition = mix(
    localPosition,
    instanceMatrix * localPosition,
    frame.useInstancing,
  );
  var output: VertexOutput;
  output.position = frame.worldViewProjection * worldPosition;
  output.position.xy += frame.clipOffset * output.position.w;
  output.color = vec4<f32>(
    mix(vec3<f32>(1.0), color, frame.useVertexColor) * frame.color.rgb,
    frame.color.a,
  );
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
```

Bind Group 0 contains a 96-byte frame uniform. Create separate pipelines for triangle-list
and line-list with the same vertex layout, depth comparison `less-equal`, depth write
enabled, and the Canvas format. Use a 256-byte dynamic uniform-buffer stride so one submit
can draw many objects with different matrices.

- [ ] **Step 4: Implement resize and basic Mesh draw**

`resize()` updates the Canvas pixel size, creates a depth texture using the selected DPR and
viewport dimensions, and releases the previous depth texture. `render()` traverses shared
`collectRenderables()`, obtains Geometry cache entries, writes frame uniforms, encodes a
clear-and-draw pass, and submits once.

`WebGPURendererBackend.create()` creates and compiles all required pipelines before returning
the backend. This keeps the existing `initialize()` contract synchronous after the
asynchronous backend factory completes.

Convert the existing `colorToRgba()` helper to a neutral color module only if WebGPU cannot
import it without loading WebGL implementation code. Preserve its output exactly.

- [ ] **Step 5: Verify backend tests**

Run:

```bash
npm test -- packages/renderer/tests/WebGPURendererBackend.test.ts
npm run typecheck
```

Expected: PASS; clear-only and one-mesh frames record the expected pass, draw and stats.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/types.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPURendererBackend.test.ts
git commit -m "feat: add WebGPU mesh renderer"
```

---

### Task 6: 实例、静态 Batch、Adaptive Batch 与 Selection 绘制

**Files:**

- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/src/WebGPURenderPipeline.ts`
- Modify: `packages/renderer/tests/WebGPUInstanceCache.test.ts`
- Modify: `packages/renderer/tests/WebGPURendererBackend.test.ts`
- Test: `packages/renderer/tests/WebGPUFrames.test.ts`

**Interfaces:**

- Consumes: shared renderables, instance batches, static batches, `WebGPUInstanceCache`, `WebGPUGeometryCache`.
- Produces: complete non-Pick WebGPU render path and consistent `ICERendererStats`.

- [ ] **Step 1: Write failing frame coverage tests**

```ts
it('renders one instanced draw for repeated geometry', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  const frame = repeatedBoxFrame(4);
  backend.render(frame);
  expect(backend.stats).toMatchObject({
    drawCalls: 1,
    renderedMeshes: 0,
    instancingFallbacks: 0,
  });
  expect(fake.draws[0]?.instanceCount).toBe(4);
});

it('renders static and adaptive batches through the same batch pipeline', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(batchedFrame(2));
  expect(backend.stats.renderedBatches).toBe(2);
  expect(fake.draws).toHaveLength(2);
});

it('draws selection tint and selected edges only for selected identities', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.render(selectedBoxFrame('pump'));
  expect(fake.selectionDraws).toHaveLength(2);
});
```

Define the fixture helpers in `WebGPUFrames.test.ts`:

```ts
function boxMesh(id: string): ICEMesh {
  return new ICEMesh({
    id,
    selectionId: id,
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({
      color: '#2f81f7',
      edgeColor: '#ffffff',
    }),
  });
}

function sceneFrame(
  children: readonly ICENode[],
  selection: readonly string[] = [],
): ICEFrame {
  const scene = new ICEScene({ id: 'scene' });
  for (const child of children) scene.addChild(child);
  return {
    frameId: 1,
    scene,
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 10],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection,
  };
}

function repeatedBoxFrame(count: number): ICEFrame {
  return sceneFrame(Array.from({ length: count }, (_, index) => (
    new ICEMesh({
      id: `copy-${index}`,
      selectionId: `copy-${index}`,
      geometry: sharedBoxGeometry,
      material: sharedMaterial,
      position: [index, 0, 0],
    })
  )));
}

class TestRenderBatch extends ICENode {
  override get typeId(): string { return 'ice3:RenderBatch'; }
  readonly geometry = sharedBoxGeometry;
  readonly material = sharedMaterial;
  readonly semanticIds = ['0', '1'];
  readonly semanticNodeIds = ['node-0', 'node-1'];
  readonly semanticSelectionIds = ['equipment-0', 'equipment-1'];
  readonly materialKey = '#2f81f7:#ffffff';
}

function batchedFrame(count: number): ICEFrame {
  return sceneFrame(Array.from(
    { length: count },
    (_, index) => new TestRenderBatch({ id: `batch-${index}` }),
  ));
}

function selectedBoxFrame(id: string): ICEFrame {
  return sceneFrame([boxMesh(id)], [id]);
}

const sharedMaterial = new ICEBasicMaterial({
  color: '#2f81f7',
  edgeColor: '#ffffff',
});
const sharedBoxGeometry = new ICEBoxGeometry({
  width: 1,
  height: 1,
  depth: 1,
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUFrames.test.ts
```

Expected: FAIL because the basic backend draws only ordinary meshes.

- [ ] **Step 3: Implement instance and batch draws**

Bind the instance matrix and semantic buffers with `stepMode: 'instance'`. Use
`drawIndexed(instanceCount)` for instance batches. Use the same static/adaptive render batch
collection as WebGL2 and update counters exactly once per submission.

For non-instanced draws, bind a one-element identity instance record and use the same pipeline
layout. This keeps the WGSL single-path and makes `useInstancing` a uniform branch.

- [ ] **Step 4: Implement selection overlay**

Render selected uninstanced meshes with a separate blend pipeline using
`SELECTION_RGBA` and alpha `0.65`. Render selected edges with alpha `1`. For semantic
batch/instance highlights, draw only vertices whose semantic index equals the selected index.
Use five pixel-offset line submissions to match the current edge emphasis. Keep depth writes
disabled for tint and restore the main depth pipeline before the next frame.

- [ ] **Step 5: Verify frame coverage**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUFrames.test.ts packages/renderer/tests/WebGPURendererBackend.test.ts
npm test -- packages/runtime/tests/RenderBatchPicking.test.ts
```

Expected: PASS; stats and selection draw counts match fixture-derived values.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/tests/WebGPUInstanceCache.test.ts packages/renderer/tests/WebGPURendererBackend.test.ts packages/renderer/tests/WebGPUFrames.test.ts
git commit -m "feat: render WebGPU batches and selection"
```

---

### Task 7: WebGPU 精确异步拾取

**Files:**

- Create: `packages/renderer/src/WebGPUPicker.ts`
- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/src/WebGPURenderPipeline.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/tests/WebGPUPicker.test.ts`
- Modify: `packages/runtime/tests/RenderBatchPicking.test.ts`

**Interfaces:**

- Consumes: `ICERendererBackend.pick(): Promise<string | undefined>`, semantic GPU buffers and `WebGPUGeometryCache`.
- Produces: exact GPU Pick compatible with Mesh, instance and batch semantic identity.

```ts
class WebGPUPicker {
  constructor(device: GPUDevice, format: GPUTextureFormat);
  pick(
    frame: ICEFrame & { readonly point: ICEScreenPoint },
    geometryCache: WebGPUGeometryCache,
    pickIds: Readonly<Record<number, string>>,
  ): Promise<string | undefined>;
  resize(width: number, height: number): void;
  dispose(): void;
}
```

- [ ] **Step 1: Write failing Readback tests**

```ts
it('resolves a visible pick ID after async buffer mapping', async () => {
  const fake = fakeWebGPUDevice({
    pickPixel: new Uint8Array([3, 0, 0, 255]),
  });
  const picker = new WebGPUPicker(fake.device, 'bgra8unorm');
  const result = picker.pick(
    pickFrame(),
    new WebGPUGeometryCache({ device: fake.device }),
    {
    1: 'a',
    2: 'b',
    3: 'pump',
    },
  );
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe('pump');
});

it('maps the Y coordinate from CSS top-left to texture top-left', async () => {
  const fake = fakeWebGPUDevice();
  const picker = new WebGPUPicker(fake.device, 'bgra8unorm');
  await picker.pick(
    pickFrame({ point: { x: 20, y: 30 }, dpr: 2 }),
    new WebGPUGeometryCache({ device: fake.device }),
    {},
  );
  expect(fake.copyCalls[0]).toMatchObject({ origin: { x: 40, y: 60 } });
});
```

Use this fixture helper in the same test file:

```ts
function pickFrame(
  overrides: Partial<ICEFrame & { readonly point: ICEScreenPoint }> = {},
): ICEFrame & { readonly point: ICEScreenPoint } {
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'pump',
    selectionId: 'pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));
  return {
    frameId: 1,
    scene,
    camera: new ICEPerspectiveCamera({
      id: 'camera',
      position: [0, 0, 4],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 320, height: 180 },
    dpr: 1,
    selection: [],
    point: { x: 160, y: 90 },
    ...overrides,
  };
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUPicker.test.ts
```

Expected: FAIL because `WebGPUPicker` does not exist.

- [ ] **Step 3: Implement identity rendering and aligned Readback**

Create an RGBA8 identity texture with `RENDER_ATTACHMENT | COPY_SRC` and a depth texture.
Clamp the picked point into the Canvas pixel bounds. Copy one pixel to a 256-byte buffer with
`bytesPerRow: 256`, `rowsPerImage: 1`, call `mapAsync(GPUMapMode.READ)`, decode the first
four bytes, and always unmap/destroy the staging buffer in `finally`.

Use top-left pixel origin for WebGPU. Encode IDs with the existing stable RGBA codec; keep
the first ID above `0` so a cleared pixel remains an empty pick.

- [ ] **Step 4: Wire backend Pick**

Wire the Picker into `WebGPURendererBackend.pick()`. Track uninstanced, instanced and batch
semantic identities exactly as WebGL2. If Readback allocation, mapping or copy fails, throw
`ICEEngineError('ICE3_WEBGPU_PICK_UNAVAILABLE', detail, { cause })`.

- [ ] **Step 5: Verify both backend Pick paths**

Run:

```bash
npm test -- packages/renderer/tests/WebGPUPicker.test.ts packages/runtime/tests/Projection.test.ts packages/runtime/tests/RenderBatchPicking.test.ts
npm run typecheck
```

Expected: PASS; delayed mapping resolves to the same stable Selection ID used by WebGL2.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPUPicker.ts packages/renderer/src/WebGPURendererBackend.ts packages/renderer/src/WebGPURenderPipeline.ts packages/renderer/src/index.ts packages/renderer/tests/WebGPUPicker.test.ts packages/runtime/tests/RenderBatchPicking.test.ts
git commit -m "feat: add exact WebGPU picking"
```

---

### Task 8: Capture、Resize 与 Device Lost

**Files:**

- Modify: `packages/renderer/src/WebGPURendererBackend.ts`
- Modify: `packages/renderer/tests/fake-webgpu.ts`
- Test: `packages/renderer/tests/WebGPULifecycle.test.ts`

**Interfaces:**

- Consumes: initialized WebGPU backend and its Canvas/Device lifecycle.
- Produces: `capture(): Promise<Blob>`, resize-safe textures, Device Lost callbacks and full backend `dispose()`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('replaces the depth texture after resize without leaking the old texture', async () => {
  const fake = fakeWebGPUDevice();
  const backend = await readyBackend(fake);
  backend.resize({ x: 0, y: 0, width: 200, height: 100 }, 1);
  const first = fake.depthTextures[0];
  backend.resize({ x: 0, y: 0, width: 400, height: 200 }, 1);
  expect(first?.destroyed).toBe(true);
  expect(fake.depthTextures[1]?.size).toEqual([400, 200]);
});

it('ignores the lost promise triggered by deliberate disposal', async () => {
  const fake = fakeWebGPUDevice();
  const onLost = fn();
  const backend = await readyBackend(fake, { onContextLost: onLost });
  backend.dispose();
  await fake.loseDevice('destroyed');
  expect(onLost).not.toHaveBeenCalled();
});

it('reports a non-deliberate Device Lost and restores resources', async () => {
  const fake = fakeWebGPUDevice();
  const onLost = fn();
  const onRestored = fn();
  await readyBackend(fake, {
    onContextLost: onLost,
    onContextRestored: onRestored,
  });
  await fake.loseDevice('unknown');
  expect(onLost).toHaveBeenCalledTimes(1);
  await fake.completeReplacementDevice();
  expect(onRestored).toHaveBeenCalledTimes(1);
});

it('captures the presented texture before resolving its Blob', async () => {
  const fake = fakeWebGPUDevice({
    capturePixel: [47, 81, 247, 255],
  });
  const backend = await readyBackend(fake);
  backend.render(emptyFrame());
  const blob = await backend.capture();
  expect(blob.type).toBe('image/png');
  expect(fake.captureCopyCount()).toBe(1);
  expect(fake.lastMappedBytes().slice(0, 4)).toEqual(
    new Uint8Array([47, 81, 247, 255]),
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/WebGPULifecycle.test.ts
```

Expected: FAIL because lifecycle, capture and Device Lost handling are incomplete.

- [ ] **Step 3: Implement resize, capture and disposal**

Configure WebGPU Canvas textures with `RENDER_ATTACHMENT | COPY_SRC`. For `capture()`, copy
the presented current texture into a row-aligned RGBA/BGRA buffer, map it, copy bytes into a
new `Uint8Array`, and return a PNG Blob through `OffscreenCanvas.convertToBlob()` or a
DOM Canvas fallback. Clear all buffers, textures, caches and bind groups during dispose.

- [ ] **Step 4: Implement Device Lost recovery**

Register `device.lost.then(info => ...)`. Ignore reason `'destroyed'` only when this backend
is already disposing. Otherwise clear GPU resources, call `onContextLost()`, request a
replacement Device from the retained Adapter, recreate pipelines/caches, configure the
Canvas, call `onContextRestored()`, and keep the backend on WebGPU. A failed replacement
reports `ICE3_WEBGPU_DEVICE_LOST`; it must not switch APIs.

- [ ] **Step 5: Verify lifecycle**

Run:

```bash
npm test -- packages/renderer/tests/WebGPULifecycle.test.ts
npm test -- packages/renderer/tests
npm run typecheck
```

Expected: PASS with no retained old-size texture or callback after dispose.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGPURendererBackend.ts packages/renderer/tests/fake-webgpu.ts packages/renderer/tests/WebGPULifecycle.test.ts
git commit -m "feat: complete WebGPU lifecycle"
```

---

### Task 9: Renderer 选择与 Runtime 异步初始化

**Files:**

- Create: `packages/renderer/src/RendererSelection.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/runtime/src/ICE3.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/ice3/src/index.ts`
- Test: `packages/renderer/tests/RendererSelection.test.ts`
- Test: `packages/runtime/tests/AsyncInitialization.test.ts`

**Interfaces:**

- Consumes: `probeWebGPU()`, `WebGPURendererBackend`, current `WebGL2RendererBackend`.
- Produces:

```ts
export type ICE3RendererPreference = 'auto' | 'webgpu' | 'webgl2';

export type ICE3RendererSelection = Readonly<{
  requested: ICE3RendererPreference | 'custom';
  selected: 'webgl2' | 'webgpu' | 'fake';
  fallback: boolean;
  probeDurationMs?: number;
  fallbackReason?: ICEWebGPUProbeFailureReason;
}>;
```

- [ ] **Step 1: Write the failing preference tests**

```ts
it('uses WebGPU for auto when the WebGPU factory succeeds', async () => {
  const webgpu = new FakeRendererBackend();
  const webgl2 = new FakeRendererBackend();
  const selected = await selectRendererBackend('auto', {
    createWebGPU: async () => webgpu,
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgpu);
  expect(selected.selection).toMatchObject({
    requested: 'auto',
    selected: 'fake',
    fallback: false,
  });
});

it('falls back to WebGL2 when auto WebGPU initialization rejects', async () => {
  const webgl2 = new FakeRendererBackend();
  const selected = await selectRendererBackend('auto', {
    createWebGPU: async () => {
      throw new Error('adapter unavailable');
    },
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgl2);
  expect(selected.selection.fallback).toBe(true);
});

it('does not fall back when WebGPU is explicitly requested', async () => {
  await expect(selectRendererBackend('webgpu', {
    createWebGPU: async () => {
      throw new Error('adapter unavailable');
    },
    createWebGL2: () => new FakeRendererBackend(),
  })).rejects.toThrowError(/ICE3_WEBGPU_UNAVAILABLE/);
});
```

The fake's `capabilities.backend` makes `selected: 'fake'`; production tests use a typed
backend stub with `'webgpu'` or `'webgl2'` capability.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- packages/renderer/tests/RendererSelection.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement the selector**

Production `createWebGPU` must call `probeWebGPU()`, convert a failed probe to
`ICEEngineError('ICE3_WEBGPU_UNAVAILABLE', detail, { details: { reason } })`, and otherwise
`await WebGPURendererBackend.create(result)`. Record total probe duration with
`performance.now()`.

`createWebGL2` returns `new WebGL2RendererBackend()`.

- [ ] **Step 4: Write the failing Runtime API tests**

```ts
it('initAsync initializes an injected backend', async () => {
  const backend = new FakeRendererBackend();
  const engine = new ICE3({ backend });
  await engine.initAsync(createHost());
  expect(engine.getDiagnostics().backend.backend).toBe('fake');
  expect(engine.getDiagnostics().rendererSelection).toMatchObject({
    requested: 'custom',
    selected: 'fake',
    fallback: false,
  });
});

it('requires initAsync for auto and webgpu preferences', () => {
  expect(() => new ICE3({ renderer: 'auto' }).init(createHost()))
    .toThrowError(/ICE3_RENDERER_ASYNC_REQUIRED/);
  expect(() => new ICE3({ renderer: 'webgpu' }).init(createHost()))
    .toThrowError(/ICE3_RENDERER_ASYNC_REQUIRED/);
});

it('rejects backend injection combined with renderer preference', () => {
  expect(() => new ICE3({
    backend: new FakeRendererBackend(),
    renderer: 'auto',
  })).toThrowError(/ICE3_RENDERER_CONFIG_INVALID/);
});
```

- [ ] **Step 5: Implement Runtime initialization**

Store injected backend and preference separately. Extract current init body into
`initializeWithBackend(target, backend)`. `init()` accepts only injected backend or WebGL2.
`initAsync()` resolves `auto` or the explicit built-in backend before configuring the target
Canvas. On later initialization failure, dispose the selected backend and remove generated
Canvases through the existing cleanup path.

Add `rendererSelection` to `ICEEngineDiagnostics`. Export the renderer preference and selection
types through the public facade without exporting WebGPU resource types.

- [ ] **Step 6: Verify Runtime behavior**

Run:

```bash
npm test -- packages/renderer/tests/RendererSelection.test.ts packages/runtime/tests/AsyncInitialization.test.ts
npm test
npm run typecheck
```

Expected: PASS; auto fallback and forced failure have distinct observable behavior.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/RendererSelection.ts packages/renderer/src/types.ts packages/renderer/src/index.ts packages/runtime/src/ICE3.ts packages/runtime/src/index.ts packages/ice3/src/index.ts packages/renderer/tests/RendererSelection.test.ts packages/runtime/tests/AsyncInitialization.test.ts
git commit -m "feat: select WebGPU renderer at runtime"
```

---

### Task 10: Examples 与真实浏览器集成

**Files:**

- Modify: `examples/m0/main.ts`
- Modify: `examples/m1/main.ts`
- Modify: `examples/m2/main.ts`
- Modify: `examples/m1/global.d.ts`
- Modify: `tests/e2e/m1.spec.ts`
- Test: `tests/e2e/renderer-selection.spec.ts`

**Interfaces:**

- Consumes: `initAsync()`, `rendererSelection`, async `pick()`.
- Produces: real-browser coverage of WebGPU selection, WebGL2 fallback, rendering and Pick.

- [ ] **Step 1: Write the failing browser test**

```ts
test('auto selects the strongest available renderer', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const selection = await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  );
  expect(['webgl2', 'webgpu']).toContain(selection.selected);
  expect(selection.requested).toBe('auto');
});

test('forced WebGL2 remains functional', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=webgl2');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().backend.backend,
  )).toBe('webgl2');
});

test('auto falls back when navigator.gpu is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  )).toMatchObject({
    selected: 'webgl2',
    fallback: true,
    fallbackReason: 'api-unavailable',
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test:e2e -- --project=chromium tests/e2e/renderer-selection.spec.ts
```

Expected: FAIL because examples do not expose selection configuration and M1 still uses sync `init()`.

- [ ] **Step 3: Migrate examples**

Keep M0 and M2 explicitly on WebGL2 because their context-loss and pixel-read test hooks call
`getContext('webgl2')`. M1 reads `?renderer=` and uses:

```ts
const requested = new URLSearchParams(location.search).get('renderer');
const renderer = requested === 'webgl2' || requested === 'webgpu'
  ? requested
  : 'auto';
engine = await new ICE3({ renderer }).initAsync(stage);
```

Export diagnostics and the async Pick through `window.__ice3M1` so tests consume public
behavior. Do not access a WebGPU Device or raw resource.

- [ ] **Step 4: Update existing tests**

Any E2E helper calling `pick` must `await` it. The M1 default should use `auto`; M0/M2 should
pass `renderer: 'webgl2'`. Existing WebGPU-capable Chromium runs then exercise WebGPU, while
WebKit falls back when unavailable.

- [ ] **Step 5: Verify browser integration**

Run:

```bash
npm run build
npm run typecheck:example
npx playwright test tests/e2e/renderer-selection.spec.ts
npx playwright test tests/e2e/m1.spec.ts tests/e2e/selection-dpr.spec.ts
```

Expected: auto, forced WebGL2 and both available browser projects pass without page errors.

- [ ] **Step 6: Commit**

```bash
git add examples/m0/main.ts examples/m1/main.ts examples/m2/main.ts examples/m1/global.d.ts tests/e2e/m1.spec.ts tests/e2e/renderer-selection.spec.ts
git commit -m "test: exercise renderer selection in browser"
```

---

### Task 11: Benchmark 统计与固定场景

**Files:**

- Create: `benchmarks/core/statistics.ts`
- Create: `benchmarks/core/statistics.test.ts`
- Create: `benchmarks/core/scenarios.ts`
- Create: `benchmarks/core/types.ts`
- Create: `benchmarks/core/scenarios.test.ts`
- Modify: `scripts/run-tests.mjs`

**Interfaces:**

- Consumes: core Scene and Geometry classes.
- Produces: deterministic benchmark scenarios and pure percentile/improvement calculations.

```ts
export type ICEBenchmarkMetrics = Readonly<{
  initializationMs: number;
  cpuFrameMs: readonly number[];
  gpuFrameMs: readonly number[] | null;
  gpuFrameTimeUnavailableReason?: string;
  pickMs: readonly number[];
  stats: Readonly<ICERendererStats>;
}>;

export function summarizeSamples(samples: readonly number[]): {
  min: number;
  median: number;
  mean: number;
  p95: number;
  p99: number;
  count: number;
};

export function improvementPercent(webgl2: number, webgpu: number): number;
```

- [ ] **Step 1: Write failing statistics tests**

```ts
it('uses nearest-rank percentiles on unsorted samples', () => {
  expect(summarizeSamples([40, 10, 30, 20, 50])).toEqual({
    min: 10,
    median: 30,
    mean: 30,
    p95: 50,
    p99: 50,
    count: 5,
  });
});

it('reports WebGPU improvement as a percentage reduction', () => {
  expect(improvementPercent(20, 15)).toBe(25);
  expect(improvementPercent(10, 12)).toBe(-20);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test benchmarks/core/statistics.test.ts
```

Expected: FAIL because the benchmark statistics module does not exist.

- [ ] **Step 3: Implement statistics**

Sort a copy of samples. Use zero-based nearest-rank index:

```ts
const index = Math.min(
  values.length - 1,
  Math.max(0, Math.ceil(percentile * values.length) - 1),
);
```

Reject empty samples and non-finite values. Keep `improvementPercent()` unrounded.

- [ ] **Step 4: Write failing scenario-shape tests**

```ts
it('builds the declared fixed workload sizes', () => {
  expect(benchmarkScene('unique-meshes').meshCount).toBe(2000);
  expect(benchmarkScene('instanced-grid').instanceCount).toBe(10000);
  expect(benchmarkScene('static-batches').batchCount).toBe(64);
  expect(benchmarkScene('static-batches').trianglesPerBatch).toBe(10000);
});
```

- [ ] **Step 5: Implement scenarios**

Create deterministic geometry and transforms for:

- 2,000 unique 12-triangle meshes
- 10,000 instances sharing one box Geometry and Material
- 64 static batch nodes with 10,000 triangles each and semantic IDs
- selection variant selecting every fourth unique mesh
- picking variant with 100 center picks
- mixed wastewater mode that loads the existing synthetic runtime Asset

Use fixed camera position and target. Do not call the network for synthetic scenarios.

- [ ] **Step 6: Include benchmark tests and verify**

Modify `scripts/run-tests.mjs` to collect `benchmarks/**/*.test.ts` as a third root after
`packages` and `tests`. It must still skip `tests/e2e`.

Run:

```bash
npm test -- benchmarks/core
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add benchmarks/core/statistics.ts benchmarks/core/statistics.test.ts benchmarks/core/scenarios.ts benchmarks/core/scenarios.test.ts benchmarks/core/types.ts scripts/run-tests.mjs
git commit -m "feat: add renderer benchmark workloads"
```

---

### Task 12: Benchmark Lab 与报告运行器

**Files:**

- Create: `benchmarks/web/index.html`
- Create: `benchmarks/web/main.ts`
- Create: `benchmarks/web/styles.css`
- Create: `benchmarks/web/global.d.ts`
- Create: `benchmarks/webpack.config.cjs`
- Create: `benchmarks/run-renderers.mjs`
- Create: `benchmarks/report.ts`
- Test: `benchmarks/report.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `WebGPURendererBackend`, `WebGL2RendererBackend`, benchmark scenarios and statistics.
- Produces: `npm run benchmark:renderers`, JSON/Markdown files under `output/benchmarks/`, and a browser function:

```ts
window.__ice3Benchmark.run({
  backend: 'webgl2' | 'webgpu',
  scenario: string,
  warmup: number,
  frames: number,
}): Promise<ICEBenchmarkRun>;
```

```ts
export function createBenchmarkReport(input: {
  environment: {
    browser: string;
    platform: string;
    adapter: string;
  };
  runs: readonly {
    backend: 'webgl2' | 'webgpu';
    scenario: string;
    warmupFrames: number;
    measuredFrames: number;
    samples: {
      cpuFrameMs: readonly number[];
      gpuFrameMs: readonly number[] | null;
      pickMs: readonly number[];
    };
    gpuFrameTimeUnavailableReason?: string;
  }[];
}): {
  environment: { browser: string; platform: string; adapter: string };
  runs: readonly {
    backend: 'webgl2' | 'webgpu';
    scenario: string;
    metrics: {
      cpuFrameMs: ReturnType<typeof summarizeSamples>;
      gpuFrameMs: ReturnType<typeof summarizeSamples> | null;
      pickMs: ReturnType<typeof summarizeSamples>;
    };
    gpuFrameTimeUnavailableReason?: string;
  }[];
};
```

- [ ] **Step 1: Write failing report tests**

```ts
it('writes null GPU timing and an explicit reason when timers are unavailable', () => {
  const report = createBenchmarkReport({
    environment: {
      browser: 'test-browser',
      platform: 'test-platform',
      adapter: 'test-adapter',
    },
    runs: [{
      backend: 'webgpu',
      scenario: 'unique-meshes',
      warmupFrames: 60,
      measuredFrames: 300,
      samples: { cpuFrameMs: [12, 10], gpuFrameMs: null, pickMs: [] },
      gpuFrameTimeUnavailableReason: 'timestamp-query unavailable',
    }],
  });
  expect(report.runs[0]?.metrics.gpuFrameMs).toBeNull();
  expect(report.runs[0]?.gpuFrameTimeUnavailableReason)
    .toBe('timestamp-query unavailable');
});

it('does not divide by zero when comparing an empty pick sample', () => {
  expect(() => improvementPercent(0, 0)).toThrowError(
    /ICE3_BENCHMARK_INVALID/,
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test benchmarks/report.test.ts
```

Expected: FAIL because the report module does not exist.

- [ ] **Step 3: Implement the browser lab**

Parse `backend`, `scenario`, `warmup`, and `frames` from URL search parameters. Instantiate the
forced backend directly. Use one fixed `1280 x 720` Canvas and DPR `1`. Collect renderer CPU
time around each `render()` call. Enable `timestamp-query` only for WebGPU when advertised;
enable `EXT_disjoint_timer_query_webgl2` only for WebGL2 when available. If unavailable, set
GPU samples to `null` and record the exact reason.

Expose the same benchmark runner on `window.__ice3Benchmark`; no WebGPU or WebGL handles may
be returned.

- [ ] **Step 4: Implement the Node runner**

`benchmarks/run-renderers.mjs` must:

1. Run `npm run build`.
2. Run `webpack --config benchmarks/webpack.config.cjs`.
3. Start a local static HTTP server on an ephemeral `127.0.0.1` port.
4. Launch Playwright Chromium headed by default, or headless with `--headless`.
5. For each scenario and both forced backends, run at least five alternating repetitions.
6. Abort with explicit unsupported output when WebGPU cannot initialize.
7. Write timestamped JSON and Markdown into `output/benchmarks/`.
8. Close browser/server in `finally`.

The Markdown columns are `scenario`, `backend`, `cpu median`, `cpu p95`, `gpu median`,
`draw calls`, `GPU bytes`, and `improvement vs WebGL2`.

- [ ] **Step 5: Add package scripts**

```json
"benchmark:renderers": "node benchmarks/run-renderers.mjs",
"benchmark:renderers:headless": "node benchmarks/run-renderers.mjs --headless"
```

- [ ] **Step 6: Verify report and supported benchmark path**

Run:

```bash
node --import tsx --test benchmarks/report.test.ts
npm run benchmark:renderers
```

Expected: JSON and Markdown are created; every requested Scenario has WebGL2 and WebGPU rows,
or the command exits non-zero with `WEBGPU_UNSUPPORTED`. No `NaN`, Infinity or zero-filled
missing GPU timing.

- [ ] **Step 7: Commit**

```bash
git add benchmarks/web/index.html benchmarks/web/main.ts benchmarks/web/styles.css benchmarks/web/global.d.ts benchmarks/webpack.config.cjs benchmarks/run-renderers.mjs benchmarks/report.ts benchmarks/report.test.ts package.json
git commit -m "feat: benchmark WebGL2 against WebGPU"
```

---

### Task 13: 文档、版本与跨仓库集成

**Files:**

- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/diagnostics.md`
- Modify: `docs/api/m0.md`
- Modify: `docs/guides/getting-started.md`
- Modify: `docs/guides/development-and-troubleshooting.md`
- Modify: `packages/ice3/README.md`
- Modify: `packages/ice3/package.json`
- Modify: `scripts/build-release-package.mjs`
- Modify: `package-lock.json`
- Modify: `../ice3-agent-console/src/engine.ts`
- Modify: `../ice3-agent-console/package.json`
- Test: `tests/release/package.test.ts`
- Test: `../ice3-agent-console/tests/engine.test.ts`

**Interfaces:**

- Consumes: completed Engine APIs and browser behavior.
- Produces: published API documentation, version `0.2.0`, and the Console using `auto` without direct GPU access.

- [ ] **Step 1: Write the failing release contract test**

Add to `tests/release/package.test.ts`:

```ts
it('publishes WebGPU renderer API in ice3 0.2.0', async () => {
  const manifest = createPublicPackageManifest();
  expect(manifest.version).toBe('0.2.0');
  expect(manifest.keywords).toContain('webgpu');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/release/package.test.ts
```

Expected: FAIL because the release manifest still declares `0.1.1` and has no WebGPU keyword.

- [ ] **Step 3: Update documentation and release metadata**

Document synchronous compatibility behavior, `initAsync()`, Renderer preferences, fallback
Diagnostics, async `pick()` migration, Device Lost behavior, benchmark commands and result
interpretation. Add the WebGPU keyword and set the source package and release manifest to
`0.2.0`.

Do not document a single machine's benchmark as a permanent performance guarantee. Link the
benchmark workflow and explain that `improvementPercent > 0` means WebGPU used less time.

- [ ] **Step 4: Update the Console adapter**

Find the current Engine construction in `ice3-agent-console/src/engine.ts` and change it to the
following production behavior:

```ts
const engine = await new ICE3({ renderer: 'auto' }).initAsync(stage);
```

Expose the selected backend only through Engine Diagnostics. Update the Console's file
dependency and any mocked Engine API to return Promises from Pick. Add a test asserting that
Console initialization passes `renderer: 'auto'` and awaits `initAsync`.

- [ ] **Step 5: Run documentation and package gates**

Run in Engine:

```bash
npm run docs:check
npm run typecheck
npm run typecheck:example
npm test
npm run release:check
```

Run in Console:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Run full browser and benchmark verification**

Run in Engine:

```bash
npm run test:e2e
npm run benchmark:renderers
```

Expected: Chromium and WebKit E2E pass; benchmark outputs all supported Scenario comparisons
and records any unavailable timer without fabricated values.

- [ ] **Step 7: Run the complete Engine gate**

Run:

```bash
npm run verify
npm run release:check
git diff --check
git status --short
```

Expected: all gates pass; only intended tracked files are modified and
`output/benchmarks/` remains ignored.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/README.md docs/architecture.md docs/diagnostics.md docs/api/m0.md docs/guides/getting-started.md docs/guides/development-and-troubleshooting.md packages/ice3/README.md packages/ice3/package.json scripts/build-release-package.mjs package-lock.json tests/release/package.test.ts
git commit -m "docs: release WebGPU renderer 0.2.0"
```

Commit the Console repository separately:

```bash
git -C ../ice3-agent-console add src/engine.ts package.json tests/engine.test.ts
git -C ../ice3-agent-console commit -m "feat: use automatic WebGPU renderer"
```

---

## Final Completion Gate

- [ ] Engine and Console branches contain only intended changes.
- [ ] `npm run verify` and `npm run release:check` pass in Engine.
- [ ] Console `npm run typecheck`, `npm test`, and `npm run build` pass.
- [ ] Chromium `auto` selects WebGPU when available.
- [ ] Simulated unavailable WebGPU selects and renders WebGL2 in `auto`.
- [ ] Forced unavailable WebGPU throws `ICE3_WEBGPU_UNAVAILABLE`.
- [ ] Mesh、vertex color、instances、static/adaptive batches、selection、edges and Pick pass on both backends.
- [ ] Device Lost and resize tests leave no retained invalid resource.
- [ ] Benchmark JSON and Markdown contain real timing distributions and explicit null reasons.
- [ ] No customer Asset, raw GPU object, absolute local result path or forbidden product name is committed.
