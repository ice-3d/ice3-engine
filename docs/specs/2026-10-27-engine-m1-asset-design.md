# ICE3 Engine M1 预编译 GLB 资产管线设计规格

> Document ID: ICE3-ENG-SPEC-002
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers
>

| 项目 | 内容 |
| --- | --- |
| 状态 | 已实现 |
| 版本 | 1.0 |
| 日期 | 2026-10-27 |
| 范围 | `ice3-engine` 的 M1 资产加载能力与 `ice3-toolchain` 的预处理基础 |
| 前置条件 | M0 已通过验收并合入 `main` |
| 核心约束 | 源格式解析和重转换在外置工具中完成，运行时只读取预处理 GLB 配置档 |

## 1. 目标

M1 建立一条面向工业场景的资产进入链路：

1. `ice3-toolchain` 读取源模型，完成验证和所有重型预处理。
2. 工具链输出符合 ICE3 Prepared GLB Profile v1 的标准 GLB 文件。
3. `ice3-engine` 运行时只读取该配置档，并把准备好的缓冲上传 GPU。
4. 运行时不得包含通用格式适配器，不得执行三角化、单位换算、网格合并、旋转换算或边线生成。
5. M1 结束时，浏览器示例能加载工具链处理过的工业设备模型，并继续使用平光和清晰几何边线。

采用标准 GLB 容器的原因是让预处理结果可被通用工具检查和处理，降低生态接入成本。ICE3 通过配置档约束而不是自定义二进制容器获得可预测的运行时行为。

## 2. 成功标准

M1 完成时：

- 工具链能把源模型转换为可被标准 GLB 工具打开和检查的文件。
- 输出包含 ICE3 配置档标记、稳定语义 ID、预处理统计和内容摘要。
- 同一输入和转换选项生成字节一致的 GLB。
- 运行时加载后可以渲染层级、局部矩阵、三角网格、基础色和预生成边线。
- 运行时能查询资产包围盒、节点数量、网格数量和三角形数量。
- 加载可以取消，失败返回稳定错误码，销毁后不保留场景、缓冲或 GPU 资源。
- WebGL 上下文丢失并恢复后，资产仍可重新上传和渲染。
- 公共消费者仍然只依赖 `ice3` 包。
- 架构测试可以证明运行时依赖图不包含源格式适配器或工具链实现。

## 3. 非目标

M1 不包含：

- 在浏览器运行时提供通用 glTF 兼容性。
- 在运行时执行三角化、旋转和单位换算、法线生成、网格合并、去重、边线生成或索引重建。
- 动画、骨骼、Morph、蒙皮、粒子和物理数据。
- 复杂 PBR、纹理、贴图解码、环境光照、阴影和后期处理。
- 实例化、LOD、流式分区、空间索引和碰撞。
- 业务点位、告警、工业语义或 Agent 专用接口。
- 全格式兼容。
- WebGPU 后端。
- 完整的带 UI 资产工具；M1 先交付可复用工具核心和 CLI。

## 4. 总体架构

```text
source model
      │
      ▼
ice3-toolchain
  source adapter
  validation
  normalization
  triangle preparation
  matrix baking
  edge generation
  deterministic GLB packing
      │
      ▼
ICE3 Prepared GLB Profile v1
      │
      ▼
ice3-engine runtime
  profile reader
  resource manager
  scene instantiation
  direct GPU upload
```

工程职责：

| 工程 | 职责 | 明确禁止 |
| --- | --- | --- |
| `ice3-toolchain` | 源格式适配、验证、全部重转换、GLB 生成、检查和 CLI | 进入浏览器运行时、包含业务界面、直接修改场景状态 |
| `@ice3/assets` | GLB 配置档契约、容器读取、约束校验和 TypedArray 视图创建 | 通用源格式兼容、网格转换、DOM 操作、GPU 上传 |
| `@ice3/core` | 通用几何、矩阵变换、场景和资产语义对象 | 文件访问、工具链依赖、浏览器 API |
| `@ice3/renderer` | 通用 GPU 几何资源和直接上传 | 源格式知识、单位转换、网格预处理 |
| `@ice3/runtime` | 下载、资产实例化、缓存、取消和生命周期 | 第二套格式管线、几何重建、业务逻辑 |
| `ice3` | 公共入口和经批准的资产 API | 暴露内部工具或私有路径 |

任何工程都不得从其他工程的私有源码目录直接导入代码。工具链和引擎通过 GLB 配置档规范和契约测试协作。

## 5. ICE3 Prepared GLB Profile v1 规范

### 5.1 容器约束

- 输出文件扩展名和容器均为 `.glb`。
- GLB 必须符合 glTF 2.0 二进制容器布局。
- 只允许一个 JSON 块和一个 BIN 块。
- 不允许外部 URI、图片、辅助数据文件或额外块。
- JSON 块使用 UTF-8 编码；BIN 块按规范对齐。
- 输出不压缩、不量化、不依赖需要运行时解码的扩展。
- `extensionsRequired` 必须为空；M1 不依赖任何 glTF 扩展完成核心加载。
- `buffers` 必须且只能有一个内嵌 BIN 块条目，不得包含 `uri`。
- `scene` 必须存在并指向唯一可加载的场景。
- 标准查看器应能读取基础层级、材质和几何；ICE3 专用语义只放在 `extras.ice3`。

### 5.2 必需标记

`asset.extras.ice3` 是 ICE3 配置档的识别入口：

```json
{
  "profile": "ice3-prepared",
  "profileVersion": "1.0",
  "assetId": "equipment-sample",
  "contentDigest": {
    "algorithm": "sha256",
    "value": "<binary-chunk-sha256>",
    "covers": "binary-chunk"
  },
  "coordinateSystem": {
    "handedness": "right",
    "upAxis": "y",
    "linearUnit": "meter"
  },
  "bounds": {
    "min": [0, 0, 0],
    "max": [1, 1, 1]
  },
  "stats": {
    "nodeCount": 1,
    "meshCount": 1,
    "triangleCount": 12,
    "edgeSegmentCount": 18
  }
}
```

运行时缺少 `profile`、`profileVersion` 或 `assetId` 时必须拒绝加载，并提示使用工具链处理源资产。

### 5.3 节点

- 每个语义节点必须在 `extras.ice3.id` 中提供稳定且唯一的 ID。
- 节点层级通过标准 `children` 表达。
- 每个节点必须使用标准 `matrix` 表示局部变换，长度固定为 16。
- M1 不接受节点 `translation`、`rotation`、`scale` 组合，避免运行时做四元数转换。
- 局部矩阵、世界矩阵和后续相机计算属于正常空间数学，不属于资产格式转换。
- 节点展示名称可使用标准 `name`，但语义身份始终使用 `extras.ice3.id`。

### 5.4 几何与图元

- 几何只允许标准三角形图元，`primitive.mode` 必须为 `4` 或省略并使用默认值。
- 每个三角形图元必须有 `POSITION` 和 `indices`。
- `POSITION` 访问器必须为非归一化 `FLOAT`、类型 `VEC3`。
- 索引访问器必须为非归一化 `UNSIGNED_SHORT` 或 `UNSIGNED_INT`、类型 `SCALAR`。
- 访问器必须紧排、支持直接创建 TypedArray 视图，并使用 `bufferView` 映射到唯一 BIN 块。
- `bufferView.byteStride` 必须省略；访问器偏移和缓冲视图偏移必须满足组件对齐要求。
- 访问器不得包含 `sparse`、`normalized: true` 或运行时重排需求。
- 所有索引值必须小于对应 `POSITION.count`。
- 不允许稀疏访问器、交错到无法直接上传的布局或运行时量化解码。
- 包围盒使用标准 `POSITION.min` 和 `POSITION.max`。

边线使用标准线图元表达：

- 边线 `primitive.mode` 必须为 `1`。
- 边线图元与对应三角形共享 `POSITION` 访问器。
- 边线有独立索引访问器，索引数量必须为偶数。
- 边线图元的 `extras.ice3.role` 必须为 `"edges"`。
- 边线宽度提示放在 `extras.ice3.widthPx`，M1 推荐值为 `3`。
- 边线不显示被模型遮挡的背面线段，由渲染器执行深度测试。

### 5.5 材质

- 使用标准材质的 `pbrMetallicRoughness.baseColorFactor`。
- M1 不读取纹理、法线贴图、金属度贴图或粗糙度贴图。
- 平光显示由 ICE3 材质策略决定，不从 GLB 光照字段推导。
- 边线图元使用独立材质，其基础色就是边线颜色。
- 每个材质必须有 `extras.ice3.id`。
- M1 不支持透明度混合；基础色 alpha 固定为 `1`。

### 5.6 明确禁止的内容

- `animations`、`skins` 和 Morph Targets。
- `cameras`、灯光、阴影或环境数据。
- `images`、`textures` 和 `samplers`。
- 稀疏访问器和需要运行时解码的压缩扩展；必需压缩可以在工具链输入阶段解码并展开。
- 外部 URI 或额外二进制文件。
- M1 未列出的可执行扩展。

遇到禁止内容时，工具链产生结构化报告；运行时遇到不符合配置档的文件时拒绝加载。

### 5.7 确定性

- 工具链输出 JSON 字段使用稳定顺序。
- 节点、网格、材质和几何 ID 由工具链确定性生成。
- 输出不包含时间戳、绝对路径或随机值。
- 相同输入、选项和工具版本必须生成相同 GLB 字节。
- `contentDigest.value` 是 BIN 块 SHA-256 的小写十六进制字符串。

## 6. 工具链

### 6.1 仓库边界

`ice3-toolchain` 是独立仓库，内部至少分为：

- `toolchain-core`：无 CLI 和 UI 依赖的转换流水线。
- `cli`：面向自动化和开发者的命令入口。
- `ui`：后续可复用的可视化入口；M1 只保留架构位置，不交付完整 UI。

`cli` 与未来的 `ui` 必须调用同一个 `toolchain-core`，不得复制转换逻辑。

### 6.2 M1 源格式

只支持 glTF 2.0 和 GLB：

- JSON 外置缓冲和二进制容器均可作为输入。
- 只导入网格、节点层级、局部变换和基础色。
- 输入阶段支持的必需网格压缩由工具链解码，输出阶段不得保留需要运行时解码的压缩。
- 未被材质引用的纹理、图像和采样器在工具链中清理；仍被材质引用的纹理暂不支持。
- 不支持的扩展、动画、蒙皮、Morph、相机和灯光产生结构化报告。
- 不静默丢弃影响几何结果的数据。
- M1 不承诺其他源格式；新增格式通过独立适配器加入。

### 6.3 流水线

1. 读取并验证源容器。
2. 解析节点、网格、图元和材质。
3. 检查循环层级、非法索引、缺失缓冲和不支持特性。
4. 统一单位和坐标，把每个节点的局部变换烘焙为标准 GLB 矩阵。
5. 只对非三角图元执行必要的三角化。
6. 生成稳定资产、节点、网格和材质 ID。
7. 生成几何及资产包围盒。
8. 按材质和可选择语义边界生成标准线图元边线。
9. 将运行时需要的缓冲连续排列并按 GLB 规范对齐。
10. 生成配置档清单、统计信息和内容摘要。
11. 回读生成结果，使用标准 GLB 校验和 ICE3 配置档校验双重检查。

转换必须是确定性的。相同输入、选项和工具版本必须生成相同字节输出。

### 6.4 CLI 契约

M1 至少提供：

```text
ice3-tool inspect <source>
ice3-tool build <source> --output <file.glb>
ice3-tool validate <file.glb>
```

- `inspect` 输出节点、三角形、材质、边线、包围盒、不支持项和预计输出。
- `build` 失败时不留下部分输出文件。
- `build` 允许通过 `--asset-id` 固定资产身份；省略时使用输出文件名的规范化结果。
- `validate` 同时检查标准 GLB 结构、ICE3 配置档约束、索引范围和引用关系。
- 命令支持机器可读 JSON 输出。
- 非零退出码表示转换或验证失败。

## 7. 引擎资产层

新增内部包 `@ice3/assets`：

- 只依赖标准 JavaScript 能力和 `@ice3/core` 的公共类型。
- 读取 GLB 头和 JSON/BIN 块，执行 ICE3 配置档约束校验。
- 返回不可变资产快照和不复制大块二进制数据的 TypedArray 视图。
- 把标准访问器映射为通用 ICE 几何描述。
- 不创建 DOM、Canvas、WebGL 或 GPU 对象。
- 不包含源格式适配器和工具链依赖。

核心几何从盒体特例扩展为通用索引几何，同时保留 `ICEBoxGeometry` 作为便捷几何。`ICEMesh` 接收通用几何公共契约，拾取、包围盒和序列化统一使用该契约。

核心场景节点增加局部矩阵输入能力，使预处理 GLB 中烘焙好的矩阵可以直接进入世界矩阵计算，不在运行时反解旋转。

渲染后端按几何资源标识创建和释放 GPU 缓冲。资产中的位置、三角形索引和边线索引直接上传，不在 Renderer 内重新排列或生成数据。

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
- 完整性摘要校验默认可关闭；启用时允许一次 BIN 块线性扫描，但不得成为默认加载路径。

## 9. 错误和诊断

M1 至少定义以下稳定运行时错误码：

| 错误码 | 触发条件 | 调用方动作 |
| --- | --- | --- |
| `ICE3_ASSET_FETCH_FAILED` | 网络请求失败 | 检查 URL、网络和权限 |
| `ICE3_ASSET_INVALID_GLB` | GLB 头、块长度、JSON 或 BIN 块非法 | 使用工具链重新生成资产 |
| `ICE3_ASSET_PROFILE_UNSUPPORTED` | 缺少 ICE3 配置档标记或版本不受支持 | 使用工具链处理源资产 |
| `ICE3_ASSET_ACCESSOR_INVALID` | 访问器类型、布局或范围不符合配置档 | 使用工具链重新生成资产 |
| `ICE3_ASSET_UNSUPPORTED_FEATURE` | 资产包含动画、纹理等 M1 禁止内容 | 重新导出 M1 支持的子集 |
| `ICE3_ASSET_DUPLICATE_ID` | 节点、网格或材质身份冲突 | 重新生成确定性 ID |
| `ICE3_ASSET_ABORTED` | 加载被 `AbortSignal` 取消 | 不需要重试，除非调用方重新发起 |

工具链诊断使用独立的 `ICE3_TOOL_*` 前缀，不把源格式内部异常直接暴露为运行时错误。

## 10. 性能约束

- 运行时不得调用通用源格式适配器。
- 运行时不得在加载阶段执行三角化、单位转换、四元数或矩阵转换、法线或边线生成、网格合并或顶点重建。
- GLB 读取器只做块定位、JSON 解析、配置档校验和访问器视图创建。
- 几何、三角形索引和边线索引必须尽量零拷贝。
- GPU 上传是唯一允许的大块数据处理路径。
- 资产加载不得产生持续逐帧工作。
- 诊断记录抓取、校验、实例化和 GPU 上传耗时，用于后续设置预算。
- M1 不以固定毫秒阈值作为唯一验收，但架构测试必须证明重型转换路径不存在于运行时。

## 11. 测试策略

### 11.1 配置档契约

- 工具链产物通过标准 GLB 结构校验。
- 配置档必需标记、节点 ID、局部矩阵和统计信息完整。
- 同一源资产重复构建得到完全相同的 GLB 字节和内容摘要。
- 工具链产出的版本化测试资产能被引擎读取器直接加载。
- 非 ICE3 配置档 GLB、非法块、错误访问器和禁止内容被拒绝。
- 资产截断和随机字节损坏不会导致越界访问。

### 11.2 工具链

- glTF 与 GLB 的节点层级、局部矩阵和基础色正确转换。
- 非三角图元在工具链阶段完成必要三角化。
- 包围盒、边线图元和内容摘要正确生成。
- 不支持特性产生结构化报告和非零退出码。
- `build` 失败不留下部分文件。
- inspect、build、validate 的 JSON 输出稳定。

### 11.3 引擎

- 通用几何契约支持盒体和 GLB 资产几何。
- GLB 读取器只接受 ICE3 配置档，不包含通用 glTF 兼容路径。
- 局部矩阵直接进入场景世界矩阵计算。
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
- `@ice3/assets` 不包含源模型适配器。
- `@ice3/renderer` 不导入资产源处理模块。
- `@ice3/runtime` 不导入 `ice3-toolchain`。
- `ice3` 只重新导出批准的读取和资源 API。
- `ice3-toolchain` 无法通过私有路径导入引擎包内部源码。

## 13. 验收场景

M1 使用一个小型设备模型作为端到端样板：

1. 工具链把源模型预编译为 ICE3 Prepared GLB。
2. 工具链 `validate` 和 `inspect` 通过。
3. 引擎示例从静态地址加载该 GLB。
4. 模型层级、尺寸、基础色和边线在浏览器中正确呈现。
5. 用户拾取模型并旋转、缩放，结果与 M0 交互一致。
6. 重复加载、取消加载、销毁和重建均无资源泄漏。
7. 普通未处理 GLB 或损坏 GLB 返回稳定诊断，页面不白屏。

样板模型必须能由仓库测试夹具生成，避免依赖不受控的外部下载。

## 14. 交付顺序

1. 冻结 ICE3 Prepared GLB Profile v1 和契约测试夹具。
2. 在 `ice3-toolchain` 实现转换核心、CLI 和首个源格式适配器。
3. 在 `ice3-engine` 实现配置档读取器、通用几何和 GPU 资源缓存。
4. 实现运行时加载器、取消、缓存和释放。
5. 用工具链生成的样板模型替换示例中的程序化方块。
6. 完成跨仓库兼容性、浏览器和资源泄漏验证。

## 15. 后续演进

M1 完成后按顺序评估：

1. 预编译阶段的实例化、批处理和基础 LOD。
2. 外部工具的高级几何优化和资产分析。
3. 区域系统与空间查询。
4. 基础材质能力，仅在工业语义明确需要时引入。
5. 工业能力层和通用 Agent 调用接口。

任何新增运行时能力都必须继续遵循“源格式转换在外置工具完成”的约束。

## 关联文档

- `ICE3-ENG-IDX-001` — [文档索引](../README.md)
- `ICE3-ENG-PLAN-002` — [Asset Runtime 实施计划](../plans/2026-10-27-engine-m1-asset-runtime.md)
- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
