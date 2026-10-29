# ICE3 Engine 快速开始

> Document ID: ICE3-ENG-GUIDE-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 目标结果

本地运行 Engine，渲染最小 M0 box Scene 或增量加载的 M1 污水处理厂 example。

## 前置条件

- Node.js 24.22.1 LTS
- npm 11 或更高版本
- 支持 WebGL2 的 Chromium 或 WebKit；现代桌面浏览器可自动使用 WebGPU

## 操作步骤

在仓库根目录运行：

```bash
nvm use
npm install
npm run dev:example
```

Open `http://127.0.0.1:8103/`.

渲染 tiled industrial Scene：

```bash
npm run dev:example:m1
```

Open `http://127.0.0.1:8104/`.

追加 `?renderer=webgpu` 或 `?renderer=webgl2` 可强制图形后端。默认 `auto` 只在
Adapter、Device、Context 和最小 Pipeline 探测通过时选择 WebGPU。

## 预期结果

- M0 显示平光 cube，并呈现清晰 Geometry edge。
- 鼠标拖拽旋转，wheel 缩放，WASD 或 arrow key 平移。
- M1 先显示可访问 loading state，再显示 tiled 污水处理厂。
- M1 点击选择 equipment unit，拖拽不会选中。
- 选中 unit 显示醒目黄色 highlight 和 information panel。

## 故障诊断

| 现象 | 检查 |
|---|---|
| WebGL2 不可用 | 启用硬件加速并使用当前浏览器 |
| WebGPU 可用但选择了 WebGL2 | 在 `getDiagnostics().rendererSelection.fallbackReason` 查看探测失败原因 |
| M1 Scene 空白 | 检查 `docs/diagnostics.md` 以及浏览器 network panel 中的 Tileset/GLB failure |
| Asset 显示为 placeholder | 确认版本库中的 `tiled/` tree 存在 |
| Connection refused | 确认 command 仍在文档指定端口运行 |

## 关联文档

- `ICE3-ENG-RM-001` — [README](../../README.md)
- `ICE3-ENG-API-001` — [M0 公开 API](../api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
- `ICE3-ENG-GUIDE-002` — [Asset 加载](asset-loading.md)
- `ICE3-TOOL-GUIDE-003` — [从 GLB 到 Engine 的完整接入流程](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/glb-to-engine.md)
