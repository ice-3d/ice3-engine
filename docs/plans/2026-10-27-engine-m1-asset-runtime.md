# ICE3 Engine M1 资产 Runtime 实施计划

> Document ID: ICE3-ENG-PLAN-002
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers

> **面向代理工作者的说明：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项实施本计划。使用复选框（`- [ ]`）跟踪进度。

**目标：** 在浏览器中加载 ICE3 Prepared GLB Profile v1 资产，不经过源格式或几何转换管线，渲染已准备的三角形和边缓冲区，并安全释放其资源。

**架构：** 添加窄范围的 `@ice3/assets` profile 读取器，泛化核心几何和节点变换，以缓存的索引几何缓冲区替换仅支持盒体的 GPU 存储，并在其上添加 runtime 资产加载器。加载器仅消费由 `ice3-toolchain` 生成且带 profile 标记的 GLB。

**技术栈：** Node.js 24.22.1 LTS、TypeScript 7、ESM、Webpack 5、Node.js 内置测试运行器、`expect`、`tsx`、Playwright 1.64、原生 WebGL2。

**规范：** `docs/specs/2026-10-27-engine-m1-asset-design.md`

**前置计划：** [ICE3 Toolchain M1 GLB Pipeline Plan](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/plans/2026-10-27-toolchain-m1-glb-pipeline.md)

## 全局约束

- 公共消费方只从 `ice3` 导入。
- `@ice3/core` 不依赖 DOM、Canvas、GPU、文件系统和同级包。
- 依赖方向变为 `@ice3/core` ← `@ice3/assets` ← `@ice3/runtime`，渲染器仍仅依赖 core。
- Runtime 仅接受 ICE3 Prepared GLB Profile v1。
- Runtime 不执行源格式适配、三角化、单位转换、矩阵分解、网格合并或边生成。
- profile 中允许一个 JSON chunk 和一个 BIN chunk。
- 作业仅使用 `matrix`；runtime 不转换四元数 TRS。
- 外观保持平面；导入的材质使用基础色和可选边色。
- 动画、蒙皮、Morph targets、纹理、图像、相机、灯光、稀疏 accessor 和必需扩展均被拒绝。
- 上下文丢失、中止、重复 ID、格式错误的偏移和销毁必须产生确定性诊断。
- 浏览器矩阵为 Chromium 和 WebKit。Firefox 仍被排除。
- 每项行为变化遵循 RED-GREEN-REFACTOR，并且仅在合入 `main` 前执行 `npm run verify`。

## 审查重点

- GLB profile 具有有效头部，但某个 accessor 超出 BIN chunk：加载失败，且不发生类型化数组越界访问。
- 已加载资产节点同时具有来自外部工具的矩阵以及四元数 position/rotation 字段：矩阵身份优先，且不进行转换。
- 三角形 primitive 还具有用于边的 line primitive：二者成为一个 ICE mesh，并使用已准备的三角形索引和边索引。
- 两个已加载资产并发复用同一 URL：它们共享不可变字节，但暴露各自独立的场景对象。
- fetch 期间触发 `AbortSignal`：该请求不残留场景、缓存条目或 GPU 上传。
- `dispose()` 被调用两次：场景清理和渲染器引用被恰好释放一次。

---

## 文件结构

```text
packages/
├─ core/src/geometry/ICEGeometry.ts
├─ core/src/geometry/ICEIndexedGeometry.ts
├─ core/src/scene/ICENode.ts              local matrix support
├─ core/src/scene/ICEMesh.ts              generic geometry support
├─ assets/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts
│     ├─ ICEPreparedGLB.ts                profile and asset snapshot types
│     ├─ ICEGLBReader.ts                  GLB framing and view creation
│     └─ ICEProfileValidator.ts           strict profile validation
├─ renderer/src/
│  ├─ WebGL2GeometryBatch.ts              generic renderable collection
│  ├─ WebGL2GeometryCache.ts              dynamic per-geometry buffers
│  ├─ WebGL2Program.ts                    position-only flat shader
│  └─ WebGL2RendererBackend.ts            triangle and edge draws
├─ runtime/src/asset/
│  ├─ ICEAssetLoader.ts                   URL fetch, cache, abort, handles
│  └─ ICEAssetSceneBuilder.ts             snapshot-to-scene conversion
├─ runtime/src/index.ts                   export asset API
└─ ice3/src/index.ts                      public exports

examples/m1/                              loaded-asset browser example
tests/e2e/m1.spec.ts                      model rendering, pick, disposal
tests/fixtures/prepared-cube.glb           toolchain contract fixture
docs/api/m1.md                            public asset loading contract
docs/diagnostics.md                       new asset diagnostics
```

### 任务 1：在保留盒体渲染的同时泛化几何

**文件：**
- 创建：`packages/core/src/geometry/ICEGeometry.ts`
- 创建：`packages/core/src/geometry/ICEIndexedGeometry.ts`
- 修改：`packages/core/src/geometry/ICEBoxGeometry.ts`
- 修改：`packages/core/src/scene/ICEMesh.ts`
- 修改：`packages/core/src/index.ts`
- 创建：`packages/core/tests/IndexedGeometry.test.ts`
- 修改：`packages/core/tests/Scene.test.ts`
- 修改：`packages/renderer/src/WebGL2BoxBatch.ts`
- 修改：`packages/renderer/tests/WebGL2BoxBatch.test.ts`

**接口：**

```ts
export interface ICEGeometryBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ICEGeometry {
  readonly typeId: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  getBounds(): ICEGeometryBounds;
  toJSON(): Record<string, unknown>;
}

export class ICEIndexedGeometry implements ICEGeometry {
  constructor(options: {
    readonly id: string;
    readonly positions: Float32Array;
    readonly indices: Uint16Array | Uint32Array;
    readonly edgeIndices?: Uint16Array | Uint32Array;
  });
}
```

- [ ] **步骤 1：编写预期失败的索引几何测试**

```ts
it('derives bounds and rejects invalid indices', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'triangle',
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });

  expect(geometry.getBounds()).toEqual({
    min: [0, 0, 0],
    max: [2, 3, 0],
  });
  expect(() => new ICEIndexedGeometry({
    id: 'broken',
    positions: geometry.positions,
    indices: new Uint16Array([0, 1, 3]),
  })).toThrow(/index/i);
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/core/tests/IndexedGeometry.test.ts`

预期：FAIL，因为 `ICEIndexedGeometry` 不存在。

- [ ] **步骤 3：实现通用几何契约**

`ICEBoxGeometry` 实现 `ICEGeometry`，使用 `Float32Array`、`Uint16Array` 和由 `@ice3/core` 拥有的模块级共享边索引常量。`ICEMesh` 接受 `ICEGeometry`，而非 `ICEBoxGeometry`。

- [ ] **步骤 4：更新场景和可渲染项测试**

添加一个测试：创建 `ICEMesh`，并使用 `ICEIndexedGeometry`。将旧的盒体批处理测试替换为：

```ts
it('collects both box and indexed geometry meshes', () => {
  const renderables = collectRenderables(scene);
  expect(renderables.map((item) => item.mesh.geometry.typeId)).toEqual([
    'ice3:BoxGeometry',
    'ice3:IndexedGeometry',
  ]);
});
```

- [ ] **步骤 5：运行聚焦测试**

运行：

```bash
npm test -- packages/core/tests/IndexedGeometry.test.ts \
  packages/core/tests/Scene.test.ts \
  packages/renderer/tests/WebGL2BoxBatch.test.ts
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add packages/core packages/renderer
git commit -m "feat(core): add general indexed geometry"
```

### 任务 2：添加矩阵原生的局部节点变换

**文件：**
- 修改：`packages/core/src/scene/ICENode.ts`
- 修改：`packages/core/tests/Scene.test.ts`
- 修改：`packages/core/tests/Serialization.test.ts`

**接口：**

```ts
export type ICEMatrix4Tuple = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface ICENodeOptions {
  readonly id: string;
  readonly position?: ICEVector3Tuple;
  readonly rotation?: ICEVector3Tuple;
  readonly scale?: ICEVector3Tuple;
  readonly matrix?: ICEMatrix4Tuple;
}

setLocalMatrix(matrix: ICEMatrix4Tuple): this;
clearLocalMatrix(): this;
```

- [ ] **步骤 1：编写预期失败的矩阵变换测试**

```ts
it('uses a supplied local matrix without decomposing it', () => {
  const node = new ICENode({
    id: 'asset-node',
    position: [99, 99, 99],
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 4, 1,
    ],
  });

  expect(node.getWorldPosition().toArray()).toEqual([2, 3, 4]);
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/core/tests/Scene.test.ts`

预期：FAIL，因为不支持 `matrix`。

- [ ] **步骤 3：实现矩阵覆盖**

存储一个包含 16 个元素的 `Float32Array` 覆盖值。存在覆盖值时，`localMatrix()` 复制该值；否则使用现有 XYZ 欧拉组合。仅当覆盖值存在时，`toJSON()` 才包含 `matrix`。`setLocalMatrix` 验证全部 16 个有限值。

- [ ] **步骤 4：更新序列化并运行 GREEN**

运行：`npm test -- packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts`

预期：PASS，并覆盖矩阵往返。

- [ ] **步骤 5：提交**

```bash
git add packages/core/src/scene/ICENode.ts packages/core/tests
git commit -m "feat(core): support matrix-native scene nodes"
```

### 任务 3：添加窄范围的 GLB profile 读取器

**文件：**
- 创建：`packages/assets/package.json`
- 创建：`packages/assets/tsconfig.json`
- 创建：`packages/assets/src/index.ts`
- 创建：`packages/assets/src/ICEPreparedGLB.ts`
- 创建：`packages/assets/src/ICEProfileValidator.ts`
- 创建：`packages/assets/src/ICEGLBReader.ts`
- 创建：`packages/assets/tests/createFixture.ts`
- 创建：`packages/assets/tests/GLBReader.test.ts`
- 修改：`package.json`
- 修改：`tsconfig.json`
- 修改：`tests/architecture/package-boundaries.test.mjs`

**接口：**

```ts
export interface ICEPreparedNode {
  readonly id: string;
  readonly name: string;
  readonly parent: number | null;
  readonly matrix: ICEMatrix4Tuple;
  readonly visible: boolean;
}

export interface ICEPreparedGeometry {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly edgeIndices?: Uint16Array | Uint32Array;
  readonly bounds: ICEGeometryBounds;
}

export interface ICEPreparedMaterial {
  readonly id: string;
  readonly baseColor: string;
  readonly edgeColor?: string;
}

export interface ICEPreparedMesh {
  readonly id: string;
  readonly node: number;
  readonly geometry: number;
  readonly material: number;
}

export interface ICEPreparedAssetSnapshot {
  readonly assetId: string;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly stats: {
    readonly nodeCount: number;
    readonly meshCount: number;
    readonly triangleCount: number;
  };
  readonly nodes: readonly ICEPreparedNode[];
  readonly geometries: readonly ICEPreparedGeometry[];
  readonly materials: readonly ICEPreparedMaterial[];
  readonly meshes: readonly ICEPreparedMesh[];
}

export function readPreparedGLB(bytes: ArrayBuffer): ICEPreparedAssetSnapshot;
```

- [ ] **步骤 1：编写预期失败的 profile 测试**

```ts
it('reads a prepared triangle asset with zero-copy accessor views', () => {
  const snapshot = readPreparedGLB(createMinimalPreparedGLB());
  expect(snapshot.assetId).toBe('fixture');
  expect(snapshot.geometries[0]!.positions).toBeInstanceOf(Float32Array);
  expect(snapshot.geometries[0]!.indices).toEqual(new Uint16Array([0, 1, 2]));
});

it('rejects an ordinary GLB without the ICE3 profile', () => {
  expect(() => readPreparedGLB(createOrdinaryGLB())).toThrowError(
    /ICE3_ASSET_PROFILE_UNSUPPORTED/,
  );
});

it('rejects an accessor extending past the BIN chunk', () => {
  expect(() => readPreparedGLB(createOutOfRangeAccessorGLB())).toThrowError(
    /ICE3_ASSET_ACCESSOR_INVALID/,
  );
});

it('rejects node TRS when the ICE3 profile requires matrix transforms', () => {
  expect(() => readPreparedGLB(createTRSNodeGLB())).toThrowError(
    /ICE3_ASSET_PROFILE_UNSUPPORTED/,
  );
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/assets/tests/GLBReader.test.ts`

预期：FAIL，因为 `@ice3/assets` 不存在。

- [ ] **步骤 3：搭建并注册包**

该包仅依赖 `@ice3/core`。将其添加到根 workspaces、TypeScript 引用和架构测试中，依赖方向为 `core ← assets ← runtime`。

- [ ] **步骤 4：实现 GLB 分帧和 profile 验证**

验证 magic、version、总长度、chunk 长度、chunk 顺序、JSON 解码、一个 BIN chunk、`asset.extras.ice3`、ID 唯一性、节点矩阵、accessor 布局、边界、triangle/line 模式以及禁止内容。拒绝任何 `extensionsRequired`。

- [ ] **步骤 5：创建类型化数组视图**

在完成全部范围和字节对齐检查后，使用 `new Float32Array(bin, byteOffset, count)` 和相应的整数数组。不得复制完整几何缓冲区。

- [ ] **步骤 6：运行包和架构测试**

运行：

```bash
npm test -- packages/assets/tests
node --test tests/architecture/package-boundaries.test.mjs
```

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add package.json tsconfig.json tests/architecture packages/assets
git commit -m "feat(assets): read prepared GLB profile"
```

### 任务 4：以索引几何缓存替换仅支持盒体的 GPU 存储

**文件：**
- 创建：`packages/renderer/src/WebGL2GeometryBatch.ts`
- 创建：`packages/renderer/src/WebGL2GeometryCache.ts`
- 删除：`packages/renderer/src/WebGL2BoxBatch.ts`
- 删除：`packages/renderer/tests/WebGL2BoxBatch.test.ts`
- 修改：`packages/renderer/src/WebGL2Program.ts`
- 修改：`packages/renderer/src/WebGL2RendererBackend.ts`
- 修改：`packages/renderer/src/types.ts`
- 修改：`packages/renderer/tests/BackendContract.test.ts`
- 创建：`packages/renderer/tests/WebGL2GeometryBatch.test.ts`
- 创建：`packages/renderer/tests/GeometryCache.test.ts`

**接口：**

```ts
export interface ICEFrameStats {
  readonly drawCalls: number;
  readonly renderedMeshes: number;
  readonly gpuBytes: number;
}

export class WebGL2GeometryCache {
  retain(gl: WebGL2RenderingContext, geometry: ICEGeometry): Readonly<{
    vertexArray: WebGLVertexArrayObject;
    triangleIndexBuffer: WebGLBuffer;
    edgeIndexBuffer: WebGLBuffer | null;
    triangleCount: number;
    edgeCount: number;
    bytes: number;
  }>;
  beginFrame(): void;
  endFrame(): void;
  dispose(): void;
}
```

- [ ] **步骤 1：编写预期失败的缓存测试**

```ts
it('reuses buffers for the same geometry and releases unseen geometry', () => {
  const cache = new WebGL2GeometryCache();
  const first = cache.retain(gl, geometry);
  cache.beginFrame();
  const second = cache.retain(gl, geometry);
  cache.endFrame();

  expect(second.vertexArray).toBe(first.vertexArray);

  cache.beginFrame();
  cache.endFrame();
  expect(gl.deleteVertexArray).toHaveBeenCalledWith(first.vertexArray);
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/renderer/tests/GeometryCache.test.ts`

预期：FAIL，因为缓存不存在。

- [ ] **步骤 3：实现几何缓存**

使用 `Map<ICEGeometry, Entry>`。按提供内容准确上传位置、三角形索引和可选边索引。跟踪当前帧访问的条目，并在 `endFrame()` 删除未见缓冲区。通过清除缓存引用处理上下文丢失，不发出无效删除。

- [ ] **步骤 4：简化着色器和绘制路径**

由于 M1 使用平面颜色，从 vertex shader 中移除 normals。绘制三角形和可选 `LINES`。保留使用现有裁剪三角形线条偏移的高对比度边加粗。

- [ ] **步骤 5：运行渲染器测试和构建**

运行：

```bash
npm test -- packages/renderer/tests
npm run typecheck
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add packages/renderer
git commit -m "feat(renderer): cache general indexed geometry"
```

### 任务 5：从已准备快照构建场景

**文件：**
- 创建：`packages/runtime/src/asset/ICEAssetSceneBuilder.ts`
- 创建：`packages/runtime/tests/AssetSceneBuilder.test.ts`
- 修改：`packages/runtime/package.json`
- 修改：`packages/runtime/tsconfig.json`
- 修改：`packages/runtime/src/index.ts`

**接口：**

```ts
export interface ICEBuiltAsset {
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  readonly stats: {
    readonly nodeCount: number;
    readonly meshCount: number;
    readonly triangleCount: number;
  };
}

export function buildAssetScene(
  snapshot: ICEPreparedAssetSnapshot,
): ICEBuiltAsset;
```

- [ ] **步骤 1：编写预期失败的场景构建器测试**

```ts
it('instantiates the prepared node hierarchy and triangle primitive', () => {
  const built = buildAssetScene(snapshot);
  const node = built.scene.findByID('root/motor') as ICEMesh;
  expect(node.geometry.indices).toEqual(new Uint32Array([0, 1, 2]));
  expect(node.getWorldPosition().toArray()).toEqual([2, 0, 0]);
});

it('combines triangle and edge accessors in one ICE mesh', () => {
  const built = buildAssetScene(snapshotWithEdges);
  const mesh = built.scene.findByID('root/motor') as ICEMesh;
  expect(mesh.geometry.edgeIndices).toHaveLength(24);
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/runtime/tests/AssetSceneBuilder.test.ts`

预期：FAIL，因为构建器不存在。

- [ ] **步骤 3：实现场景构建**

创建具有确定性根 ID 的 `ICEScene`。使用 `matrix` 按深度优先顺序创建节点。按几何 ID 创建共享 `ICEIndexedGeometry` 对象，并按语义 ID 创建材质。对每个三角形 primitive，创建一个 `ICEMesh`，其 ID 为 `${nodeId}:${meshId}:${primitiveIndex}`。附加来自 profile 中 line primitive 的匹配边索引。

- [ ] **步骤 4：运行测试并提交**

运行：`npm test -- packages/runtime/tests/AssetSceneBuilder.test.ts`

预期：PASS。

```bash
git add packages/runtime/src/asset packages/runtime/src/index.ts \
  packages/runtime/tests/AssetSceneBuilder.test.ts \
  packages/runtime/package.json packages/runtime/tsconfig.json package-lock.json
git commit -m "feat(runtime): instantiate prepared asset scenes"
```

### 任务 6：添加异步资产加载器和生命周期

**文件：**
- 创建：`packages/runtime/src/asset/ICEAssetLoader.ts`
- 创建：`packages/runtime/tests/AssetLoader.test.ts`
- 修改：`packages/runtime/src/index.ts`
- 修改：`packages/runtime/package.json`
- 修改：`packages/runtime/tsconfig.json`
- 修改：`packages/ice3/package.json`
- 修改：`packages/ice3/tsconfig.json`
- 修改：`packages/ice3/src/index.ts`
- 修改：`tests/architecture/package-boundaries.test.mjs`

**接口：**

```ts
export interface ICEAssetLoaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly verifyIntegrity?: boolean;
}

export interface ICEAssetHandle {
  readonly id: string;
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  readonly stats: Readonly<{
    nodeCount: number;
    meshCount: number;
    triangleCount: number;
  }>;
  dispose(): void;
}

export class ICEAssetLoader {
  constructor(engine: ICE3, options?: ICEAssetLoaderOptions);
  load(url: string, options?: { readonly signal?: AbortSignal }): Promise<ICEAssetHandle>;
  clear(): void;
}
```

- [ ] **步骤 1：编写预期失败的加载器测试**

```ts
it('shares decoded bytes across concurrent loads', async () => {
  const fetch = vi.fn(async () => new Response(fixtureBytes));
  const loader = new ICEAssetLoader(engine, { fetch });
  const [first, second] = await Promise.all([
    loader.load('/asset.glb'),
    loader.load('/asset.glb'),
  ]);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(first.scene).not.toBe(second.scene);
});

it('aborts before scene instantiation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loader.load('/asset.glb', { signal: controller.signal }))
    .rejects.toThrow(/ICE3_ASSET_ABORTED/);
});

it('disposes a handle idempotently', async () => {
  const handle = await loader.load('/asset.glb');
  handle.dispose();
  handle.dispose();
  expect(handle.scene.children).toHaveLength(0);
});
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- packages/runtime/tests/AssetLoader.test.ts`

预期：FAIL，因为加载器 API 不存在。

- [ ] **步骤 3：实现 fetch、缓存、中止和句柄**

按 URL 缓存不可变 `ArrayBuffer` 和解码快照。不得缓存场景实例。在 fetch 后、profile 解析后以及场景构建前检查 `signal.aborted`。返回可幂等销毁的句柄，其 `dispose()` 调用 `scene.dispose()`。

- [ ] **步骤 4：连接公共导出和架构边界**

导出 `ICEAssetLoader` 及相关类型，经由 `@ice3/runtime` 和 `ice3`。Runtime 依赖 `@ice3/assets`；渲染器不依赖。

- [ ] **步骤 5：运行包、架构和类型测试**

运行：

```bash
npm test -- packages/runtime/tests
node --test tests/architecture/package-boundaries.test.mjs
npm run typecheck
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add packages/runtime packages/ice3 tests/architecture package-lock.json
git commit -m "feat(runtime): load prepared GLB assets"
```

### 任务 7：添加 M1 已加载资产示例和浏览器测试

**文件：**
- 创建：`examples/m1/index.html`
- 创建：`examples/m1/main.ts`
- 创建：`examples/m1/styles.css`
- 创建：`examples/m1/global.d.ts`
- 创建：`examples/m1/tsconfig.json`
- 创建：`examples/m1/webpack.config.cjs`
- 创建：`examples/m1/assets/prepared-cube.glb`
- 创建：`tests/e2e/m1.spec.ts`
- 修改：`package.json`
- 修改：`playwright.config.ts`

**接口：**
- 消费：`ICEAssetLoader.load('/assets/prepared-cube.glb')`。
- 产出：端口 `8104` 上的 M1 浏览器示例、测试钩子和浏览器验证。

- [ ] **步骤 1：从 toolchain 复制契约 fixture**

运行：

```bash
mkdir -p examples/m1/assets
cp ../ice3-toolchain/fixtures/prepared-cube.glb examples/m1/assets/prepared-cube.glb
```

预期：浏览器工作开始前，复制后的文件在单元测试中通过资产读取器。

- [ ] **步骤 2：编写预期失败的浏览器测试**

```ts
test('loads and renders the prepared industrial asset', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  await expect
    .poll(() => page.evaluate(() => window.__ice3M1.scenePixelAtProjection()))
    .toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
});

test('disposes the asset exactly once', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await page.getByRole('button', { name: '释放资产' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已释放');
});
```

- [ ] **步骤 3：运行 RED**

运行：`npx playwright test tests/e2e/m1.spec.ts --project=chromium`

预期：FAIL，因为 M1 服务器和示例不存在。

- [ ] **步骤 4：实现 M1 示例**

创建引擎、相机、轨道控制器、加载器、加载状态和销毁按钮。加载时调用 `engine.setScene(handle.scene).start()`。释放时调用 `handle.dispose()`，并幂等地清除旧引用。

仅暴露语义测试钩子：

```ts
window.__ice3M1 = {
  diagnostics: () => engine.getDiagnostics(),
  projection: () => engine.project([0, 0, 0]),
  scenePixelAtProjection,
  selectedIds: () => engine.getSelection(),
  disposeAsset,
};
```

- [ ] **步骤 5：添加脚本和服务器**

添加：

```json
{
  "build:example:m1": "npm run build && webpack --config examples/m1/webpack.config.cjs",
  "dev:example:m1": "npm run build && webpack serve --config examples/m1/webpack.config.cjs"
}
```

使用 `127.0.0.1:8104` 和 `strictPort`，不要求热重载，也不复用服务器。

- [ ] **步骤 6：运行 Chromium 和 WebKit 测试**

运行：

```bash
npx playwright test tests/e2e/m1.spec.ts
```

预期：两个浏览器均 PASS，涵盖加载、像素、拾取、销毁且无页面错误。

- [ ] **步骤 7：提交**

```bash
git add examples/m1 tests/e2e/m1.spec.ts package.json playwright.config.ts
git commit -m "feat(example): load prepared GLB asset"
```

### 任务 8：发布 M1 API 文档并完成验证

**文件：**
- 创建：`docs/api/m1.md`
- 修改：`README.md`
- 修改：`docs/diagnostics.md`
- 修改：`AGENTS.md`
- 修改：`docs/specs/2026-10-27-engine-m1-asset-design.md`

**接口：**
- 消费：完整的 M1 实现。
- 产出：公共 API 文档、稳定的资产诊断和已验证的 M1 状态。

- [ ] **步骤 1：记录公共资产 API**

`docs/api/m1.md` 包含完整的 `ICEAssetLoader` 示例、profile 限制、句柄生命周期、取消、错误码，以及通用 glTF 文件须经 toolchain 处理后才可接受这一规则。

- [ ] **步骤 2：更新架构和状态文档**

README 描述新的 `@ice3/assets` 包、M1 命令路径、端口 `8103` 和 `8104`，以及当前范围。诊断文档添加所有 `ICE3_ASSET_*` 码和调用方操作。

- [ ] **步骤 3：审计名称和不支持的 runtime 导入**

在 `packages/runtime`、`packages/assets` 和 `packages/renderer` 下运行仓库搜索，查找被禁止的产品名称以及源格式或 toolchain 导入。

预期：没有被禁止的名称，也没有 runtime 预处理导入。

- [ ] **步骤 4：运行完整门禁**

运行：

```bash
nvm use
npm run verify
npm pack --workspaces --dry-run
```

预期：

- 所有单元和集成测试通过；
- M0 和 M1 浏览器测试在 Chromium 和 WebKit 中通过；
- 包声明文件构建成功；
- workspace 包仅包含预期文件；
- runtime 包内容中不出现源格式解析器或 toolchain 代码。

- [ ] **步骤 5：提交并合并**

```bash
git add README.md AGENTS.md docs packages examples tests package.json package-lock.json
git commit -m "feat: complete M1 prepared GLB loading"
git switch main
git merge --ff-only feature/m1-asset-runtime
npm run verify
```

预期：`main` 无未提交更改，且合并后验证通过。

## 相关文档

- `ICE3-ENG-IDX-001` — [文档索引](../README.md)
- `ICE3-ENG-SPEC-002` — [M1 资产设计](../specs/2026-10-27-engine-m1-asset-design.md)
- `ICE3-ENG-API-002` — [M1 资产 API](../api/m1.md)
