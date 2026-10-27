# ICE3 Engine M1 资产管线设计规格

| 项目 | 内容 |
| --- | --- |
| 状态 | 等待用户评审 |
| 版本 | 0.1 |
| 日期 | 2026-10-27 |
| 范围 | `ice3-engine` 的 M1 资产加载能力与 `ice3-toolchain` 的预处理基础 |
| 前置条件 | M0 已通过验收并合入 `main` |
| 核心约束 | 源格式解析和重转换在外置工具中完成，运行时只读取预编译资产 |

## 1. 目标

M1 建立一条面向工业场景的资产进入链路：

1. `ice3-toolchain` 读取当前通用源模型格式，完成验证和所有重型预处理。
2. 工具链输出确定性的 ICE3 预编译资产包 `.ice3b`。
3. `ice3-engine` 运行时只读取资产包、创建场景对象并把准备好的缓冲上传 GPU。
4. 运行时不得包含第二套几何转换路径，不得进行三角化、单位换算、网格合并或批量重建。
5. M1 结束时，浏览器示例能加载一个工具链生成的工业设备模型，并继续使用平光和清晰几何边线。

## 2. 成功标准

M1 完成时：

- 工具链能把 glTF 2.0 或 GLB 源模型转换为 `.ice3b`。
- 同一输入和转换选项生成字节一致的资产包，并生成内容摘要。
- 运行时加载同一个 `.ice3b` 后可以渲染层级、ICE 风格局部变换、三角网格、基础色和预生成边线。
- 运行时能查询资产包围盒、节点数量、三角形数量和加载诊断。
- 加载可以取消，失败返回稳定错误码，销毁后不保留场景、缓冲或 GPU 资源。
- WebGL 上下文丢失并恢复后，资产仍可重新上传和渲染。
- 公共消费者仍然只依赖 `ice3` 包。
- 架构测试可以证明运行时依赖图不包含源格式解析器或工具链实现。

## 3. 非目标

M1 不包含：

- 在浏览器运行时直接解析 glTF、GLB 或其他源模型格式。
- 在运行时执行三角化、旋转和单位换算、法线生成、网格合并、去重、边线生成或索引重建。
- 动画、骨骼、Morph、蒙皮、粒子和物理数据。
- 复杂 PBR、材质纹理、贴图解码、环境光照、阴影和后期处理。
- 实例化、LOD、流式分区、空间索引和碰撞。
- 业务点位、告警、工业语义或 Agent 专用接口。
- 全格式兼容。
- WebGPU 后端。
- 完整的带 UI 资产工具；M1 先交付可复用工具核心和 CLI。

## 4. 总体架构

```text
glTF 2.0 / GLB
      │
      ▼
ice3-toolchain
  source adapter
  validation
  normalization
  triangle preparation
  edge and bounds generation
  deterministic packing
      │
      ▼
ICE3 Prepared Asset Bundle (.ice3b)
  header + JSON manifest + binary buffers
      │
      ▼
ice3-engine runtime
  bundle reader
  resource manager
  scene instantiation
  direct GPU upload
```

工程职责：

| 工程 | 职责 | 明确禁止 |
| --- | --- | --- |
| `ice3-toolchain` | 源格式适配、验证、全部重转换、资产包生成、检查和 CLI | 进入浏览器运行时、包含业务界面、直接修改场景状态 |
| `@ice3/assets` | 资产包格式契约、读取、边界校验和轻量解码 | 源格式解析、网格转换、DOM 操作、GPU 上传 |
| `@ice3/core` | 通用几何、场景和资产语义对象 | 文件访问、工具链依赖、浏览器 API |
| `@ice3/renderer` | 通用 GPU 几何资源和直接上传 | 源格式知识、单位转换、网格预处理 |
| `@ice3/runtime` | 下载、资产实例化、缓存、取消和生命周期 | 第二套源格式管线、几何重建、业务逻辑 |
| `ice3` | 公共入口和经批准的资产 API | 暴露内部工具或私有路径 |

任何工程都不得从其他工程的私有源码目录直接导入代码。工具链和引擎通过版本化资产格式及契约测试协作。

## 5. 预编译资产包

### 5.1 文件和版本

- 文件扩展名：`.ice3b`。
- M1 格式版本：`1.0`。
- 所有多字节数值使用小端序。
- 文件由固定头、UTF-8 JSON 清单和连续二进制段组成。
- M1 不使用需要运行时解压的压缩格式。

固定头为 24 字节：

| 偏移 | 类型 | 内容 |
| --- | --- | --- |
| 0 | 8 字节 ASCII | `ICE3BNDL` |
| 8 | `uint16` | 主版本，M1 为 `1` |
| 10 | `uint16` | 次版本，M1 为 `0` |
| 12 | `uint32` | 标志位，M1 必须为 `0` |
| 16 | `uint32` | 清单字节长度 |
| 20 | `uint32` | 二进制段字节长度 |

清单从偏移 24 开始。清单结束后使用零字节填充到第一个 4 字节边界，二进制段从该边界开始。所有 `bufferView.offset` 相对二进制段起点，并必须 4 字节对齐。`bufferView.length` 必须严格等于组件字节数 × `components` × `count`。

读取器必须拒绝：

- 错误魔数。
- 不支持的主版本。
- 越界的清单或二进制长度。
- 非对齐的缓冲视图。
- 超出二进制段的读写范围。

### 5.2 清单结构

清单至少包含：

```ts
interface ICEAssetManifest {
  readonly schemaVersion: '1.0';
  readonly asset: {
    readonly id: string;
    readonly name: string;
    readonly contentHash: {
      readonly algorithm: 'sha256';
      readonly value: string;
      readonly covers: 'binary';
    };
  };
  readonly coordinateSystem: {
    readonly handedness: 'right';
    readonly upAxis: 'y';
    readonly linearUnit: 'meter';
    readonly unitScale: 1;
  };
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly nodes: readonly ICEAssetNode[];
  readonly geometries: readonly ICEAssetGeometry[];
  readonly materials: readonly ICEAssetMaterial[];
  readonly meshes: readonly ICEAssetMesh[];
}
```

节点定义：

```ts
interface ICEAssetNode {
  readonly id: string;
  readonly name?: string;
  readonly parent: number | null;
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly visible: boolean;
}
```

几何定义：

```ts
interface ICEAssetGeometry {
  readonly id: string;
  readonly positions: ICEBufferView;
  readonly indices: ICEBufferView;
  readonly indexType: 'uint16' | 'uint32';
  readonly edges?: ICEBufferView;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}
```

网格和材质定义：

```ts
interface ICEAssetMesh {
  readonly id: string;
  readonly node: number;
  readonly geometry: number;
  readonly material: number;
}

interface ICEAssetMaterial {
  readonly id: string;
  readonly baseColor: string;
  readonly edgeColor?: string;
}
```

缓冲视图定义：

```ts
interface ICEBufferView {
  readonly offset: number;
  readonly length: number;
  readonly componentType: 'float32' | 'uint16' | 'uint32';
  readonly components: 1 | 2 | 3 | 4;
  readonly count: number;
}
```

M1 只允许三角网格。位置必须为 `float32[3]`，索引只能为 `uint16` 或 `uint32`，索引数量必须是 3 的倍数；边线索引与几何索引使用同一索引类型，数量必须是 2 的倍数。

### 5.3 数据与显示约定

- 工具链统一输出右手坐标系、Y 轴向上、米制单位。
- `unitScale` 在 M1 中固定为 `1`；源单位换算在工具链阶段完成。
- 源模型的局部变换必须在工具链阶段转换为 ICE3 当前的位移、XYZ 欧拉角和缩放表示，运行时不再转换四元数或矩阵。
- 材质使用十六进制基础色和可选边线颜色。
- 边线索引、几何包围盒和资产总包围盒由工具链预生成。
- 节点 ID 由工具链确定性生成，不依赖运行时随机值。
- 清单中允许 `name` 作为展示信息，但语义身份始终使用 `id`。
- `contentHash.value` 是二进制段 SHA-256 的小写十六进制字符串。
- 读取器返回 TypedArray 视图，不为每个属性重新复制整个二进制段。

## 6. 工具链

### 6.1 仓库边界

`ice3-toolchain` 是独立仓库，内部至少分为：

- `toolchain-core`：无 CLI 和 UI 依赖的转换流水线。
- `cli`：面向自动化和开发者的命令入口。
- `ui`：后续可复用的可视化入口；M1 只保留架构位置，不交付完整 UI。

`cli` 与未来的 `ui` 必须调用同一个 `toolchain-core`，不得复制转换逻辑。

### 6.2 M1 源格式

只支持 glTF 2.0 和 GLB：

- JSON 外置缓冲和二进制容器均支持。
- 只导入三角图元、节点层级、局部变换和基础色。
- 不支持的扩展、动画、蒙皮、Morph、相机和灯光产生结构化报告。
- 不静默丢弃影响几何结果的数据。
- M1 不承诺其他源格式；新增格式通过独立适配器加入。

### 6.3 流水线

1. 读取并验证源容器。
2. 解析节点、网格、图元和材质。
3. 检查循环层级、非法索引、缺失缓冲和不支持特性。
4. 按选项统一单位、坐标和根变换，并把旋转换算为 ICE3 欧拉角。
5. 只对非三角图元执行必要的三角化。
6. 生成稳定资产、节点和几何 ID。
7. 生成几何及资产包围盒。
8. 按材质和可选择语义边界生成边线索引。
9. 将运行时需要的缓冲连续排列并按 4 字节对齐。
10. 生成清单、内容摘要和 `.ice3b`。
11. 回读生成结果并执行结构校验。

转换必须是确定性的。相同输入、选项和工具版本必须生成相同字节输出。

### 6.4 CLI 契约

M1 至少提供：

```text
ice3-tool inspect <source>
ice3-tool build <source> --output <file.ice3b>
ice3-tool validate <file.ice3b>
```

- `inspect` 输出节点、三角形、材质、边线、包围盒、不支持项和预计输出。
- `build` 失败时不留下部分输出文件。
- `build` 允许通过 `--asset-id` 固定资产身份；省略时使用输出文件名的规范化结果。
- `validate` 检查版本、缓冲边界、索引范围、引用关系和清单一致性。
- 命令支持机器可读 JSON 输出。
- 非零退出码表示转换或验证失败。

## 7. 引擎资产层

新增内部包 `@ice3/assets`：

- 只依赖标准 JavaScript 能力和 `@ice3/core` 的公共类型。
- 读取 `.ice3b`，执行轻量边界与引用校验。
- 返回不可变资产快照和不复制大块二进制数据的 TypedArray 视图。
- 不创建 DOM、Canvas、WebGL 或 GPU 对象。
- 不包含源格式解析器和工具链依赖。

核心几何从“盒体特例”扩展为通用索引几何，同时保留 `ICEBoxGeometry` 作为便捷几何。`ICEMesh` 接收通用几何公共契约，拾取、包围盒和序列化统一使用该契约。

渲染后端按几何资源标识创建和释放 GPU 缓冲。资产包中的位置、索引和边线视图直接上传，不在 Renderer 内重新排列或生成数据。

## 8. 运行时加载与资源生命周期

公共 API 提供显式资产加载器，概念接口如下：

```ts
class ICEAssetLoader {
  constructor(engine: ICE3);
  load(url: string, options?: ICEAssetLoadOptions): Promise<ICEAssetHandle>;
}

interface ICEAssetLoadOptions {
  readonly signal?: AbortSignal;
  readonly verifyIntegrity?: boolean;
}

interface ICEAssetHandle {
  readonly id: string;
  readonly scene: ICEScene;
  readonly stats: Readonly<{
    nodeCount: number;
    meshCount: number;
    triangleCount: number;
  }>;
  readonly bounds: Readonly<{
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  }>;
  dispose(): void;
}
```

加载状态：

```text
idle → fetching → validating → instantiating → ready
                      │             │
                      ├─────────────┴→ failed
                      └──────────────→ aborted
ready → disposed
```

规则：

- 网络抓取、清单解析和场景实例化均为异步。
- 同一 URL 的并发加载共享不可变解码结果，但每次 `load` 返回独立场景实例。
- `AbortSignal` 可取消未完成加载。
- `dispose` 幂等，释放场景节点、资产引用和对应 GPU 资源引用。
- 缓存只保存不可变资产数据；不缓存已销毁的场景对象。
- 场景销毁时先解除资产引用，再由渲染资源管理器回收无引用 GPU 缓冲。
- 上下文恢复后从不可变资产数据重新上传必要缓冲，不重新执行源格式转换。
- 完整性摘要校验默认可关闭；启用时允许一次线性扫描，但不得成为默认加载路径。

## 9. 错误和诊断

M1 至少定义以下稳定运行时错误码：

| 错误码 | 触发条件 | 调用方动作 |
| --- | --- | --- |
| `ICE3_ASSET_FETCH_FAILED` | 网络请求失败 | 检查 URL、网络和权限 |
| `ICE3_ASSET_INVALID_BUNDLE` | 魔数、头、清单或缓冲边界非法 | 重新运行工具链生成资产 |
| `ICE3_ASSET_VERSION_UNSUPPORTED` | 主版本不受支持 | 使用兼容版本或升级引擎 |
| `ICE3_ASSET_BUFFER_OUT_OF_RANGE` | 缓冲视图越界或对齐错误 | 重新生成资产包 |
| `ICE3_ASSET_UNSUPPORTED_FEATURE` | 资产包含 M1 不支持的语义 | 使用 M1 支持的子集重新导出 |
| `ICE3_ASSET_DUPLICATE_ID` | 节点、网格或材质身份冲突 | 重新生成确定性 ID |
| `ICE3_ASSET_ABORTED` | 加载被 `AbortSignal` 取消 | 不需要重试，除非调用方重新发起 |
| `ICE3_ASSET_DISPOSED` | 已释放句柄被继续使用 | 重新加载资产 |

工具链诊断使用独立的 `ICE3_TOOL_*` 前缀，不把源格式内部异常直接暴露为运行时错误。

## 10. 性能约束

- 运行时不得调用源格式解析器。
- 运行时不得在加载阶段执行三角化、单位转换、法线或边线生成、网格合并或顶点重建。
- 读取器只做头、清单、偏移和引用关系的轻量校验。
- 几何和边线视图尽量零拷贝。
- GPU 上传是唯一允许的大块数据处理路径。
- 资产加载不得产生持续逐帧工作。
- 诊断记录抓取、校验、实例化和 GPU 上传耗时，用于后续设置预算。
- M1 不以固定毫秒阈值作为唯一验收，但架构测试必须证明重型变换路径不存在于运行时。

## 11. 测试策略

### 11.1 格式契约

- 同一源资产重复构建得到完全相同的字节和摘要。
- 工具链产出的版本化测试资产能被引擎读取器直接加载。
- 非法魔数、版本、偏移、索引、引用和长度都被拒绝。
- 资产包截断和随机字节损坏不会导致越界访问。

### 11.2 工具链

- glTF 与 GLB 的节点层级、变换和基础色正确转换。
- 非三角图元在工具链阶段完成必要三角化。
- 包围盒、边线和内容摘要正确生成。
- 不支持特性产生结构化报告和非零退出码。
- `build` 失败不留下部分文件。
- inspect、build、validate 的 JSON 输出稳定。

### 11.3 引擎

- 通用几何契约支持盒体和资产几何。
- 加载器只读取预编译资产，不导入源格式解析模块。
- 并发加载、缓存、取消和释放行为正确。
- 资源引用归零后 GPU 缓冲被释放。
- 上下文恢复后从资产数据重新上传。
- 序列化保持稳定节点 ID 和材质边线颜色。

### 11.4 浏览器

- 示例通过运行时加载工具链生成的模型并完成绘制。
- 模型保持平光、基础色和预生成边线。
- 模型可拾取、可旋转、可缩放。
- 加载、销毁和重建后无监听器、帧请求或 GPU 资源泄漏。
- Chromium 与 WebKit 通过相同验收测试。

## 12. 架构约束测试

架构测试必须检查：

- `@ice3/core` 无 DOM、GPU、文件系统或工具链依赖。
- `@ice3/assets` 不包含源格式适配器。
- `@ice3/renderer` 不导入 `@ice3/assets` 的源处理模块。
- `@ice3/runtime` 不导入 `ice3-toolchain`。
- `ice3` 只重新导出批准的读取和资源 API。
- `ice3-toolchain` 无法通过私有路径导入引擎包内部源码。

## 13. 验收场景

M1 使用一个小型设备模型作为端到端样板：

1. 工具链把源模型构建为 `.ice3b`。
2. 工具链 `validate` 和 `inspect` 通过。
3. 引擎示例从静态地址加载资产包。
4. 模型层级、尺寸、基础色和边线在浏览器中正确呈现。
5. 用户拾取模型并旋转、缩放，结果与 M0 交互一致。
6. 重复加载、取消加载、销毁和重建均无资源泄漏。
7. 故意破坏资产包时返回稳定诊断，页面不白屏。

样板模型必须能由仓库测试夹具生成，避免依赖不受控的外部下载。

## 14. 交付顺序

1. 冻结 `.ice3b` 1.0 格式和契约测试夹具。
2. 在 `ice3-toolchain` 实现转换核心、CLI 和首个源格式适配器。
3. 在 `ice3-engine` 实现资产读取器、通用几何和 GPU 资源缓存。
4. 实现运行时加载器、取消、缓存和释放。
5. 用工具链生成的样板模型替换示例中的程序化方块。
6. 完成跨仓库兼容性、浏览器和资源泄漏验证。

## 15. 后续演进

M1 完成后按顺序评估：

1. 预编译阶段的实例化、批处理和基础 LOD。
2. 外部工具的高级几何优化和资产分析。
3. 区域系统与空间查询。
4. 基础纹理和材质能力，仅在工业语义明确需要时引入。
5. 工业能力层和通用 Agent 调用接口。

任何新增运行时格式都必须继续遵循“源格式转换在外置工具完成”的约束。
