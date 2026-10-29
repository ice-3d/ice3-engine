# ICE3 WebGPU Renderer 设计

> Document ID: ICE3-ENG-SPEC-004
>
> Status: Draft
>
> Owner: ICE3 Engine maintainers

## 1. 目标

ICE3 Engine 增加一套生产级 WebGPU Renderer，并在运行时选择可用且满足 ICE3 最低能力
要求的图形后端。现代浏览器支持 WebGPU 时优先使用 WebGPU；探测失败时自动使用现有
WebGL2 Renderer。

后端选择不能只看浏览器品牌、版本或 `navigator.gpu` 是否存在。探测必须验证 Adapter、
Device、Canvas Context、能力限制和最小 Pipeline 均可用。显式指定 WebGPU 时失败必须
报错，不得静默降级。

本次变更同时提供量化的性能比较工具。相同合成 Scene 必须在相同画布尺寸、DPR、相机、
帧数和工作负载下分别强制运行 WebGL2 与 WebGPU，并输出可机器读取的延迟、提交和 GPU
资源数据。

## 2. 范围与边界

本节包含：

- WebGL2 与 WebGPU 两种生产图形后端。
- 启动阶段的能力探测和 `auto | webgpu | webgl2` 选择模式。
- 普通 Mesh、Geometry 顶点颜色、实例化、静态 Render Batch、adaptive batch 上传。
- 与 WebGL2 等价的 Selection highlight 和 exact picking。
- 异步拾取公开 API。
- Context/Device Lost 处理、稳定 Diagnostic 和 Renderer stats。
- 相同 Scene 下的 WebGL2/WebGPU A/B 性能基准。
- 自动选择模式下的回退测试。

本节不包含：

- 运行中由 WebGPU 自动迁移到 WebGL2。
- 在本次实现中使用 WebGPU Compute Shader 重写 LOD、裁剪或 Batch generation。
- 改变 Asset format、Toolchain output 或 Industrial semantic contract。
- 以浏览器跑分自动决定后端。性能数据用于比较和调优，不作为启动探测门槛。

## 3. 公共 API

新增 Renderer 偏好类型：

```ts
export type ICE3RendererPreference = 'auto' | 'webgpu' | 'webgl2';

export type ICE3Options = {
  readonly backend?: ICERendererBackend;
  readonly renderer?: ICE3RendererPreference;
  readonly scheduler?: ICERenderScheduler;
};
```

`backend` 用于测试或高级调用方注入，字符串 `renderer` 用于内置后端选择。二者同时设置
时抛出 `ICE3_RENDERER_CONFIG_INVALID`。

保留同步 `init()`，其默认行为仍为 WebGL2，避免已有显式后端调用在升级后失效。新增异步
初始化入口：

```ts
initAsync(target: string | HTMLElement): Promise<this>;
```

`initAsync()` 在所有未注入 `backend` 且未显式选择 Renderer 时默认使用 `auto`。

行为矩阵：

| 入口 | `backend` | `renderer` | 行为 |
|---|---|---|---|
| `init()` | 有 | 未设置 | 使用注入后端 |
| `init()` | 无 | 未设置 | 使用 WebGL2 |
| `init()` | 无 | `webgl2` | 使用 WebGL2 |
| `init()` | 无 | `auto` | 抛 `ICE3_RENDERER_ASYNC_REQUIRED` |
| `init()` | 无 | `webgpu` | 抛 `ICE3_RENDERER_ASYNC_REQUIRED` |
| `initAsync()` | 有 | 未设置 | 使用注入后端 |
| `initAsync()` | 无 | 未设置或 `auto` | 探测 WebGPU，失败回退 WebGL2 |
| `initAsync()` | 无 | `webgpu` | 探测失败时抛 `ICE3_WEBGPU_UNAVAILABLE` |
| `initAsync()` | 无 | `webgl2` | 使用 WebGL2 |

WebGPU Readback 不能同步完成，因此精确拾取改为异步：

```ts
pick(point: ICEScreenPoint): Promise<ICENode | undefined>;

pickItem(
  point: ICEScreenPoint,
): Promise<{ readonly item?: ICESceneItem }>;
```

WebGL2 后端也通过同一个异步 API 返回结果，保证调用方不因自动后端选择而看到不同语义。
Pointer click 处理在 Promise 完成后应用 Selection；同一指针手势期间的新 Pick 会使旧
结果失效，避免慢 Readback 覆盖较新的用户操作。

`ICERendererBackend.pick()` 同步改为返回 Promise：

```ts
pick?(
  frame: ICEFrame,
  point: ICEScreenPoint,
): Promise<string | undefined>;
```

Runtime 的 `samplePick()` 同样异步化。测试后端和 WebGL2 后端立即完成 Promise，WebGPU
后端等待单像素 Buffer Readback 完成。

公开发布 package `ice3` 版本提升到 `0.2.0`。文档必须明确 `pick()` 和 `pickItem()` 的
异步迁移。

## 4. Renderer 探测

新增内部 WebGPU 探测模块，导出以下判别联合：

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
```

GPU 对象只存在于内部 `@ice3/renderer` 包，不进入公开 `ice3` facade。

探测顺序固定为：

1. 检查 `globalThis.navigator.gpu`。
2. 在 3000 ms 预算内调用 `requestAdapter({ powerPreference: 'high-performance' })`。
3. 检查 Adapter Feature 至少覆盖空集合，并满足以下最低 Limits：
   - `maxTextureDimension2D >= 4096`
   - `maxBufferSize >= 268435456`
   - `maxVertexBuffers >= 2`
   - `maxBindGroups >= 2`
4. 请求 Device，不要求可选 Feature。
5. 在独立 Canvas 上取得 `webgpu` context。
6. 使用 `navigator.gpu.getPreferredCanvasFormat()` 配置 context。
7. 异步创建包含顶点输入、Uniform、深度测试和 Alpha Blend 的最小 Render Pipeline。
8. 提交一次最小清屏和 Draw，观察 Device 是否立即丢失。

探测 Canvas 优先使用 `OffscreenCanvas`，否则创建不插入 DOM 的 HTMLCanvasElement。正式
Scene Canvas 在探测完成前不得取得任何图形 Context。

成功探测的 Adapter、Device 和 format 交给即将创建的 WebGPU backend，避免重复申请
Device。失败探测释放已经创建的 Device 和 Canvas 资源。成功的探测结果在当前页面生命周期
内缓存；超时或临时失败不永久缓存，以便后续显式重试。

`auto` 模式将任何探测失败转换为 WebGL2 选择，并把选择和失败原因写入 Diagnostic。
显式 `webgpu` 模式将同一失败转换为 `ICE3_WEBGPU_UNAVAILABLE`。

## 5. Backend 架构

`@ice3/renderer` 增加以下职责单元：

| 文件 | 职责 |
|---|---|
| `RendererSelection.ts` | 偏好校验、探测调用、WebGL2 fallback 和后端构造 |
| `WebGPUProbe.ts` | Adapter、Device、Context 和最小 Pipeline 探测 |
| `WebGPURendererBackend.ts` | 初始化、Canvas 生命周期、帧提交和 backend stats |
| `WebGPUResources.ts` | Buffer、Texture、Bind Group 和 Sampler 的所有权与释放 |
| `WebGPUGeometryCache.ts` | Geometry residency、上传、pin、LRU 和 byte budget |
| `WebGPUInstanceCache.ts` | 实例矩阵和 semantic index 动态 Buffer |
| `WebGPURenderPipeline.ts` | 普通 Mesh、Edge、Selection 和 Pick Pipeline |
| `WebGPUPicker.ts` | 离屏身份渲染、异步单像素 Readback 和 Pick index 映射 |

现有通用 Scene 遍历和 batch collection 从 `WebGL2*` 文件移出为中性模块，WebGL2 与
WebGPU 共用同一输入。公共操作名称和稳定 Selection ID 保持不变。

WebGPU backend 在探测完成后同步完成正式 Canvas 配置，因此
`ICERendererBackend.initialize()` 仍可保持同步。异步成本集中在 `initAsync()` 的后端选择
阶段。

帧提交流程：

1. 收集 visible Mesh、instance batch 和 static/adaptive render batch。
2. 保留或上传 Geometry、实例矩阵和 semantic data。
3. 写入每帧 Uniform：view-projection、颜色、clip offset 和模式开关。
4. 编码不透明 Mesh、instances 和 batches。
5. 编码 Selection tint、selected edges 和 semantic highlight。
6. 提交 Command Buffer，并把每帧 draw、upload 和 byte 数据写入 stats。

所有 GPU Buffer 大小按 WebGPU 的 4-byte 写入对齐要求处理。16-bit 和 32-bit index 使用
对应的 `indexFormat`。动态 Instance Buffer 使用可映射上传路径，静态 Geometry 使用
一次性写入。

## 6. 功能等价

WebGPU backend 必须覆盖当前 WebGL2 的用户可见能力：

- 可见性继承和稳定 Scene traversal。
- 平光 Material color 和可选顶点颜色。
- Triangle 和 Edge。
- 相同 Geometry + Material 的 instancing。
- static Render Batch 和 adaptive batch staging/release。
- Selection tint、selected edge 和 semantic highlight。
- 精确可见表面 picking，包括 instance 和 batch semantic identity。
- Canvas pixel capture。
- Resize、DPR、背景色、stats 和 dispose。

两种后端允许存在像素级抗锯齿和固定线宽的细微差异，但颜色、几何位置、遮挡关系、选中
对象和语义 ID 必须一致。Edge 的可见厚度以相近视觉效果为验收标准，不要求逐像素相同。

## 7. Device Lost 与恢复

WebGPU backend 监听 `device.lost`：

- `destroy()` 导致的 lost 被忽略。
- 非主动 Device Lost 立即停止提交新帧，清理失效资源，并调用
  `onContextLost()`。
- Backend 使用保留的 Adapter 重新请求 Device、重建核心 Pipeline、重新配置 Canvas
  并调用 `onContextRestored()`。
- 恢复失败时保留 `ICE3_WEBGPU_DEVICE_LOST` Diagnostic，不切换到 WebGL2。

运行中不执行跨图形 API 的热切换。启动阶段的 `auto` fallback 与运行中的 Device Lost
恢复是两个独立流程。

## 8. Diagnostic 与公开状态

新增稳定 Diagnostic：

| Code | 触发条件 | 调用方处理 |
|---|---|---|
| `ICE3_RENDERER_CONFIG_INVALID` | 同时注入 backend 并指定 renderer preference | 只使用一种配置方式 |
| `ICE3_RENDERER_ASYNC_REQUIRED` | `auto` 或 WebGPU 偏好传给同步 `init()` | 改用 `initAsync()` |
| `ICE3_WEBGPU_UNAVAILABLE` | 显式选择 WebGPU 但探测失败 | 检查 details 中的 probe reason |
| `ICE3_WEBGPU_DEVICE_LOST` | 运行中 Device Lost 且恢复失败 | 重建 Engine 或刷新页面 |
| `ICE3_WEBGPU_PIPELINE_FAILED` | WebGPU Pipeline 创建失败 | 检查浏览器、Shader 和 GPU Diagnostic |
| `ICE3_WEBGPU_PICK_UNAVAILABLE` | Readback Buffer 或 map operation 失败 | 重试 Pick；持续失败时切换后端 |

`ICEEngineDiagnostics` 增加：

```ts
rendererSelection: {
  readonly requested: 'auto' | 'webgpu' | 'webgl2' | 'custom';
  readonly selected: 'webgl2' | 'webgpu' | 'fake';
  readonly fallback: boolean;
  readonly probeDurationMs?: number;
  readonly fallbackReason?: ICEWebGPUProbeFailureReason;
};
```

`ICERendererCapabilities.backend` 和 Diagnostic backend 类型增加 `'webgpu'`。WebGPU
对象、Adapter、Device、Buffer、Texture 和原始 GPU handle 不出现在 Diagnostic 中。

## 9. 性能基准

新增浏览器内 Benchmark Lab，通过 URL 参数强制选择：

```text
?backend=webgl2|webgpu&scenario=<id>&warmup=60&frames=300
```

基准直接创建 Renderer backend，使用固定 Scene、固定相机、无 2D overlay、无动画和固定
`1280 x 720` Canvas。两种后端使用相同 DPR，默认 `1`，并使用
`powerPreference: 'high-performance'`。

固定场景：

| Scenario | 目的 | 规模 |
|---|---|---|
| `unique-meshes` | Draw submission 和 CPU frontend | 2,000 个独立 Mesh，每个 12 triangles |
| `instanced-grid` | Instance buffer 和单批提交 | 10,000 个共享 Geometry instances |
| `static-batches` | 大 Geometry 和 static batch | 64 个 batch，每个 10,000 triangles |
| `selection` | Selection overlay | 在 `unique-meshes` 场景中选择 25% Mesh |
| `picking` | 精确 Pick latency | 对同一可见中心区域连续执行 100 次 Pick |
| `wastewater-mixed` | 接近真实应用的混合工作负载 | 加载版本库内合成污水处理厂 runtime Asset |

每次后端与 Scenario 先运行 60 帧 warm-up，再测量 300 帧。完整比较运行至少重复 5 次，
并交替 WebGL2 与 WebGPU 的执行顺序，降低热降频对单一后端的偏置。

每个样本记录：

- 初始化到首帧可提交的 `initializationMs`。
- `performance.now()` 包围一次 renderer render 的 `cpuFrameMs`。
- WebGPU `timestamp-query` 可用时的 `gpuFrameMs`。
- WebGL2 `EXT_disjoint_timer_query_webgl2` 可用时的 `gpuFrameMs`。
- `pickMs`，仅用于 picking scenario。
- `drawCalls`、`renderedMeshes`、`renderedBatches`、`instancingFallbacks`、
  `gpuUploads`、`gpuEvictions` 和 `gpuBytes`。

延迟统计输出 `min`、`median`、`mean`、`p95`、`p99` 和样本数。WebGPU 相对 WebGL2 的
改进百分比按以下公式计算：

```text
improvementPercent = (webgl2Metric - webgpuMetric) / webgl2Metric * 100
```

GPU timer 不可用时，`gpuFrameMs` 输出 `null` 和稳定原因，不使用 rAF 间隔伪造 GPU 时间。
VSync 限制下的 FPS 只作为展示数据，不作为主要比较指标。

输出同时包含：

- 控制台可读表格。
- JSON 报告，包含日期、浏览器版本、操作系统、Adapter 信息、场景规模和原始分位数。
- Markdown 汇总，包含 backend、scenario、关键指标和 improvementPercent。

默认输出到 `output/benchmarks/`，该目录已有 Git ignore 覆盖。基准数据不提交到仓库，
避免把单台机器的结果变成产品基线。共享 CI 只验证结果 schema、统计函数和两个后端可用时
的正确性，不设置跨机器的绝对性能阈值。固定硬件上的本地报告用于判断优化是否有效。

Benchmark Lab 使用以下命令：

```bash
npm run benchmark:renderers
```

命令默认构建 Engine 和 benchmark page，使用 Chromium 顺序运行两个后端。WebGPU 在此
环境中不可用时输出 `unsupported` 并以非零状态结束，提示明确的后端选择方式，不把缺少
GPU 的数据写成成功结果。

## 10. 测试策略

所有行为变化遵循 RED-GREEN-REFACTOR。

单元测试覆盖：

- Renderer preference 矩阵和非法组合。
- Probe 的每个失败 branch、超时、成功缓存和 Device 清理。
- `auto` fallback 的 selected backend、fallback reason 和 Diagnostic。
- 显式 WebGPU 失败不 fallback。
- WebGL2 与 WebGPU 的统一异步 pick 契约。
- Pointer click 在 Promise 完成前被新点击取代时不提交旧 Selection。
- Device Lost 的主动销毁忽略、恢复成功和恢复失败。
- Geometry/instance cache 的 LRU、pin、budget、upload 与 eviction counters。
- Benchmark 分位数和改进百分比计算。

浏览器集成测试：

- WebGPU 可用时，相同 Scene 的两个 backend 都产生可见非背景像素。
- Mesh、顶点色、instances、static batches 和 Selection 在两种 backend 上语义一致。
- 对同一可见位置，两种 backend 的精确 Pick 返回相同 Selection ID。
- Resize 和 DPR 改变后没有空白帧。
- WebGPU 测试同时覆盖 Device Lost 模拟；若浏览器不支持可靠的测试钩子，则使用注入的
  Device boundary 验证状态机，并保留真实 Adapter 的 smoke test。
- `new ICE3({ renderer: 'auto' }).initAsync(host)` 在 WebGPU 不可用时绘制 WebGL2 帧并
  报告 fallback。
- 显式 WebGPU 不可用时，不创建或绘制 WebGL2 帧。

性能测试不依赖像素相同；视觉一致性由独立功能测试验证，性能测试只比较相同工作负载的
耗时和资源指标。

## 11. 文档与跨仓库交付

Engine 仓库更新：

- 本文档和文档索引。
- Public API 的 `initAsync()`、Renderer preference 和异步 Pick 示例。
- Diagnostic code、Benchmark 命令和结果说明。
- Architecture、README 和 troubleshooting。
- `@webgpu/types` 仅作为 TypeScript development dependency。

`ice3-agent-console` 在其 Engine adapter 稳定后改用 `initAsync()` 的 `auto` 模式，并补充
一个浏览器 E2E，验证 Console 在 WebGPU 可用时报告 `webgpu`、不可用时报告 `webgl2`。
Console 不直接访问 WebGPU 对象。

跨仓库 format、Asset metric 和 semantic identity 不变，因此不修改
`ice3-doc` contract。新增 Diagnostic 只属于 Engine，不提升为跨仓库 shared code。

## 12. 验收标准

完成条件：

- `npm run verify` 在 Node.js 24.22.1 下通过。
- `npm run build`、`npm run test:e2e` 和 release package checks 通过。
- 支持 WebGPU 的 Chromium 实际运行 `auto` 并报告 `webgpu`。
- 禁用或伪造 WebGPU 不可用时实际运行 `auto` 并绘制 WebGL2。
- 显式 WebGPU 不可用时返回稳定错误，不静默 fallback。
- WebGL2 和 WebGPU 的功能测试覆盖本章列出的全部用户可见能力。
- 基准命令生成 JSON 和 Markdown 结果，且能展示各 Scenario 的量化 improvementPercent。
- 未提交客户 Asset、GPU 原始对象、浏览器设备指纹或本机绝对输出路径。

## 13. 关联文档

- `ICE3-ENG-IDX-001` — [文档索引](../README.md)
- `ICE3-ENG-ARC-001` — [Engine 架构](../architecture.md)
- `ICE3-ENG-REF-001` — [Diagnostic](../diagnostics.md)
- `ICE3-ENG-API-001` — [M0 公开 API](../api/m0.md)
