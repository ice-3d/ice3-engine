# ICE3 Engine 架构决策索引

> Document ID: ICE3-ENG-IDX-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 决策

| ID | 决策 | Status | 用途 |
|---|---|---|---|
| `ICE3-ENG-ADR-001` | [公开 Facade 与 package 边界](0001-public-facade-and-package-boundaries.md) | Active | 让消费方只依赖一套公开 API |
| `ICE3-ENG-ADR-002` | [Geometry 优先的工业 Rendering](0002-geometry-first-industrial-rendering.md) | Active | 优先 Geometry 和空间行为 |
| `ICE3-ENG-ADR-003` | [Camera 驱动的 Tileset 与 LOD](0003-camera-driven-tileset-and-lod.md) | Active | 在有界 streaming 下保持 coverage |
| `ICE3-ENG-ADR-004` | [WebGPU 实验性 Opt-in](0004-webgpu-experimental-opt-in.md) | Active | 默认 WebGL2，显式启用实验性 WebGPU |

## 关联文档

- `ICE3-ENG-IDX-001` — [Engine 文档索引](../README.md)
- `ICE3-ENG-ARC-001` — [Engine 架构](../architecture.md)
