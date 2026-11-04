# ICE3 Engine 文档索引

> Document ID: ICE3-ENG-IDX-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 1. 从这里开始

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-RM-001` | [ICE3 Engine](../README.md) | Active | Runtime 概览、快速开始和仓库地图 |
| `ICE3-ENG-RM-002` | [npm package ice3](../packages/ice3/README.md) | Active | 发布 package 的安装和最小使用说明 |
| `ICE3-ENG-ARC-001` | [Engine 架构](architecture.md) | Active | package 边界、帧生命周期和 Asset 流程 |
| `ICE3-ENG-IDX-002` | [架构决策索引](decisions/README.md) | Active | Engine ADR 索引 |
| `ICE3-ENG-POL-001` | [仓库规则](../AGENTS.md) | Active | 架构、交付和命名约束 |

## 2. 指南

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-GUIDE-001` | [快速开始](guides/getting-started.md) | Active | 运行 M0 和 M1 examples |
| `ICE3-ENG-GUIDE-002` | [Asset 加载](guides/asset-loading.md) | Active | 加载 Studio Prepared GLB 和 Tileset |
| `ICE3-ENG-GUIDE-003` | [开发与故障处理](guides/development-and-troubleshooting.md) | Active | 验证变更并诊断失败 |
| `ICE3-ENG-GUIDE-004` | [glTF Prepared Conformance 示例](guides/conformance-example.md) | Active | 当前 checked-in glTF Prepared GLB 的 Profile、语义和 GPU 验证 |

## 3. API 与参考

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-API-001` | [M0 公开 API](api/m0.md) | Active | Core Scene、camera、renderer、layer 和 input API |
| `ICE3-ENG-API-002` | [M1 Asset API](api/m1.md) | Active | Prepared Asset 和 Tileset Runtime API |
| `ICE3-ENG-REF-001` | [Diagnostic](diagnostics.md) | Active | 稳定 Runtime、Asset 和 Tileset Diagnostic code |

## 4. 决策

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-ADR-001` | [公开 Facade 与 package 边界](decisions/0001-public-facade-and-package-boundaries.md) | Active | 让消费方只依赖公开 API |
| `ICE3-ENG-ADR-002` | [Geometry 优先的工业渲染](decisions/0002-geometry-first-industrial-rendering.md) | Active | 优先处理 Geometry 和空间行为 |
| `ICE3-ENG-ADR-003` | [相机驱动的 Tileset 与 LOD](decisions/0003-camera-driven-tileset-and-lod.md) | Active | 流式加载时保持完整覆盖 |
| `ICE3-ENG-ADR-004` | [WebGPU 实验性 Opt-in](decisions/0004-webgpu-experimental-opt-in.md) | Active | 默认 WebGL2，WebGPU 仅显式启用 |

## 5. 设计规格

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-SPEC-001` | [M0 设计](specs/2026-10-27-engine-m0-design.md) | Implemented | Engine baseline 和生命周期设计 |
| `ICE3-ENG-SPEC-002` | [M1 Asset 设计](specs/2026-10-27-engine-m1-asset-design.md) | Implemented | Prepared GLB 和空间 Runtime 设计 |
| `ICE3-ENG-SPEC-003` | [设备 Selection](specs/2026-10-27-equipment-selection-design.md) | Implemented | 稳定设备 picking 和 highlight 设计 |
| `ICE3-ENG-SPEC-004` | [WebGPU Renderer 设计](specs/2026-10-29-webgpu-renderer-design.md) | Historical | 已完成 WebGPU backend、fallback 和性能设计记录 |
| `ICE3-ENG-SPEC-005` | [WebGPU 性能优化设计](specs/2026-10-29-webgpu-performance-design.md) | Historical | 已完成测量、Selection Mask、Storage、Bundle 和 Compute 设计记录 |
| `ICE3-ENG-SPEC-006` | [视口贴图采样设计](specs/2026-11-04-viewport-texture-sampling-design.md) | Implemented | Base-colour 贴图采样、盒投影 UV 与纹理缓存 |
| `ICE3-ENG-SPEC-007` | [屏幕空间遮蔽笔记](specs/2026-11-04-screen-space-occlusion-notes.md) | Implemented | 三次失败记录、视空间采样实现、三圈权重与 `?ao` 调参通道 |
| `ICE3-ENG-SPEC-008` | [方向光阴影](specs/2026-11-04-directional-light-shadows.md) | Implemented | 三条几何路径、视锥拟合、法线偏移与 `?shadowdebug` 调试通道 |

## 6. 实施计划

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-PLAN-001` | [Engine M0](plans/2026-10-27-engine-m0.md) | Implemented | baseline Engine 实施记录 |
| `ICE3-ENG-PLAN-002` | [Asset Runtime](plans/2026-10-27-engine-m1-asset-runtime.md) | Historical | Prepared Asset Runtime 的历史交付记录 |
| `ICE3-ENG-PLAN-003` | [设备 Selection](plans/2026-10-27-equipment-selection.md) | Implemented | 设备 Selection 实施记录 |
| `ICE3-ENG-PLAN-004` | [WebGPU Renderer](plans/2026-10-29-webgpu-renderer.md) | Historical | WebGPU backend、fallback 和基准的实施记录 |
| `ICE3-ENG-PLAN-005` | [WebGPU 性能优化](plans/2026-10-29-webgpu-performance.md) | Historical | WebGPU 测量、Selection、Storage、Bundle 和 Compute 的实施记录 |

## 7. 状态说明

- `Active`：当前行为、接口或约束。
- `Implemented`：已交付的设计或实施记录。
- `Historical`：保留已完成实施过程的审计证据，不代表当前生产依赖。

## 8. 关联文档

- `ICE3-DOC-ARC-001` — [ICE3 家族架构](https://github.com/ice-3d/ice3-doc/blob/main/docs/architecture.md)
- `ICE3-DOC-CTR-001` — [Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)
- `ICE3-STUDIO-REF-005` — [Studio Asset Pipeline](https://github.com/ice-3d/ice3-studio/blob/main/docs/reference/asset-pipeline.md)
