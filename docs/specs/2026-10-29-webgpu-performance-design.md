# ICE3 WebGPU 性能优化设计

> Document ID: ICE3-ENG-SPEC-005
>
> Status: Draft
>
> Owner: ICE3 Engine maintainers

## 1. 目标

本规格定义 WebGPU Renderer 的测量驱动性能优化。优化目标是减少 CPU 可见性处理、
Selection 重复绘制、动态 Buffer 上传和命令编码开销，并在有可用证据时使用 WebGPU
Storage Buffer、Render Bundle、Compute Shader 和 Indirect Draw。

成功不以“使用了 WebGPU 专属 API”为依据。每项能力必须在相同 Scene、Camera、Canvas、
DPR 和帧数下，与 WebGL2 或优化前 WebGPU 路径进行量化比较。真实污水处理厂场景必须
保持功能一致且不得明显回退；规模场景必须展示收益从何处开始出现，以及当前设备上的
性能交叉点。

当前基线暴露了三个明确问题：

- 合成污水厂场景有 40 Draw，WebGPU 相对 WebGL2 没有可见的持续渲染优势。
- Selection 场景包含 500 个选中对象时，WebGPU 产生 501 Draw，而 WebGL2 为 1 Draw。
- 基准没有真实 GPU 时间，无法区分 CPU 提交、GPU 光栅化和带宽瓶颈。

本规格以该基线为起点，但不把单台设备的历史绝对耗时写成跨设备性能承诺。

## 2. 范围与边界

本规格包含：

- CPU 阶段计时、可选 GPU timestamp 和规模化性能报告。
- Scene 与 Camera 数据的稳定 Draw Plan 缓存。
- Selection Mask，以及每个 Batch 至多一次 Edge Overlay。
- 持久 Uniform、Instance、可见列表和 Indirect Buffer。
- 静态 Draw Plan 的 Render Bundle。
- 可选的实例 Storage Buffer。
- 大规模实例的 Compute Visibility 和 Indirect Draw。
- 能力分级、优化层降级、Device Lost 恢复和复测。
- WebGL2 功能等价与 WebGPU 功能等价测试。

本规格不包含：

- 改变 Asset format、Toolchain output、Selection ID 或 semantic identity。
- 用 WebGPU 取代 WebGL2 fallback。
- 运行中从 WebGPU 迁移到 WebGL2。
- 纹理、材质、灯光或后处理能力扩展。
- 透明物体排序、动画、骨骼和通用 LOD。
- 为不同 Geometry 合并单个 Indirect Draw。
- 每帧同步回读 GPU 可见列表。
- 将设备原始对象、Limit 对象或 GPU handle 暴露到公开 API。

## 3. 设计原则

1. **先测量后加速。** CPU 分阶段数据和合法 GPU 时间优先于推测。
2. **功能路径与优化路径分离。** 优化失败只能降低性能，不得改变 Scene 语义。
3. **按能力逐级启用。** 每个设备只有在验证成功后进入下一层。
4. **规模驱动。** Compute 与 Indirect Draw 只在实例规模和瓶颈数据满足条件时使用。
5. **无逐帧同步。** 正常渲染路径不得等待 GPU Readback。
6. **预算优先。** 所有新增持久资源纳入 GPU byte 统计和设备 Limit。

## 4. 能力分级

WebGPU 后端内部使用以下能力层：

```ts
type ICEWebGPUAccelerationTier =
  | 'baseline'
  | 'storage'
  | 'gpu-driven';
```

| 层级 | 包含能力 |
| --- | --- |
| `baseline` | 持久临时存储、增量上传、条件可用的 Selection Mask、Render Bundle |
| `storage` | `baseline`，以及实例和 Selection 的 read-only Storage Buffer |
| `gpu-driven` | `storage`，以及 Compute Visibility 和 Indirect Draw |

能力判断只读取 Adapter 与 Device 的安全数值和 Feature 名称。每个层级在初始化后执行
一次最小自检；前一层成功后才能尝试下一层。最小自检失败不抛出公开错误，而是把层级
降级并报告一次优化不可用 Diagnostic。

普通应用初始化不需要 GPU timestamp。Benchmark Lab 单独请求已由 Adapter 提供的
`timestamp-query`；应用运行和启动 backend 选择不因计时能力缺失而降级。

## 5. 架构单元

`@ice3/renderer` 增加以下内部职责单元：

| 文件或单元 | 职责 |
| --- | --- |
| `WebGPURenderPlan.ts` | Scene revision、Draw 顺序、Selection 范围和资源依赖 |
| `WebGPUDrawStorage.ts` | 可复用 Draw 描述、Matrix、颜色和 Shader 参数存储 |
| `WebGPUSelectionMask.ts` | Selection Mask 编码、容量和分页 |
| `WebGPUBundleCache.ts` | Render Bundle 创建、复用和失效 |
| `WebGPUInstanceStorage.ts` | Instance Storage Buffer、内容版本和分页 |
| `WebGPUVisibility.ts` | Compute Frustum Culling、可见索引和 Indirect 参数 |
| `WebGPUTimestampProfiler.ts` | Query Set、环形 Resolve Buffer 和延迟时间回读 |
| `WebGPUCapabilities.ts` | 加速层级探测、自检结果和稳定失败原因 |

现有 Scene 收集、Geometry 缓存、Picker、公开 Renderer API 和 WebGL2 backend 继续作为
功能基线。新增单元只依赖设备边界和中性 Renderer 数据，不允许 Picker 或 Runtime 直接
读取 WebGPU GPU handle。

## 6. 数据流

```text
Scene revision + Camera + Selection
                |
                v
        Draw Plan / visibility work
                |
       +--------+---------+
       |                  |
 CPU prepared path   Compute visibility
       |                  |
       +--------+---------+
                |
 persistent buffers / selection mask
                |
         render bundle or indirect draw
                |
             GPU queue
                |
       stats + optional async timing
```

Camera 变化只更新 View-Projection 和可见性输入，不重建 Scene 结构。Selection 变化只更新
Selection Mask 和必要的 Edge Overlay 状态，不重新上传 Geometry。Scene 结构、可见性或
局部变换变化后，Draw Plan 失效并按新 revision 重建。

## 7. Scene revision 与 Draw Plan

`ICEScene` 增加只读单调递增 `revision`。以下操作必须使根 Scene revision 增加：

- 添加或移除子节点。
- 修改节点 `visible`。
- 修改节点局部矩阵。
- 提交或释放 adaptive Render Batch。

`ICEVector3` 已不可变，因此节点位置、旋转和缩放只能通过替换局部矩阵改变，不需要额外
标记路径。Camera、Background、Selection 和 Viewport 不属于 Scene revision。

`WebGPURenderPlan` 缓存以下中性数据：

- 可见普通 Mesh、Instance Batch 和 Render Batch。
- Draw 顺序、Pipeline 类别和 Geometry 依赖。
- 每个 Draw 的 semantic 范围与 Selection Mask 偏移。
- Instance Matrix 内容版本和 Geometry 内容版本。
- 静态 Draw 的 Render Bundle key。

Scene revision 未变时，复用同一 Draw Plan。Plan 重建仍写入预分配 scratch，目标是不按
Mesh 数量创建短生命周期数组或 Matrix 对象。

Camera 每帧产生新的 View-Projection，并写入现有持久 Uniform Buffer。Camera 变化不使
Render Bundle 失效，因为 Bundle 引用的仍是同一 Uniform Buffer 和动态 offset。

## 8. Selection Mask

Selection Mask 使用 `Uint32Array`，每个 semantic 项一个元素：

```text
0 = 未选中
1 = 选中
```

Plan 为每个 Draw 分配连续的 semantic mask 范围。Shader 通过 Draw 参数中的
`selectionBase` 和当前 vertex 或 instance semantic 读取选择状态：

```wgsl
let selected =
  selectionMask[draw.selectionBase + semantic] == 1u;
```

普通 Geometry 的 Selection tint 在同一个绘制中完成，不增加 Draw。只有存在选中 semantic
且 Geometry 有 Edge 时，才为该 Batch 增加一次 Masked Edge Overlay。Overlay 使用
Selection Mask 丢弃未选中 Edge，不再按对象重复 Draw。

Selection 数组先排序并去重，再与上一帧的规范化 Selection 比较。内容不变时复用现有
Mask。Mask Buffer 扩容会替换底层 Buffer，并使引用它的 Bind Group 和 Render Bundle
失效。

当 Selection Mask 不可用时，后端保留原有逐对象 Selection Draw。该降级只影响性能，
必须继续生成正确的 tint、Edge 和 Pick 结果。

当前设备若不允许 Fragment 阶段读取 read-only Storage Buffer，Selection Mask 同样使用
该降级路径。`storage` 能力层专门验证独立 Instance Storage Buffer；它不能代替 Fragment
阶段的选择掩码能力检查。

## 9. 持久资源与增量上传

以下对象只按容量和内容版本变化重新创建或上传：

- Draw Uniform Array。
- Instance Matrix 与 semantic 数据。
- Selection Mask。
- Indirect Argument 与可见 Instance Index。
- Bind Group、Pipeline 和 Render Bundle 引用。

Instance Cache 记录每个 Batch 的矩阵和 semantic 内容版本。内容未变时，同一 Buffer
直接复用；Batch 消失时沿用现有 grace frame 和 LRU eviction。

临时数组不进入公开状态。常态稳态帧不得为每个 Draw 创建新的 `Float32Array`、普通对象
或 Bind Group。允许每帧创建 Command Encoder，因为其 `finish()` 后不能再次编码。

所有动态 Buffer 写入遵守 4-byte 对齐。Uniform 与动态 offset 遵守 256-byte 对齐。
容量按 2 的幂增长，增长后统一更新 Resource generation。

## 10. Render Bundle

静态 Draw Plan 编码为 Render Bundle。Bundle 中允许包含：

- Pipeline 和 Bind Group。
- Vertex、Instance 和 Index Buffer。
- Draw 与动态 Uniform offset。

以下变化使相关 Bundle 失效：

- Scene revision 导致 Draw Plan 结构变化。
- Geometry、Instance、Selection 或 Uniform 底层 Buffer 被替换。
- Pipeline 或 Bind Group 布局变化。
- Canvas format、深度格式或 Render Pass 兼容性变化。
- resize、Device Lost、backend dispose。

Selection Mask 内容变化不需要重建 Bundle。Camera 和 Selection 只改变 Buffer 内容，
不改变已编码命令。

创建或执行 Bundle 失败时，当前帧自动走直接命令编码路径。优化层停止尝试 Bundle，
报告一次 `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE`，正常 WebGPU 渲染继续。

## 11. Instance Storage Buffer

`storage` 层为每个实例写入固定记录：

```text
matrix column 0..3  16 x f32
semantic             1 x u32
```

Vertex Shader 使用 `instance_index` 从 read-only Storage Buffer 读取矩阵和 semantic。
该路径取消逐实例 Vertex Attribute 绑定，但不改变 Instance Batch 的语义或绘制顺序。

每页大小不超过 `maxStorageBufferBindingSize`，并留出设备要求的绑定对齐余量。一个
Instance Batch 超出单页时拆成多个连续实例页，每个页对应一个 Draw；Selection Mask 和
Pick ID 必须保持跨页一致。

该路径需要：

- Vertex 阶段允许 read-only Storage Buffer。
- Buffer 大小与绑定大小不超过 Device Limit。
- 成功创建 Storage Pipeline 和 Bind Group。

任何条件不满足时使用现有 Vertex Attribute instance path。Storage 路径的收益必须由
`instanced-50k`、`wastewater-5x` 或更大规模场景验证；如果 CPU 中位数收益不足 10%，
或合法 GPU 时间回退超过 5%，该设备不得默认选择 Storage 路径。

## 12. Compute Visibility 与 Indirect Draw

`gpu-driven` 层只作用于满足阈值的 Instance Batch。初始候选阈值为 1024 个实例；实施
计划必须通过规模曲线确认或调整阈值，最终常量必须由测试固定并记录理由。

Compute Pass 输入：

- Instance Matrix 与 geometry local bounds。
- View-Projection Frustum planes。
- 可容纳 `u32` instance index 的可见列表。
- 可容纳原子追加计数的计数器。

Compute Pass 输出：

- 紧凑可见 Instance Index 数组。
- 每个 Draw 的动态 instance count。
- 对齐的 Indirect Argument。

Indexed Indirect Draw 参数为：

```text
indexCount
instanceCount
firstIndex
baseVertex
firstInstance
```

Vertex Shader 使用 `instance_index` 读取紧凑可见列表，再读取对应 Instance 记录。
Indirect Buffer 使用 `INDIRECT | STORAGE | COPY_DST`，每个参数块至少按
`minStorageBufferOffsetAlignment` 分隔。

CPU 不逐帧回读可见列表。Benchmark 调试路径可异步复制并聚合可见与裁剪数量，但该操作
不得进入普通帧循环。

Indirect Draw 不能跨不同 Geometry 或 Pipeline 合并。如果可见性数据没有证明明显收益，
后端继续使用 Plan 和 Storage 路径，不把未验证的 Compute 默认开启。

## 13. CPU 与 GPU 时间测量

Benchmark 将一次 renderer 调用拆成以下 CPU 阶段：

```text
collectMs
prepareAndUploadMs
encodeMs
submitMs
```

四个阶段总耗时与 `cpuFrameMs` 一并保留。阶段计时只在 Benchmark 或显式诊断模式下开启，
不对每个生产帧增加大量 `performance.now()` 调用。

WebGPU GPU 时间覆盖一帧中的 Compute Visibility 和 Render Pass：

1. Benchmark 在 Adapter 支持时请求 `timestamp-query`。
2. Query Set 只包含 timestamp。
3. Compute 或 Render Pass 写入帧开始 timestamp，最后一个 Render Pass 写入结束
   timestamp。
4. Command Encoder 把 Query Set Resolve 到带 `QUERY_RESOLVE | COPY_DST` 的 Read Buffer。
5. 使用环形 GPU Buffer 延迟到后续帧异步 Map。
6. `end - start` 转换为毫秒。

Query 未成功 Resolve、Buffer 无法 Map、结果为 0 或时间倒退时，该样本无效，
`gpuFrameMs` 输出 `null` 和稳定原因。该数值包含 Compute 和绘制工作，不包含 CPU
提交开销。不得用 CPU render 时间、rAF 间隔或 `setTimeout` 代替 GPU 时间。

WebGL2 GPU 时间只在 `EXT_disjoint_timer_query_webgl2` 可用且结果有效时记录。Disjoint
或不可用结果必须输出 `null`，不能用于计算 WebGPU 改善比例。

## 14. 性能场景

Benchmark 支持以下新增或扩展场景：

| Scenario | 用途 | 规模 |
| --- | --- | --- |
| `wastewater-1x` | 真实污水厂防回退 | 当前完整合成 Asset |
| `wastewater-5x` | 中等规模增长 | 复用 Geometry 的 5 份布局 |
| `wastewater-20x` | 接近规模拐点 | 复用 Geometry 的 20 份布局 |
| `instanced-50k` | Storage 与实例提交压力 | 50,000 instances |
| `culling-20k` | GPU 可见性 | 20,000 instances，仅约 25% 在视锥内 |

规模化污水厂场景使用已加载的 Geometry 和 Material，并生成新的稳定 Node ID、
Selection ID 和局部矩阵。不得复制 GPU Buffer 到无法统计的路径，也不得把 Asset 网络
加载和几何准备时间混入稳态 `cpuFrameMs`。

每个后端与 Scenario：

- 使用 `1280 x 720`、DPR `1`、固定 Camera 和无 2D overlay。
- 先预热 60 帧，再测量 300 帧。
- 至少重复 5 次，并交替 WebGL2、WebGPU 和 WebGPU 优化路径的顺序。
- 保留原始样本、中位数、p95 和资源计数。
- 单独报告初始化、Pick 和稳态渲染。

报告至少包含：

- 后端、优化层、Scenario 和规模。
- CPU 四阶段分位数和总 CPU 时间。
- 合法 GPU 时间或不可用原因。
- Draw、Instance、可见列表数量、上传次数、上传字节、GPU 字节和缓存驱逐。
- WebGL2 基线、WebGPU 优化前基线和 WebGPU 优化后结果的 improvementPercent。

## 15. 公共状态与 Diagnostic

本规格不增加新的公开配置或后端选择开关。Optimization tier 由 backend 自动选择，避免
应用为同一硬件维护额外配置。`ICEScene.revision` 是唯一新增的只读公共状态，用于证明
结构缓存何时失效。

Renderer 内部和 Benchmark 可以读取安全统计：

```ts
type ICEWebGPUOptimizationStats = Readonly<{
  tier: ICEWebGPUAccelerationTier;
  selectionMaskActive: boolean;
  bundleActive: boolean;
  storageActive: boolean;
  visibilityActive: boolean;
  instanceUploadBytes: number;
  bundleRecreations: number;
  timestampUnavailableReason?: string;
}>;
```

该类型不包含 GPU、Adapter、Device、Buffer、Texture、Query Set 或原始 Limit 对象。
公开 `ice3` facade 不导出该内部类型。

新增稳定 Diagnostic：

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE` | 可选优化层自检或运行失败并降级 | 正常使用；需要性能排查时检查 warning details |

Diagnostic 只包含安全层名、稳定原因类别和计数值。同一个能力在同一 Device 生命周期
内只报告一次 warning。

核心 Pipeline、Canvas 或必需 Buffer 失败继续使用现有
`ICE3_WEBGPU_PIPELINE_FAILED`、`ICE3_WEBGPU_UNAVAILABLE` 或
`ICE3_GPU_RESOURCE_FAILED`，不与可选优化降级混淆。

## 16. 错误处理与生命周期

| 失败项 | 行为 |
| --- | --- |
| Render Bundle 创建或执行失败 | 关闭 Bundle，直接编码相同 Draw |
| Storage Buffer 能力或绑定失败 | 使用 Vertex Attribute instance path |
| Selection Mask 分配失败 | 使用逐对象 Selection Draw |
| Compute 或 Indirect 初始化失败 | 关闭 `gpu-driven`，使用 Plan |
| GPU timestamp 不可用 | 输出 `null` 和建议原因，继续渲染 |
| 单个异步 timestamp Readback 失败 | 丢弃该样本，不影响 Renderer |
| 优化资源容量增长 | 替换 Buffer 并使依赖 Bundle 失效 |
| WebGPU Device Lost | 清理全部依赖资源，重建 Device 后再做能力自检 |

优化层失败不能阻止当前帧渲染。必须在首个失败帧完成降级，不能每帧重试不可用能力。

`dispose()`、resize、Device Lost 和恢复必须幂等释放：

- Render Bundle 和 Pipeline。
- Uniform、Instance、Storage、Selection、Indirect 和可见列表 Buffer。
- Query Set 和环形 Read Buffer。
- Bind Group 和 Texture View。

恢复后的首个可测量帧必须报告新的能力层和资源 generation。运行中的 Device Lost 不触发
WebGL2 热切换；启动探测的 WebGL2 fallback 行为保持不变。

## 17. 测试策略

所有行为变化遵循 RED-GREEN-REFACTOR。

### 17.1 单元测试

- `ICEScene.revision` 对添加、移除、visible 和局部矩阵变化递增。
- Camera、Selection、Background 和 Viewport 变化不递增 Scene revision。
- 相同 revision 复用 Draw Plan，变化后重建且不泄漏旧资源。
- Selection 规范化和 Mask 编码覆盖重复、乱序、空集合和 semantic 边界。
- 单一 Batch 中多个选中 semantic 只产生一次 tint 和至多一次 Edge Overlay。
- Instance 内容不变时不上传，矩阵变化只上传受影响 Batch。
- Buffer 扩容使 Bundle 失效，内容写入不使 Bundle 失效。
- Storage 页大小、绑定对齐和跨页 semantic/Pick ID 映射正确。
- Frustum 边界、完全可见、完全不可见和相交实例结果正确。
- Indirect 参数保留正确 `indexCount`、`firstIndex` 和 `baseVertex`。
- Timestamp Query 无效、零值、倒退和 Map 失败返回 `null`。
- 每个优化层不可用时进入明确 fallback，Diagnostic 不重复。

### 17.2 浏览器集成测试

- WebGL2 与 WebGPU 对 Mesh、Instance、Batch、顶点色、Selection 和 Pick 产生相同语义。
- WebGPU 优化前后对同一污水厂 Camera 产生完整可见 Scene。
- Selection tint、选中 Edge、空白区和精确 Pick 一致。
- Render Bundle、Storage 和 Compute 各自失败时仍产生可见帧。
- Device Lost 后 Bundle、Storage、Selection Mask 和 timestamp 资源全部重建。
- resize、DPR、Capture 和重复 dispose 后无空白帧或失效资源。
- `auto` 在 WebGPU 不可用时继续选择 WebGL2；显式 `webgpu` 不静默切换。

视觉比较允许抗锯齿、线宽和少量像素颜色差异，不允许场景节点缺失、遮挡错误、背景错误、
Selection 身份错误或黑屏。

### 17.3 性能测试

性能门槛在固定硬件本地报告执行，共享 CI 只验证 schema、统计逻辑、路径选择和功能正确
性，不设置跨机器绝对毫秒阈值。

每个门槛使用至少 5 次重复。报告先分别计算每次重复的同一指标，再比较重复中位数；
同时保留 p95，防止中位数收益掩盖长尾回退。

## 18. 量化验收

功能验收：

- `npm run verify` 在 Node.js 24.22.1 下通过。
- 真实 WebGPU smoke 和缺少 WebGPU 时的 WebGL2 fallback 通过。
- WebGPU 和 WebGL2 的功能等价矩阵通过。
- 优化层失败测试证明为低成本 WebGPU fallback，而不是静默改变用户可见结果。
- 无 GPU、Adapter、Device、Buffer、Query 或原始 Limit 对象进入公开 package。

Selection 验收：

```text
drawCalls <= baselineGeometryDraws + edgeOverlayDraws
```

Draw 数不得随选中 semantic 数量线性增长。现有 `selection` 场景 501 Draw 必须降到
该场景常规 Geometry Draw 与必要 Edge Overlay Draw 之和。

防回退验收：

- `wastewater-1x` 相对优化前 WebGPU，CPU 中位数回退不超过 10%。
- `wastewater-1x` CPU p95 回退不超过 10%。
- 可用 GPU 时间回退不超过 5%。
- Draw 数不得高于优化前同场景。
- Scene 稳态后，重复帧不得重新上传未变化的 Instance 数据。

Storage 验收：

- 在 `instanced-50k` 或 `wastewater-5x` 上，Storage 路径相对同设备 WebGPU Vertex
  Attribute 路径取得至少 10% CPU 中位数收益，且 GPU 时间回退不超过 5% 时，才可作为
  默认路径。
- 未达到门槛时保留 Storage 实现能力和报告，但不声称取得性能提升，也不默认启用。

GPU-driven 验收：

- `culling-20k` 上 Compute/Indirect 相对同设备 CPU visibility 路径，CPU render 中位数
  至少改善 20%。
- 同一场景端到端 CPU 准备时间至少改善 10%。
- 合法 GPU 时间回退不超过 5%。
- 未达到门槛时关闭默认 Compute 路径并保留负结果，不能以 API 使用量代替性能收益。

规模化对比：

- 报告 `wastewater-1x`、`5x` 和 `20x` 上 WebGPU 相对 WebGL2 的 CPU、CPU p95、合法
  GPU 时间和 Draw 数据。
- 明确给出当前硬件上的性能交叉规模。
- `wastewater-20x` 的目标是 CPU render 中位数至少改善 20%；未达到时报告瓶颈和负结果。
- 初始化速度、旧 Selection Draw 数或不可用 GPU 时间不能单独作为持续渲染优势。

## 19. 交付与文档

Engine 仓库更新：

- 本规格和文档索引。
- 优化能力、Diagnostic、Benchmark 场景和量化门槛。
- Renderer 架构和帧生命周期的内部资源说明。
- 本地 Benchmark 命令、JSON 字段和不可用原因说明。

除只读 `ICEScene.revision` 外，公开 API、Asset contract 和跨仓库 semantic identity
不变。`ice3-agent-console`、`ice3-toolchain`、`ice3-doc` 和示例 Asset 不需要结构性
修改。只有在 Console 使用新增 Diagnostic 时，才增加对应适配测试。

`output/benchmarks/` 中的本机输出保持 Git ignore。性能报告作为交付证据提供，但不提交
设备指纹或绝对输出路径。

## 20. 关联文档

- `ICE3-ENG-IDX-001` — [文档索引](../README.md)
- `ICE3-ENG-ARC-001` — [Engine 架构](../architecture.md)
- `ICE3-ENG-REF-001` — [Diagnostic](../diagnostics.md)
- `ICE3-ENG-SPEC-004` — [WebGPU Renderer 设计](2026-10-29-webgpu-renderer-design.md)
