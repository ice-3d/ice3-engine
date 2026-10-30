# ICE3 Engine 开发与故障处理

> Document ID: ICE3-ENG-GUIDE-003
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 目标结果

在保持仓库架构、测试和 Diagnostic 门禁完整的前提下修改 Engine 行为。

## 开发流程

```bash
nvm use
npm install
npm run typecheck
npm test
npm run test:e2e
npm run verify
```

合入 `main` 前运行完整门禁。Browser test 覆盖 Chromium 和 WebKit，并自行启动 example
server。

## 常见失败

| Diagnostic 或现象 | 处理 |
|---|---|
| `ICE3_ASSET_PROFILE_UNSUPPORTED` | 使用当前 Toolchain 重新生成并校验 Prepared profile |
| `ICE3_ASSET_CONTRACT_MISSING` | 使用带 collaboration contract 的当前 Asset |
| `ICE3_TILESET_UNSUPPORTED` | 使用显式 children、local Cartesian Bounds、relative content 和 `REPLACE` refinement |
| `ICE3_RENDERER_UNSUPPORTED` | 使用支持 WebGL2 的 browser 和 device |
| `ICE3_WEBGPU_UNAVAILABLE` | 仅显式 WebGPU 会触发；检查 Device 或 Pipeline 初始化条件 |
| `ICE3_RENDERER_ASYNC_REQUIRED` | 将同步 `init()` 改为 `await initAsync()` |
| `ICE3_RENDERER_OPTIMIZATION_UNAVAILABLE` | 可选 Storage、Bundle 或 Compute 层已降级；功能仍可用，按性能目标检查 warning details |
| Context loss 后反复空白帧 | 等待 context restoration，并检查 Renderer Diagnostic |
| 本地缺少大型 M1 Asset | 使用 `ice3-toolchain` 生成；source 和 prepared intermediate 已被忽略 |

## 调试规则

- 使用公开 API 复现行为，不通过私有 source import 测试。
- 使用稳定 Diagnostic code，不依赖 message text。
- 调整 residency budget 前检查 GPU upload 和 eviction counter。
- WebGPU 和 WebGL2 性能比较使用 `npm run benchmark:renderers`；不要以单机结果声明通用性能结论。
- Benchmark 的 `Collect`、`Prepare`、`Encode` 和 `Submit` 列分别表示 Scene 收集、
  上传准备、命令编码和队列提交；以中位数和 p95 一起判断回归。
- GPU timing 为 `n/a` 表示当前设备未提供合法 timestamp 或 Resolve/Map 失败；不要把
  CPU 时间或帧间隔当成 GPU 时间。
- 仅测量单个规模不足以决定优化层：使用
  `npm run benchmark:renderers -- --scenarios culling-20k,instanced-50k --repetitions 5`
  比较路径，并用同一硬件、相同参数重复运行。
- Refine Tileset 时保留原 visible coverage。
- 不得引入 Runtime source conversion 来绕过 Asset failure。

## 关联文档

- `ICE3-ENG-REF-001` — [Diagnostic](../diagnostics.md)
- `ICE3-ENG-ADR-001` — [公开 facade 与 package 边界](../decisions/0001-public-facade-and-package-boundaries.md)
- `ICE3-DOC-ADR-002` — [Offline open asset pipeline](https://github.com/ice-3d/ice3-doc/blob/main/docs/decisions/0002-offline-open-asset-pipeline.md)
