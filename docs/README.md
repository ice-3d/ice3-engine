# ICE3 Engine 文档索引

> Document ID: ICE3-ENG-IDX-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 从这里开始

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-RM-001` | [ICE3 Engine](../README.md) | Active | Runtime 概览、快速开始和仓库地图 |
| `ICE3-ENG-RM-002` | [npm package ice3](../packages/ice3/README.md) | Active | 发布 package 的安装和最小使用说明 |
| `ICE3-ENG-ARC-001` | [Engine 架构](architecture.md) | Active | package 边界、帧生命周期和 Asset 流程 |
| `ICE3-ENG-IDX-002` | [架构决策](decisions/README.md) | Active | Engine 设计决策索引 |
| `ICE3-ENG-POL-001` | [仓库规则](../AGENTS.md) | Active | 架构和交付约束 |

## 指南

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-GUIDE-001` | [快速开始](guides/getting-started.md) | Active | 运行 M0 和 M1 examples |
| `ICE3-ENG-GUIDE-002` | [Asset 加载](guides/asset-loading.md) | Active | 加载 Prepared GLB 和 Tileset |
| `ICE3-ENG-GUIDE-003` | [开发与故障处理](guides/development-and-troubleshooting.md) | Active | 验证变更并诊断失败 |
| `ICE3-ENG-GUIDE-004` | [跨格式 Conformance 示例](guides/conformance-example.md) | Active | 七种格式在 Runtime 中的实际加载与 GPU 验证 |

## API 与参考

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-API-001` | [M0 公开 API](api/m0.md) | Active | Core Scene、camera、renderer、layer 和 input API |
| `ICE3-ENG-API-002` | [M1 Asset API](api/m1.md) | Active | Prepared Asset 和 Tileset runtime API |
| `ICE3-ENG-REF-001` | [Diagnostic](diagnostics.md) | Active | 稳定 runtime 和 Asset Diagnostic codes |

## 决策

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-ADR-001` | [公开 Facade 与 package 边界](decisions/0001-public-facade-and-package-boundaries.md) | Active | 让消费方只依赖公开 API |
| `ICE3-ENG-ADR-002` | [Geometry 优先的工业渲染](decisions/0002-geometry-first-industrial-rendering.md) | Active | 优先处理 Geometry 和空间行为 |
| `ICE3-ENG-ADR-003` | [相机驱动的 Tileset 与 LOD](decisions/0003-camera-driven-tileset-and-lod.md) | Active | 流式加载时保持完整覆盖 |

## Spec

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-SPEC-001` | [M0 设计](specs/2026-10-27-engine-m0-design.md) | Implemented | Engine baseline 和生命周期设计 |
| `ICE3-ENG-SPEC-002` | [M1 Asset 设计](specs/2026-10-27-engine-m1-asset-design.md) | Implemented | Prepared GLB 和空间 Runtime 设计 |
| `ICE3-ENG-SPEC-003` | [设备 Selection](specs/2026-10-27-equipment-selection-design.md) | Implemented | 稳定设备 picking 和 highlight 设计 |
| `ICE3-ENG-SPEC-004` | [WebGPU Renderer 设计](specs/2026-10-29-webgpu-renderer-design.md) | Implemented | WebGPU backend、自动选择、fallback 和性能基准设计 |
| `ICE3-ENG-SPEC-005` | [WebGPU 性能优化设计](specs/2026-10-29-webgpu-performance-design.md) | Draft | GPU 计时、Selection Mask、Storage、Bundle 和 Compute 可见性设计 |

## 实施计划

| ID | 标题 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-PLAN-001` | [Engine M0](plans/2026-10-27-engine-m0.md) | Implemented | baseline Engine 实施记录 |
| `ICE3-ENG-PLAN-002` | [Asset Runtime](plans/2026-10-27-engine-m1-asset-runtime.md) | Implemented | Prepared Asset Runtime 实施记录 |
| `ICE3-ENG-PLAN-003` | [设备 Selection](plans/2026-10-27-equipment-selection.md) | Implemented | 设备 Selection 实施记录 |
| `ICE3-ENG-PLAN-004` | [WebGPU Renderer](plans/2026-10-29-webgpu-renderer.md) | Implemented | WebGPU backend、自动选择、fallback 和性能基准实施计划 |
| `ICE3-ENG-PLAN-005` | [WebGPU 性能优化](plans/2026-10-29-webgpu-performance.md) | Draft | WebGPU 测量、Selection、Storage、Bundle 和 Compute 实施计划 |
