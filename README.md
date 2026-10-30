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
| 渲染 | WebGL2/WebGPU Geometry、自动后端选择、Selection Mask、Render Bundle 和可选 GPU 优化层 |
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
- 支持 WebGL2 的浏览器；WebGPU 为显式启用的实验性后端

```bash
git clone https://github.com/ice-3d/ice3-engine.git
cd ice3-engine
nvm use
npm install
npm run dev:example:m1
```

打开 `http://127.0.0.1:8104/`。默认示例会增量加载虚构污水处理厂，并优先使用通过
能力探测的 WebGPU。使用
`http://127.0.0.1:8103/` 查看最小 M0 Scene，使用
`http://127.0.0.1:8104/?demo=adaptive` 查看空闲时 Worker batching。

运行 `npm run dev:example:m2` 后访问 `http://127.0.0.1:8115/`，可切换七种 synthetic
source format 对应的 Prepared GLB，并查看 Profile、语义 Node 和 GPU 画面验证结果。

## npm package

公开 Engine package 为 `ice3`：

```bash
npm install ice3
```

应用只从 `ice3` 导入。仓库内的 `@ice3/*` package 是实现边界，不单独发布；npm
发行产物会把它们打入 `ice3`。

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

默认使用 WebGL2。WebGPU 目前是实验性能力，必须显式设置
`renderer: 'webgpu'` 并使用 `await initAsync()`；初始化失败会报错，不会静默回退。
`auto` 保留为兼容别名，同样选择 WebGL2。

精确拾取是异步 API：

```ts
const node = await engine.pick({ x: 120, y: 80 });
const { item } = await engine.pickItem({ x: 120, y: 80 });
void node;
void item;
```

## Asset 工作流

Runtime 只接受 ICE3 Prepared GLB Profile v1 Asset。通用 source parsing、conversion、
simplification 和 partitioning 属于
[`ice3-toolchain`](https://github.com/ice-3d/ice3-toolchain/blob/main/README.md).
从 GLB 切分、粗模生成、Tileset 发布到 `ICETilesetLoader` 接入的完整步骤见
[端到端接入指南](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/glb-to-engine.md)。

### 配套工具链

如果模型还不是 ICE3 Prepared GLB，请使用配套的
[ICE3 Toolchain](https://github.com/ice-3d/ice3-toolchain/blob/main/README.md)。
它负责 glTF、STEP、IFC、FBX、USD、OBJ 和 JT 的离线转换、验证、partition、LOD、
render batching 与 Tileset 生成；Engine 不在浏览器中执行这些工作。

- [Toolchain 功能指南](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/capabilities.md)
- [从 GLB 到 Engine 的完整接入](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/glb-to-engine.md)
- [Toolchain CLI 参考](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/reference/cli.md)

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
npm run benchmark:renderers
```

`verify` 依次运行文档门禁、架构检查、类型检查、单元测试、构建，以及两套浏览器
项目测试。

`benchmark:renderers` 在相同 Scene 上强制运行 WebGL2 和 WebGPU，重复测量 CPU
阶段、Pick、Draw 和 GPU byte 数据，并将 JSON/Markdown 输出到
`output/benchmarks/`。GPU timestamp 不可用时报告 `n/a` 和原因，不伪造零值。

WebGPU 优化按 `baseline`、`storage` 和 `gpu-driven` 分级启用。当前固定硬件测量未使
Storage 或 Compute/Indirect 达到默认启用门槛，因此它们保留为可测试路径，不替代稳定
baseline。规模化复测可使用：

```bash
npm run benchmark:renderers -- --scenarios culling-20k,instanced-50k --repetitions 5
```

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
- [跨格式 Conformance 示例](docs/guides/conformance-example.md)
- [M0 API](docs/api/m0.md)
- [M1 Asset API](docs/api/m1.md)
- [Diagnostic](docs/diagnostics.md)
- [架构决策](docs/decisions/README.md)

## AI 辅助开发

本项目在设计和实现过程中大量使用了 AI 辅助开发。

## 许可证

本项目采用 [MIT License](LICENSE) 许可。
