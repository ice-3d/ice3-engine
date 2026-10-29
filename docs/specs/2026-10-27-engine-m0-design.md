# ICE3 Engine M0 设计规格

> Document ID: ICE3-ENG-SPEC-001
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers
>

| 项目 | 内容 |
| --- | --- |
| 状态 | 已实现 |
| 版本 | 1.1 |
| 日期 | 2026-10-27 |
| 范围 | `ice3-engine` 仓库的 M0 可运行纵切面 |
| 上游约束 | 产品方案 v0.6、工作区文档与交付物命名约束 |

## 1. 目标

M0 的目标是建立一个可运行、可测试、可持续扩写的 ICE 风格 3D 引擎基础，一次验证四个关键决策：

1. 公共 API 是否满足可编程引擎的产品定位。
2. ICE 的事件、生命周期、类型、诊断和序列化风格能否自然用于 3D。
3. 2D 与 3D 图层能否共享相机、选择集和输入，并保持像素对齐。
4. 自有最小 WebGL2 后端能否支撑后续渲染能力扩展。

M0 不是功能完整版。验收标准是完成一条从公共 API 到浏览器像素和交互结果的闭环，而不是堆积渲染特性。

## 2. 成功标准

M0 完成时，一个开发者只依赖 `ice3` 公共包即可：

- 创建画布和引擎实例。
- 创建场景、透视相机、基础几何和材质。
- 添加一个可渲染的 3D 物体。
- 使用鼠标或触摸旋转、缩放相机视角。
- 添加绑定世界坐标的 2D 标注。
- 添加固定屏幕坐标的 2D HUD。
- 在 2D 控件、2D 透明区域和 3D 物体之间正确路由输入。
- 查询和订阅选择状态。
- 在窗口尺寸和 DPR 变化后保持对齐。
- 显式销毁引擎，并释放所有动画帧、事件和 GPU 资源。
- 在单测、浏览器交互测试和像素检查中得到可重复结果。

## 3. 非目标

M0 明确不包含：

- 模型加载器和 glTF 解析。
- LOD、实例表、分区流式加载和空间索引。
- 工业设备、点位、告警和业务语义。
- Agent、对话协议或任何 AI 专用接口。
- 资产编译器和 CLI。
- 编辑器、Studio 或正式行业应用。
- WebGPU 后端。
- 阴影、后处理、物理、骨骼动画和粒子系统。
- CJS/UMD 发行产物；M0 以 ESM、类型声明和浏览器示例为交付范围。

这些能力继续由后续里程碑或独立工程承载。

## 4. 强制约束

### 4.1 API 与代码风格

- 公共 API 延续 ICE 家族的显式构造、初始化、层级、事件和销毁语义。
- 消费者只依赖 `ice3` 公共入口，不直接引用内部包源码路径。
- 公共返回类型不得泄漏 WebGL、DOM 或任何内部渲染实现对象。
- 可序列化对象必须有稳定且规范化的类型 ID。
- 公共事件使用 `on`、`off`、`once`，并保持同一函数引用取消订阅的语义。
- 可预期错误返回结构化诊断或抛出带稳定错误码的 ICE 异常。

### 4.2 命名与法务边界

- 文档、注释、示例、类名、变量名、包名和目录名不得包含竞品、厂商或第三方产品品牌词。
- 不引用包含竞品或厂商信息的站外页面。
- 技术描述使用“通用 3D 库”“第三方渲染适配层”“场景库”等中性表达。

### 4.3 技术基线

- 浏览器端采用 TypeScript 和 ESM。
- 首版图形后端使用 WebGL2。
- 不维护 WebGL1 回退。
- 仓库使用 npm workspaces。
- 单元测试使用 Node.js test runner。
- 浏览器交互测试使用 Playwright。
- 运行环境遵循当前与上一代 Node LTS 的支持策略。

## 5. 仓库布局

```text
ice3-engine/
├─ packages/
│  ├─ core/
│  ├─ renderer/
│  ├─ runtime/
│  └─ ice3/
├─ examples/
│  └─ m0/
├─ tests/
│  ├─ integration/
│  └─ e2e/
├─ docs/
└─ package.json
```

内部包名与职责：

| 包 | 职责 | 允许依赖 |
| --- | --- | --- |
| `@ice3/core` | 数学、场景节点、几何、材质、事件、诊断、类型 ID、序列化契约 | 无运行时依赖 |
| `@ice3/renderer` | RendererBackend 契约、能力查询、资源句柄、最小 WebGL2 后端 | `@ice3/core` |
| `@ice3/runtime` | Engine、帧循环、相机、2D/3D 图层、输入路由、选择状态 | `@ice3/core`、`@ice3/renderer` |
| `ice3` | 稳定公共入口和经过批准的重新导出 | 上述内部包 |

依赖方向固定为：

```text
@ice3/core
    ↑
@ice3/renderer
    ↑
@ice3/runtime
    ↑
ice3
```

`@ice3/core` 不得依赖 DOM、Canvas、WebGL、`@ice3/runtime` 或 `ice3`。内部包之间禁止循环依赖和私有路径穿透。

## 6. M0 公共 API

### 6.1 最小示例

```ts
import {
  ICE3,
  ICEPerspectiveCamera,
  ICEScene,
  ICEMesh,
  ICEBoxGeometry,
  ICEBasicMaterial,
  ICEScreenLayer,
  ICELabel,
  ICEOrbitController,
} from 'ice3';

const engine = new ICE3().init('stage');
const scene = new ICEScene({ id: 'scene-main' });
const camera = new ICEPerspectiveCamera({
  id: 'camera-main',
  fov: 45,
  near: 0.1,
  far: 1000,
  position: [4, 3, 6],
});

const block = new ICEMesh({
  id: 'demo-block',
  geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
  material: new ICEBasicMaterial({
    color: '#2f81f7',
    edgeColor: '#e6f2ff',
  }),
});
scene.addChild(block);

const hudLayer = new ICEScreenLayer({ id: 'screen-layer', order: 10 });
hudLayer.addChild(
  new ICELabel({
    id: 'hud-status',
    text: '运行',
    screenPosition: [24, 24],
    interactive: true,
  }),
);

new ICEOrbitController(engine, camera).start();

engine.setScene(scene);
engine.setCamera(camera);
engine.addLayer(hudLayer);
engine.start();
```

### 6.2 Engine 契约

`ICE3` 是 M0 的唯一公开引擎入口：

- `init(target)`：绑定任意 `HTMLElement`、Canvas 元素、选择器或已有上下文配置。
- `setScene(scene)`：设置唯一活动场景。
- `setCamera(camera)`：设置活动相机。
- `addLayer(layer)` / `removeLayer(layer)`：添加或移除 2D 图层。
- `start()` / `stop()`：控制渲染循环。
- `requestRender(reason?)`：请求一次按需渲染。
- `resize(width?, height?)`：响应容器或 DPR 变化。
- `project(worldPosition)`：返回视口内的屏幕坐标和可见性。
- `pick(screenPosition)`：返回统一语义对象引用。
- `getSelection()` / `setSelection(ids)`：读取或设置共享选择集。
- `getDiagnostics()`：返回资源、帧、图层和输入状态摘要。
- `destroy()`：幂等销毁所有资源。
- `on` / `off` / `once`：订阅引擎事件。

### 6.3 场景对象

M0 支持以下最小对象：

- `ICEScene`：场景根节点。
- `ICENode`：具有稳定 `id`、父子关系、变换、可见性和事件能力。
- `ICEMesh`：关联几何和材质的最小可渲染节点。
- `ICEPerspectiveCamera`：透视投影、位置和朝向。
- `ICEBoxGeometry`：M0 唯一内置几何。
- `ICEBasicMaterial`：无光照基础色材质，可选高对比几何边线颜色。

M0 节点身份规则：

- `id` 在场景内唯一。
- 重复 ID 产生结构化诊断并拒绝添加。
- 重命名或移动不改变 `id`。
- 2D 标注、选择集、事件和后端拾取都引用同一个 `id`。

### 6.4 2D 图层

M0 提供：

- `ICEWorldLayer`：子项锚定到场景节点 `anchorId`，每帧使用活动相机投影。
- `ICEScreenLayer`：子项使用视口屏幕坐标。
- `ICELabel`：最小 2D 文本对象，可配置位置、颜色、对齐和是否消费输入。

图层契约：

- 明确 `order`、`visible`、`interactive`、`passThrough` 和裁剪范围。
- 图层拥有稳定的 `hitTest` 和 `dispose` 生命周期。
- 2D 图层不能自行监听全局 DOM 事件；输入统一由 Engine 路由。

### 6.5 相机控制

`ICEOrbitController` 负责 M0 的旋转、缩放和键盘移动：

- 左键拖拽或单指拖拽旋转。
- 拖拽可从几何表面或空白区域开始。
- 滚轮或双指手势缩放。
- 旋转和缩放使用按帧阻尼，释放后平滑收敛。
- 按住 W/A/S/D 或对应方向键时，相机与观察目标在当前视平面内连续平移。
- W/S 与上下键行为一致，A/D 与左右键行为一致，均不改变观察距离或缩放比例。
- 键盘移动速度与观察距离成比例，释放按键后立即停止；窗口失焦时清除按键状态。
- 输入框、文本域、下拉框和可编辑元素保留正常键盘行为。
- 控制器与 2D 图层共享同一输入路由结果。
- 控制器遵守最小/最大距离，不修改场景节点状态。

## 7. 渲染后端契约

`@ice3/renderer` 对上层提供稳定且实现无关的接口：

```ts
interface ICERendererBackend {
  readonly capabilities: Readonly<ICERendererCapabilities>;
  initialize(options: ICERendererInitOptions): void;
  resize(viewport: ICEViewport, dpr: number): void;
  render(frame: ICEFrame): void;
  capture?(): Promise<Blob>;
  dispose(): void;
}
```

约束：

- Runtime 只依赖契约，不引用私有 WebGL 对象。
- Renderer 负责 WebGL2 能力检查、Context Loss 监听和资源销毁。
- M0 后端必须只创建一次 Canvas/Context，重复调用 `init` 产生稳定诊断。
- Renderer 不负责业务选择、告警或图层输入语义。
- 上下文丢失时 Engine 广播 `CONTEXT_LOST`，恢复成功后广播 `CONTEXT_RESTORED`。

## 8. 生命周期

标准生命周期：

```text
created
  → initialized
  → scene/camera/layers configured
  → running
  ↔ stopped
  → destroyed
```

规则：

- `init` 成功后进入 `initialized`；失败保持 `created` 并返回诊断。
- 未设置场景或相机时，`start` 不渲染，并产生 `ENGINE_NOT_READY` 诊断。
- `stop` 只停止帧请求，不释放场景和资源。
- `start` 可重复调用且幂等。
- `destroy` 停止所有帧、移除所有监听、释放后端和 2D 图层。
- `destroy` 后任何修改类调用返回 `ENGINE_DESTROYED` 或抛出对应 ICE 异常。
- 所有可释放对象都提供幂等 `dispose` / `destroy`。

## 9. 事件

M0 固定事件：

- `BEFORE_RENDER`
- `AFTER_RENDER`
- `RESIZE`
- `POINTER_DOWN`
- `POINTER_MOVE`
- `POINTER_UP`
- `WHEEL`
- `SELECTION_CHANGE`
- `CONTEXT_LOST`
- `CONTEXT_RESTORED`
- `DESTROY`

事件参数使用 ICE 事件对象。目标对象在可用时必须是场景节点或 2D 图层对象，而不是 WebGL 资源或内部代理。

## 10. 输入路由

输入按图层顺序从上到下执行：

1. `ICEScreenLayer`
2. `ICEWorldLayer`
3. 3D 场景拾取

规则：

- 2D 交互对象命中后停止向下传递。
- 2D 图层透明区域按 `passThrough` 决定是否继续。
- 指针按下后记录目标图层，拖拽期间保持指针捕获。
- 拖拽跨越 2D/3D 边界时，移动和抬起仍发送给原目标。
- `keydown` 和辅助技术事件只由 Engine 统一分发，图层不得重复注册。
- 相机控制只在所有可交互 2D 图层均放行后启动。

## 11. 坐标与对齐

- 世界坐标到屏幕坐标由活动相机和视口统一计算。
- 2D 与 3D 使用相同 CSS 尺寸、DPR 和裁剪范围。
- `worldPosition` 投影结果至少包含 `{ x, y, visible, depth }`。
- 世界锚定元素位于视锥外时为不可见，不强制钳制到屏幕边缘。
- M0 对齐目标是在支持的测试浏览器中误差不超过一个 CSS 像素。
- 位置更新与 3D 渲染使用同一帧快照，避免相机矩阵跨帧混用。

## 12. 序列化与诊断

### 12.1 序列化

M0 为场景节点、相机、基础几何、基础材质和 2D 标签订义 JSON 往返：

- 类型 ID 使用 `ice3:TypeName` 格式。
- 序列化包含 schema 版本。
- 反序列化遇到未知类型或损坏字段时返回结构化报告，并跳过无效子树。
- 场景对象恢复后保留稳定 `id`。

### 12.2 诊断

首版稳定错误码至少包括：

- `ICE3_INVALID_TARGET`
- `ICE3_WEBGL2_UNAVAILABLE`
- `ICE3_DUPLICATE_OBJECT_ID`
- `ICE3_UNKNOWN_ANCHOR`
- `ICE3_ENGINE_NOT_READY`
- `ICE3_ENGINE_DESTROYED`
- `ICE3_LAYER_ORDER_CONFLICT`
- `ICE3_CONTEXT_LOST`

诊断结构：

```ts
interface ICEDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}
```

诊断消息必须说明发生了什么以及可执行的修正方向，不只返回内部异常文本。

## 13. 示例场景

`examples/m0` 提供一个单页示例：

- 画布铺满示例容器。
- 3D 区域显示一个基础方块。
- 方块使用平光基础色和清晰几何边线。
- 左上角显示一个可点击的 2D 状态 HUD。
- 点击方块后高亮并广播选择变化。
- 点击 HUD 时不触发 3D 选择。
- 点击 HUD 外的透明区域可以继续选择 3D 物体。
- 提供销毁和重建按钮，用于验证生命周期。

示例不展示未列入 M0 的能力，不包含行业业务文案或竞品名称。

## 14. 测试策略

### 14.1 单元测试

- 向量、矩阵、变换和投影。
- 场景节点父子关系、ID 唯一性和释放。
- 事件 `on` / `off` / `once` 的同一函数引用语义。
- 序列化往返和未知类型处理。
- Layer 排序、命中顺序和透明穿透。
- Engine 生命周期、幂等启动和销毁。
- 输入按下后的目标锁定与跨层拖拽。

### 14.2 集成测试

- 使用测试渲染后端验证 Runtime 生成的帧内容。
- 验证 WebGL2 能力探测、Context Loss 和资源释放。
- 验证相机投影与 2D 世界锚点使用同一帧矩阵。
- 验证重复 ID 和未知锚点产生预期诊断。

### 14.3 浏览器测试

- 页面无控制台错误和未处理拒绝。
- 拖拽旋转、滚轮缩放有效。
- HUD 点击不会选中 3D 物体。
- HUD 透明区域点击能选中 3D 物体。
- 平光模型不同区域的基础色一致，边线清晰可见。
- 窗口 resize、DPR 变化、停止、销毁和重建后无重复事件及资源泄漏。
- 当前 Chromium 和 WebKit 测试环境均通过。

M0 的像素测试覆盖平光颜色、几何边线、3D 物体绘制和 HUD 可见性，避免因字体抗锯齿差异产生无意义失败。

## 15. 性能与可观测性

M0 不设置大规模场景指标，但必须提供基本计数：

- 每秒帧数。
- 每帧 CPU 时长。
- draw call 数量。
- 场景节点数量。
- 2D 图层数量和标签数量。
- 当前 DPR、画布尺寸和视口尺寸。
- WebGL Context Lost 次数。

引擎静止且无交互时应停止连续帧请求；相机移动、窗口变化、选择变化和显式 `requestRender` 必须恢复渲染。

## 16. 发布边界

M0 产物：

- ESM 模块。
- TypeScript 类型声明。
- 可运行浏览器示例。
- API 文档和诊断码列表。
- 真实浏览器测试结果。

M0 不发布到公共包仓库。只有规格评审、实施计划、测试门禁和 API 评审全部通过后，才讨论首个预览版本。

## 17. 后续演进

M0 完成后按顺序评估：

1. glTF 资产加载与资源生命周期。
2. 实例化、基础 LOD 和按需渲染。
3. 区域系统与空间查询。
4. 工业能力层接入。
5. WebGPU 后端可行性。

任何后续能力都必须先证明现有公共 API 无法通过扩展实现，才允许修改核心接口。

## 18. 验收清单

- [x] 公共示例只依赖 `ice3` 包。
- [x] 内部包依赖无循环、无私有路径穿透。
- [x] 自有名称、类型和事件符合 ICE 风格。
- [x] 2D/3D 对象共享稳定身份。
- [x] HUD、透明穿透和 3D 拾取顺序正确。
- [x] 世界锚点能力由公共 API 和自动化测试覆盖。
- [x] resize、DPR、Context Loss、销毁和重建稳定。
- [x] 单元、集成和 Chromium/WebKit 交互测试通过。
- [x] 文档、代码、注释和示例无竞品或厂商名称。

## Related Documents

- `ICE3-ENG-IDX-001` — [Documentation index](../README.md)
- `ICE3-ENG-PLAN-001` — [Engine M0 implementation](../plans/2026-10-27-engine-m0.md)
- `ICE3-ENG-API-001` — [M0 Public API](../api/m0.md)
