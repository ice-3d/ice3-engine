# Geometry 优先的工业 Rendering

> Document ID: ICE3-ENG-ADR-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 背景

工业用户主要依赖空间关系、设备 identity、流程连接和易读 Geometry。照片级 lighting
和复杂 Material authoring 会增加 Runtime cost，并可能遮蔽工程 Geometry。

## 决策

Engine 优先保证准确 Geometry、稳定 Bounds、清晰颜色分隔、可见 edge、spatial culling
和 Selection。基本平光颜色、edge 和最小 lighting 足以满足当前产品范围。

## 备选方案

- 优先优化 physically based rendering。
- 依赖复杂 Scene lighting 提升设备可读性。
- 只通过 texture 表达工程含义。

这些方案增加成本，并让关键 Geometry 更难验证和选择。

## 影响

- Flat renderer 仍是主要测试目标。
- Geometry 和空间回归优先于视觉效果。
- 只有明确工业需求证明成本合理时才扩展 Material。

## 兼容性

Prepared Asset 保留 display color 和 semantic identity。未来 lighting 或 Material
backend 必须保留 Geometry-first 默认行为。

## 验证

- Browser test 校验 example 的均匀平光外观和可见 edge。
- Picking test 校验精确 Geometry Selection。
- Performance Diagnostic 分开统计 Geometry upload 与 frame presentation。

## 关联文档

- `ICE3-ENG-API-001` — [M0 公开 API](../api/m0.md)
- `ICE3-DOC-ADR-001` — [通用 Engine 与垂直应用](https://github.com/ice-3d/ice3-doc/blob/main/docs/decisions/0001-universal-engine-and-vertical-applications.md)
