# Camera 驱动的 Tileset 与 LOD

> Document ID: ICE3-ENG-ADR-003
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 背景

工业 Tileset 的 Geometry 数量可能远超当前 camera 所需。加载所有 Tile 会造成长启动
时间和不必要 GPU memory；简单替换则可能暴露空洞或丢失当前 Selection。

## 决策

Runtime 根据 camera、Bounds 和 screen-space error 推导 visible、prefetch 和 retained
Tile set。只有 required content resident 后，完整 child coverage 才替换 parent
coverage。Failed 或 stale work 保留 last-known-complete representation。

稳定 semantic Selection ID 独立于 LOD Node ID。

## 备选方案

- 首次渲染前加载全部 Tile。
- Camera movement 时立即替换 parent content。
- 使用 Node name 作为 Selection identity。

这些方案用可预测交互和 identity stability 换取较短实现，但无法支撑工业 Scene 规模。

## 影响

- 初始渲染可以发生在所有 Tile resident 之前。
- Visible coverage 优先于 soft residency target。
- Transition 期间 coarse 和 fine Node 可以共存。
- 只有没有任何 resident content 包含该 semantic identity 时才清除 Selection。

## 兼容性

Runtime 支持显式本地 Cartesian OGC 3D Tiles 子集。更广泛 tiling feature 需要新的
compatibility decision。

## 验证

```bash
npm test -- packages/runtime/tests/asset
npm run test:e2e
```

## 关联文档

- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
- `ICE3-ENG-GUIDE-002` — [Asset 加载](../guides/asset-loading.md)
- `ICE3-DOC-SPEC-002` — [Adaptive Tileset Scheduler](https://github.com/ice-3d/ice3-doc/blob/main/docs/specs/2026-10-27-adaptive-tileset-scheduler-design.md)
