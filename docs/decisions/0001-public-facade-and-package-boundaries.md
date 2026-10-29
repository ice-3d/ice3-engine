# 公开 Facade 与 package 边界

> Document ID: ICE3-ENG-ADR-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 背景

Runtime 由多个 package 实现。暴露其内部路径会让 package structure、Renderer
internals 和 Asset implementation detail 成为公开 contract 的一部分。

## 决策

应用只从 `ice3` 导入。Internal package 只能依赖声明的下层。`@ice3/core` 不依赖 DOM、
Canvas、GPU 或同级 package。Renderer 实现不得通过公开 API 暴露 GPU object。

## 备选方案

- 允许应用直接导入每个 package。
- 通过 Runtime method 发布 Renderer 专用 object。
- 在没有强制边界的情况下把全部实现放入一个 package。

这些方案提供短期便利，却会让 backend change 和独立测试变得不安全。

## 影响

- 公开 facade 管理 export 和 compatibility。
- Architecture test 可以拒绝非法 dependency edge。
- Internal package 保持可独立测试。
- 部分 internal capability 需要明确 public facade 决策后才能供应用使用。

## 兼容性

既有公开 `ice3` export 仍是受支持路径。移除或修改 public symbol 必须作出版本和迁移决策。

## 验证

```bash
npm run test:architecture
npm run typecheck
```

## 关联文档

- `ICE3-ENG-ARC-001` — [Engine 架构](../architecture.md)
- `ICE3-ENG-API-001` — [M0 公开 API](../api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
