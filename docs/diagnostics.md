# ICE3 Diagnostic

> Document ID: ICE3-ENG-REF-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers
Diagnostic 使用稳定 code。调用方应根据 `code` 分支，不依赖 message text。

## Engine 与 target

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_INVALID_TARGET` | Selector 未找到 element、canvas 没有 parent，或无法创建 canvas | 提供已连接的 host element |
| `ICE3_ALREADY_INITIALIZED` | 同一 Engine 多次调用 `init()` | 在 `destroy()` 后创建新 Engine |
| `ICE3_ENGINE_NOT_READY` | 没有 Scene 或 camera 就请求渲染，或在初始化前调用 backend method | 完成 Scene、camera 和初始化配置 |
| `ICE3_ENGINE_DESTROYED` | disposal 后继续执行 backend 或 Engine operation | 停止使用该 instance 并创建 replacement |
| `ICE3_CONTEXT_LOST` | 浏览器丢失 GPU context | 保持应用可见，等待 restoration 并检查 event |
| `ICE3_CONTEXT_RESTORED` | 浏览器恢复 GPU context，Engine 能再次绘制 | 恢复正常运行并验证新 frame |
| `ICE3_RENDERER_CONFIG_INVALID` | 同时注入 backend 并指定 renderer preference | 只使用一种配置方式 |
| `ICE3_RENDERER_ASYNC_REQUIRED` | `auto` 或 `webgpu` 传给同步 `init()` | 改用 `initAsync()` |
| `ICE3_WEBGPU_UNAVAILABLE` | 显式 WebGPU 探测、Device 或 Pipeline 初始化失败 | 检查 `rendererSelection.fallbackReason` |
| `ICE3_WEBGPU_DEVICE_LOST` | 运行中 WebGPU Device Lost 且恢复失败 | 重建 Engine 或刷新页面 |
| `ICE3_WEBGPU_PICK_UNAVAILABLE` | WebGPU Pick target、copy 或 map 失败 | 重试 Pick；持续失败时使用 WebGL2 |
| `ICE3_CAPTURE_UNAVAILABLE` | active backend 不提供像素 capture | 升级实现或使用支持 capture 的 backend |

## Scene 与 layer

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_DUPLICATE_OBJECT_ID` | 不同 object 使用同一 Scene Node ID | 分配唯一稳定 ID |
| `ICE3_SCENE_CYCLE` | parent-child operation 形成 cycle | 调整 Node hierarchy |
| `ICE3_LAYER_ORDER_CONFLICT` | Layer 与既有 layer identity 冲突 | 每个 layer 使用一个稳定 ID |
| `ICE3_UNKNOWN_ANCHOR` | World label 引用 active Scene 中不存在的 ID | 修正 anchor ID 或加入 target Node |
| `ICE3_UNKNOWN_TYPE` | Deserialization 遇到未注册 type ID | 加载前注册 type |
| `ICE3_INVALID_NODE_DATA` | 已注册 Node type 的数据格式错误 | 修复 snapshot 或迁移到当前 schema |

## Asset

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_ASSET_FETCH_FAILED` | Asset network request 失败 | 检查 URL、network 和 permission |
| `ICE3_ASSET_ABORTED` | 外部 abort signal 取消加载 | 只有调用方启动新 request 时才重试 |
| `ICE3_ASSET_INVALID_GLB` | GLB framing、Scene graph 或 required profile field 无效 | 使用 Toolchain 重新生成 Asset |
| `ICE3_ASSET_PROFILE_UNSUPPORTED` | GLB 不是受支持的 ICE3 prepared profile | 使用 Toolchain 处理 source model |
| `ICE3_ASSET_ACCESSOR_INVALID` | Accessor type、alignment、range 或 index 违反 profile | 重新生成 Prepared GLB |
| `ICE3_ASSET_UNSUPPORTED_FEATURE` | Profile 包含 animation、texture、camera、light 或其他 M1 禁止功能 | 只重新导出受支持的 Scene 子集 |
| `ICE3_ASSET_DUPLICATE_ID` | Node 或 Mesh semantic ID 冲突 | 使用 Toolchain 重新生成确定性 ID |
| `ICE3_ASSET_INTEGRITY_FAILED` | 显式 BIN digest 校验失败 | 重新构建或下载 Asset |
| `ICE3_ASSET_CONTRACT_MISSING` | Legacy Prepared Asset 没有 collaboration contract | 尽可能用当前 Toolchain 重建 |
| `ICE3_ASSET_CONTRACT_UNSUPPORTED` | Contract version 或 budget metadata 不受支持 | 使用兼容的 Toolchain/Runtime 组合重建 |
| `ICE3_ASSET_STATS_MISMATCH` | Embedded Asset stat 与 prepared structure 不一致 | 重建 Asset 并检查 Toolchain output |
| `ICE3_ASSET_BATCH_INVALID` | Batch metadata、semantic array、primitive reference 或 semantic index 无效 | 使用当前 Toolchain 重新生成 static batch |
| `ICE3_TOOL_RUNTIME_CONVERSION_REQUIRED` | Asset 声明需要 Runtime conversion | 将 conversion 移到外部 Toolchain |

## Tileset

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_TILESET_INVALID` | Tileset JSON、required identity、Bounds、transform 或 content reference 格式错误 | 使用 Toolchain 重新生成 Tileset |
| `ICE3_TILESET_UNSUPPORTED` | Tileset 使用 `region`、外部 Tileset、implicit tiling、不支持 content 或其他未批准功能 | 导出受支持的本地 Cartesian explicit-tree 子集 |
| `ICE3_TILESET_TILE_FAILED` | 某个 partition 的 request、profile validation 或 Scene merge 失败 | 检查 tile ID 并保留已成功加载 partition |
| `ICE3_TILESET_DUPLICATE_ID` | Partition 复用其他已加载 partition 中的 Scene ID | 使用 Toolchain 重新生成稳定唯一 ID |
| `ICE3_TILESET_ABORTED` | Caller signal 或 Tileset disposal 取消加载 | Tileset 仍需要时启动新加载 |
| `ICE3_TILESET_CAMERA_REQUIRED` | 创建 Tileset work-set scheduling 时没有 camera | 传入 active PerspectiveCamera |
| `ICE3_TILESET_RESIDENT_BUDGET_EXCEEDED` | Resident partition 超过 soft memory 或 Tile budget | 接受更大的 visible work set 或减小 partition；residency 回到 budget 前 warning 会去重 |
| `ICE3_TILESET_LOD_INVALID` | SSE threshold 或 LOD hierarchy 配置无效 | 使用正数 threshold 并重新生成 hierarchical Tileset |
| `ICE3_TILESET_LOD_FALLBACK` | 更细 target content 不可用，resident coarse ancestor 继续可见 | 检查 target Tile failure，保留当前 fallback coverage |
| `ICE3_TILESET_CONTENTS_INVALID` | Tile 的 content entry 冲突、为空或重复 | 重新生成 Tileset |
| `ICE3_SCENE_QUERY_INVALID` | Query limit 或 world ray 无效 | 修正 query input |
| `ICE3_CAMERA_FOCUS_INVALID` | Focus padding 或 Bounds 无效 | 传入正数 padding 和有限 Bounds |

## Rendering

| Code | 触发条件 | 调用方处理 |
| --- | --- | --- |
| `ICE3_WEBGL2_UNAVAILABLE` | WebGL2 context 创建失败 | 使用经过验证的 WebGL2 browser 和 GPU 配置 |
| `ICE3_SHADER_COMPILE_FAILED` | Native shader compilation 失败 | 检查 Diagnostic 和 Renderer log |
| `ICE3_SHADER_LINK_FAILED` | Program linking 或 uniform lookup 失败 | 验证 Shader 与 active backend 兼容 |
| `ICE3_GPU_RESOURCE_FAILED` | GPU buffer 或 vertex-array allocation 失败 | 降低 resource pressure 并重建 context |
| `ICE3_RENDER_INSTANCING_FALLBACK` | Instance buffer 无法分配，重复 Geometry 使用普通 draw | 降低 GPU memory pressure；Selection 仍可用 |
| `ICE3_RENDER_BATCH_ADAPTIVE_STARTED` | Idle-time adaptive render batch generation 开始 | 仅用于信息提示；camera motion 会取消 |
| `ICE3_RENDER_BATCH_ADAPTIVE_COMPLETED` | 完整 candidate generation 原子替换 active batch layout | 继续正常 rendering 和 Selection |
| `ICE3_RENDER_BATCH_ADAPTIVE_CANCELLED` | Camera motion、disposal 或 lifecycle change 取消 generation | 上一个 active generation 继续可用 |
| `ICE3_RENDER_BATCH_ADAPTIVE_FAILED` | Worker preparation 或 frame budget upload 失败 | 保留 active generation 并检查原因 |
| `ICE3_RENDER_BATCH_MEMORY_REJECTED` | Candidate 超过配置的 extra GPU byte budget | 提高可选 budget 或减少 visible source set |

## Diagnostic 结构

```ts
interface ICEDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}
```

`ICE3` 通过 `getDiagnostics().lastDiagnostic` 暴露最近 Diagnostic，并在记录新 Diagnostic
时发送 `DIAGNOSTIC`。

Renderer Diagnostic 还暴露累计 `gpuUploads` 和 `gpuEvictions` count。这些 counter 让
camera、LOD 和 residency regression test 中的异常 GPU buffer churn 可见。

## 关联文档

- `ICE3-ENG-IDX-001` — [文档索引](README.md)
- `ICE3-ENG-API-002` — [M1 Asset API](api/m1.md)
- `ICE3-ENG-GUIDE-003` — [开发与故障处理](guides/development-and-troubleshooting.md)
