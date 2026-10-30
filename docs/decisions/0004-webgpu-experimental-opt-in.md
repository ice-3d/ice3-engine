# ICE3 Engine WebGPU 实验性 Opt-in 决策

> Document ID: ICE3-ENG-ADR-004
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 背景

ICE3 Engine 已具备 WebGL2 与 WebGPU 两套功能等价后端。固定硬件压力测试表明：

- WebGPU 在 Selection 和 50k 实例场景有收益。
- 当前真实污水处理厂 1×、5× 和 20× 场景中，WebGL2 的 CPU render 中位数和 p95
  仍优于 WebGPU。
- 当前验证设备无法提供有效 GPU timestamp，不能证明 WebGPU 在真实场景中有 GPU
  吞吐优势。
- Storage Buffer 和 Compute/Indirect 未达到各自默认启用门槛。

因此，仅凭浏览器暴露 WebGPU 就自动切换后端，会让用户承担未经验证的性能和兼容性
风险。

## 决策

1. WebGL2 是默认生产后端。
2. `auto` 保留为兼容别名，但解析到 WebGL2，不探测或启用 WebGPU。
3. WebGPU 标记为实验性能力，只有调用方显式设置
   `renderer: 'webgpu'` 时才启用。
4. 显式 WebGPU 初始化必须使用 `initAsync()`；设备或 Pipeline 不可用时抛出
   `ICE3_WEBGPU_UNAVAILABLE`，不静默切换。
5. `getDiagnostics().rendererSelection.experimental` 标识当前选择是否为实验性后端。
6. WebGPU Renderer、Selection、Storage、Bundle、Compute 和 Indirect Draw 保持实现与
   测试，以便后续重新评估，不删除已有能力。

## 行为矩阵

| 初始化方式 | 选择结果 |
| --- | --- |
| `new ICE3().init(host)` | WebGL2 |
| `await new ICE3().initAsync(host)` | WebGL2 |
| `new ICE3({ renderer: 'auto' }).init(host)` | WebGL2 |
| `await new ICE3({ renderer: 'auto' }).initAsync(host)` | WebGL2 |
| `new ICE3({ renderer: 'webgl2' }).init(host)` | WebGL2 |
| `await new ICE3({ renderer: 'webgpu' }).initAsync(host)` | 实验性 WebGPU |

显式 WebGPU 成功时，Diagnostic 中 `selected` 为 `webgpu`、
`experimental` 为 `true`。默认和 `auto` 选择 WebGL2 时 `fallback` 与
`experimental` 均为 `false`，因为这不是探测失败后的回退。

## 重新评估条件

只有同时满足以下条件，才重新讨论默认启用 WebGPU：

- 代表性真实工业场景在固定硬件上 CPU 中位数和 p95 不明显回退。
- GPU timestamp 可用，并能证明持续渲染收益。
- Storage 和 GPU-driven 路径达到既定门槛，或 baseline 路径本身已有稳定收益。
- 目标浏览器与设备矩阵通过视觉、Pick、Device Lost、Capture 和 Resize 验证。
- 可选择的小流量 rollout 未显示错误率、卡顿或功耗回退。

## 后果

- 默认用户体验优先稳定性与当前最佳实测性能。
- WebGPU 仍可通过 URL 参数、应用配置或显式 API 选择进行验证。
- 应用升级后，依赖 `auto` 自动选择 WebGPU 的调用会改为 WebGL2；这是预期行为变化。
- 后续提升 WebGPU 支持级别时，需要新的决策记录，不修改本 ADR 的历史结论。

## 关联文档

- `ICE3-ENG-SPEC-004` — [WebGPU Renderer 设计](../specs/2026-10-29-webgpu-renderer-design.md)
- `ICE3-ENG-SPEC-005` — [WebGPU 性能优化设计](../specs/2026-10-29-webgpu-performance-design.md)
