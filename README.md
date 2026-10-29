# ICE3 Engine

> Document ID: ICE3-ENG-RM-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

ICE3 Engine 是面向工业应用的可编程 3D Runtime。它优先处理 Geometry、空间组织、
确定性生命周期、稳定设备 identity 和共享 2D/3D 交互，而不是电影化光照。

## 能力

| 领域 | 当前能力 |
|---|---|
| Scene | 类型化场景树、Node 所有权、变换、序列化和释放 |
| 渲染 | 原生 WebGL2 Geometry、平光 Material 和可选 Geometry 边线 |
| 组合 | 覆盖在 3D 内容之上或与其并排的有序 Canvas2D layers |
| 输入 | 共享 pointer/keyboard 路由、orbit、pan、zoom 和 picking |
| Asset | ICE3 Prepared GLB Profile reader 和 Scene builder |
| 流式加载 | OGC 3D Tiles 1.1 加载、相机工作集、预取和驱逐 |
| LOD | 基于屏幕空间误差的选择，并保持稳定的父级覆盖 |
| Batch | 静态 prepared batches、instancing 和可选 Worker 生成 batches |
| 诊断 | 稳定 error code、帧指标、GPU residency 和 Tileset 统计 |

消费方只从公开的 `ice3` package 导入。`@ice3/*` 下的 package 是实现边界，不是公开
import path。

## 快速开始

运行要求：

- Node.js 24.22.1 LTS
- npm 11 或更高版本
- 支持 WebGL2 的浏览器

```bash
git clone https://github.com/ice-3d/ice3-engine.git
cd ice3-engine
nvm use
npm install
npm run dev:example:m1
```

打开 `http://127.0.0.1:8104/`。默认示例会增量加载虚构污水处理厂。使用
`http://127.0.0.1:8103/` 查看最小 M0 Scene，使用
`http://127.0.0.1:8104/?demo=adaptive` 查看空闲时 Worker batching。

## 最小 Scene

```ts
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = new ICE3().init(host);
const scene = new ICEScene({ id: 'main' });
const camera = new ICEPerspectiveCamera({
  id: 'camera',
  position: [3, 2, 4],
  target: [0, 0, 0],
});

scene.addChild(new ICEMesh({
  id: 'sample-device',
  geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
  material: new ICEBasicMaterial({ color: '#2f81f7' }),
}));

engine.setScene(scene).setCamera(camera).start();

// Release DOM listeners, scene ownership, and GPU resources when finished.
engine.destroy();
```

## Asset 工作流

Runtime 只接受 ICE3 Prepared GLB Profile v1 Asset。通用 source parsing、conversion、
simplification 和 partitioning 属于
[`ice3-toolchain`](https://github.com/ice-3d/ice3-toolchain/blob/main/README.md).

共享格式和兼容规则由权威
[Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)
定义。

## 仓库中的 Asset

可运行的污水处理厂示例使用 `examples/m1/assets/wastewater-plant/tiled/` 下带版本控制的
Tileset hierarchy。单体 source GLB 和 full-model Prepared GLB 是本地生成中间文件，
由 Git 忽略。版本库只提交有大小边界的 runtime slices。

## 验证

```bash
npm run docs:check
npm run test:architecture
npm run typecheck
npm run typecheck:example
npm test
npm run test:e2e
npm run verify
```

`verify` 依次运行文档门禁、架构检查、类型检查、单元测试、构建，以及 Chromium 和
WebKit 浏览器测试。

## 边界

- 浏览器中不提供通用 source format 兼容。
- 当前 profile 不支持 animation、skins、morph targets、textures 或复杂 Material。
- 不执行隐式 tiling、外部 Tileset 加载或 runtime Mesh simplification。
- Engine 不包含业务规则、workflow engine 或 Agent policy。
- Lighting 和 Material 刻意保持基础能力；Geometry 与空间行为才是产品重点。

## 文档

- [文档索引](docs/README.md)
- [Runtime 架构](docs/architecture.md)
- [快速开始](docs/guides/getting-started.md)
- [Asset 加载](docs/guides/asset-loading.md)
- [开发与故障处理](docs/guides/development-and-troubleshooting.md)
- [M0 API](docs/api/m0.md)
- [M1 Asset API](docs/api/m1.md)
- [Diagnostic](docs/diagnostics.md)
- [架构决策](docs/decisions/README.md)

## AI 辅助开发

本项目在设计和实现过程中大量使用了 AI 辅助开发。

## 许可证

本项目采用 [MIT License](LICENSE) 许可。
