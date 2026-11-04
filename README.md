# ICE3 Engine

> Document ID: ICE3-ENG-RM-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

[![npm](https://img.shields.io/npm/v/ice3?label=ice3)](https://www.npmjs.com/package/ice3)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**面向工业现场的可编程 3D Runtime。** 打开一个厂区，几百台设备，能点、能查、能改，
六十帧不掉。它优先解决几何、空间组织、确定性生命周期和稳定设备 identity，而不是电影化光照。

```bash
npm install ice3
```

```ts
import { ICE3, ICEScene, ICEPerspectiveCamera } from 'ice3';

const engine = new ICE3().init(document.querySelector('#stage'));
engine.setScene(new ICEScene({ id: 'main' })).setCamera(camera).start();
```

一个自包含、零依赖的包。`@ice3/*` 是仓库内部的实现边界，不单独发布，也不需要安装。

---

## 1. 能做什么

| 领域 | 能力 |
|---|---|
| **Scene** | 类型化场景树、Node 所有权、变换、序列化与释放 |
| **渲染** | WebGL2（默认）/ WebGPU（实验性）、instancing、静态批次、alpha blending |
| **材质** | CSS 颜色、edge overlay、directional / flat / water shading；**底色贴图、法线贴图、ORM 打包图**（R 遮蔽 / G 粗糙度 / B 金属度），米制盒投影 UV |
| **屏幕空间效果** | 环境遮蔽（三圈采样，默认开）、方向光阴影（视锥按场景包围盒拟合，默认开） |
| **组合** | Canvas2D 图层叠在 3D 之上或并排，共享输入路由 |
| **输入** | pointer / keyboard 路由、orbit、pan、zoom、精确 picking |
| **Asset** | ICE3 Prepared GLB Profile reader、Scene builder |
| **流式加载** | OGC 3D Tiles 1.1、相机工作集、预取与驱逐、屏幕空间误差选层 |
| **诊断** | 稳定 error code、帧阶段耗时、GPU residency、Tileset 统计 |

## 2. 快速开始

需要 Node.js `^24 || >=26`、npm 11+、支持 WebGL2 的浏览器。

```bash
git clone https://github.com/ice-3d/ice3-engine.git
cd ice3-engine
nvm use && npm install
npm run dev:example:m1     # → http://127.0.0.1:8104/
```

三个示例各有用途：

| 命令 | 地址 | 看什么 |
|---|---|---|
| `npm run dev:example` | `:8103` | 最小 Scene、Selection、HUD 图层 |
| `npm run dev:example:m1` | `:8104` | 分层 Tileset、LOD、增量加载（`?demo=adaptive` 看 Worker batching） |
| `npm run dev:example:m2` | `:8115` | Prepared GLB 的 profile、语义 Node、贴图与材质 |

## 3. 最小 Scene

```ts
import {
  ICE3, ICEBasicMaterial, ICEBoxGeometry, ICEMesh, ICEPerspectiveCamera, ICEScene,
} from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = new ICE3().init(host);
const scene = new ICEScene({ id: 'main' });
const camera = new ICEPerspectiveCamera({
  id: 'camera', position: [3, 2, 4], target: [0, 0, 0],
});

scene.addChild(new ICEMesh({
  id: 'pump-01',
  geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
  material: new ICEBasicMaterial({
    color: '#2f81f7',
    roughness: 0.4,
    ormMap: { url: 'textures/pump-orm.png' },   // 可选：遮蔽/粗糙度/金属度
  }),
}));

engine.setScene(scene).setCamera(camera).start();

// 用完释放 DOM 监听、场景所有权与 GPU 资源
engine.destroy();
```

- **默认 WebGL2。** WebGPU 必须显式 `renderer: 'webgpu'` + `await initAsync()`，初始化
  失败会抛错，不静默回退（ADR-004）。
- **拾取是异步的**：`await engine.pick({ x, y })` / `await engine.pickItem({ x, y })`。
- **贴图没有 UV 顶点通道**：UV 由法线主导轴做米制盒投影，所以资产不需要展开 UV。

## 4. 渲染开关

屏幕空间效果默认开启；调试和降级都走同一个入口：

| 入口 | 作用 |
|---|---|
| `?ao=off` | 关环境遮蔽；`?ao=2.5,0.30` 指定半径与强度 |
| `?shadows=0` | 关方向光阴影（默认开，多一次全场景深度 pass） |
| `?shadowdebug=1` / `=2` | 输出遮蔽判定 / 阴影深度图 |

代码里对应 `initialize({ shadows: false })`。调参走地址栏而不是改常量重编译——这是
[SPEC-007](docs/specs/2026-11-04-screen-space-occlusion-notes.md) 和
[SPEC-008](docs/specs/2026-11-04-directional-light-shadows.md) 里记下来的教训。

## 5. Asset 从哪来

Runtime 只吃 **ICE3 Prepared GLB Profile v1**。源格式解析、转换、减面、分块、LOD、
Tileset 生成都在 [ICE3 Studio](https://github.com/ice-3d/ice3-studio/blob/main/README.md) 里做，浏览器不干这些：

- 格式：glTF / GLB、OBJ、STEP、IFC、FBX、USD、JT
- 产物：fine/coarse 分块、render batch、edge overlay、设备绑定清单
- 契约：[Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)

## 6. 命令

| 命令 | 用途 |
|---|---|
| `npm run verify` | 文档 + 架构 + 类型 + 单测 + 构建 + 两套浏览器测试，提交前跑这个 |
| `npm test` | 单元测试（Node test runner） |
| `npm run test:e2e` | Playwright：chromium + webkit |
| `npm run typecheck` | `tsc -b` 全量类型检查（示例工程单独用 `typecheck:example`） |
| `npm run docs:check` | 文档索引、链接与 front-matter 校验 |
| `npm run benchmark:renderers` | 同场景强制跑 WebGL2 / WebGPU，输出 JSON + Markdown 到 `output/benchmarks/` |
| `npm run release:check` | 打出 `ice3-<version>.tgz` 并在临时目录安装验证 |

## 7. 仓库结构

```
packages/
  ice3/        公开门面：唯一对外 import 入口
  core/        Scene、数学、几何、材质
  renderer/    WebGL2 / WebGPU backend、着色器、拾取
  runtime/     引擎生命周期、输入路由、帧循环
  assets/      Prepared GLB / Tileset reader 与 profile 校验
docs/          README（索引）、architecture、api、guides、specs、decisions、plans
examples/      m0 / m1 / m2 三个可直接运行的示例
tests/         单元测试、架构检查、e2e、release 契约
```

## 8. 边界（明确不做）

- 浏览器里不做通用源格式解析与减面，那是 Studio 的活。
- Profile 不含 animation、skins、morph targets；材质只有基础 PBR 参数 + 三张贴图。
- 不做隐式 tiling、外部 Tileset 递归加载、运行时网格简化。
- 不含业务规则、工作流引擎、Agent policy。

## 9. 给 AI Agent 的约定

这一节是给自动改代码的 Agent 看的硬约束，不是宣传语。

**必须遵守**

1. 只从 `ice3` 导入。新增导出要经过 `packages/ice3/src/index.ts`，不能让消费方深引
   `@ice3/*`（ADR-001）。当前公开导出 21 个，改动就要同步本文与 `docs/api/`。
2. **版本号只有一个来源**：`packages/ice3/package.json`。发布脚本与测试都读它，
   不要在任何地方手抄版本。
3. 改渲染行为先写 SPEC（`docs/specs/`），再改代码，最后回填实测数字。现有两份
   SPEC 里记着"看起来对但其实错"的案例——先读，别重犯。
4. 声称"完成"之前跑 `npm run verify`。只跑单测不算完。
5. 新增/删除文档必须同步 `docs/README.md` 索引，否则 `docs:check` 会失败。

**找东西的最短路径**

| 想知道 | 去哪 |
|---|---|
| 公开 API 有哪些 | `packages/ice3/src/index.ts` → 再查 `docs/api/m0.md`、`m1.md` |
| 某个效果为什么这么做 | `docs/specs/`（每份都带实测数据与失败记录） |
| 渲染器内部结构 | `packages/renderer/src/`；入口 `WebGL2RendererBackend.ts` |
| 帧耗时怎么测 | `scripts/` 与 `npm run benchmark:renderers` |
| 架构边界 | `docs/architecture.md`、`docs/decisions/` |

## 10. 文档

- [文档索引](docs/README.md) · [Runtime 架构](docs/architecture.md)
- 指南：[快速开始](docs/guides/getting-started.md) · [Asset 加载](docs/guides/asset-loading.md) · [开发与故障处理](docs/guides/development-and-troubleshooting.md)
- 规格：[视口贴图采样](docs/specs/2026-11-04-viewport-texture-sampling-design.md) · [屏幕空间遮蔽](docs/specs/2026-11-04-screen-space-occlusion-notes.md) · [方向光阴影](docs/specs/2026-11-04-directional-light-shadows.md) · [ORM 打包](docs/specs/2026-11-04-orm-packing.md)
- API：[M0](docs/api/m0.md) · [M1 Asset](docs/api/m1.md) · [Diagnostic](docs/diagnostics.md)
- 决策：[ADR 索引](docs/decisions/README.md)

## 11. 许可证

[MIT](LICENSE)
