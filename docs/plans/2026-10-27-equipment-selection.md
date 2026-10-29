# 设备选择实施计划

> Document ID: ICE3-ENG-PLAN-003
>
> Status: Implemented
>
> Owner: ICE3 Engine maintainers

> **面向代理工作者的说明：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项实施本计划。使用复选框（`- [ ]`）跟踪进度。

**目标：** 添加精确的整件设备单选，包含 GPU 拾取、青色渲染高亮和跟随设备的名称标签。

**架构：** selection 身份存于网格上，并由已准备资产的场景构建过程传播。WebGL2 后端仅在拾取时渲染临时 RGBA8 身份图像，runtime 输入则区分短点击与相机拖动。随后，常规渲染器根据共享的 selection 状态绘制非破坏性高亮 overlay。

**技术栈：** TypeScript、ESM、WebGL2、Canvas2D、Node.js 测试运行器、Playwright、npm workspaces

**规范：** `docs/specs/2026-10-27-equipment-selection-design.md`

## 全局约束

- 在一个功能分支上开发，并仅在合入 `main` 前确认 `npm run verify` 和 `npm pack --workspaces --dry-run` 通过。
- 使用 `.nvmrc` 指定的 Node.js 24.22.1 LTS。
- 公共消费方仅使用 `ice3` 入口。
- 不得通过公共 API 暴露 WebGL 对象。
- 保持 `@ice3/core` 独立于 DOM、Canvas、GPU 和同级包。
- 不得修改已准备资产格式或 toolchain。
- 使用 `selectionId` 作为稳定选择单元，使用 `id` 作为语义对象身份。
- 将超过 4 CSS 像素的拖动视为相机手势，而非选择点击。
- selection 强调色使用 `#63d7ff`，表面着色使用 16% 不透明度。
- 绝不得将真实客户模型或派生文件加入测试、fixture、截图、文档、提交或包中。
- 所有自动化选择测试均使用合成几何或现有可分发 fixture。
- 不得在任何位置引入竞品或厂商产品名称。

## 审查重点

- 即使指针从设备上开始，拖动也绝不能改变 selection。
- 重叠几何必须选择最近的可见表面，而非最近的包围盒。
- 来自一个源节点的多个渲染 primitive 必须解析为同一设备身份。
- 交互式 2D 控件必须阻止 selection；非交互式操作提示必须保持可点击穿透。
- 拾取必须在 DPR 变化、上下文恢复、空像素和资源分配失败后仍然可用，且不破坏常规渲染。

## 文件结构

**创建**

- `packages/renderer/src/WebGL2PickCodec.ts`：纯 RGBA8 selection 索引编码和解码。
- `packages/renderer/src/WebGL2Picker.ts`：离屏 WebGL2 身份目标和点击时拾取 pass。
- `packages/runtime/src/input/ICESelectionGesture.ts`：点击与拖动的阈值逻辑。
- `packages/renderer/tests/PickCodec.test.ts`：codec 边界和无效值。
- `packages/runtime/tests/SelectionGesture.test.ts`：指针移动阈值。

**修改**

- `packages/core/src/scene/ICENode.ts`：`displayName`。
- `packages/core/src/scene/ICEMesh.ts`：`selectionId`。
- `packages/core/tests/Scene.test.ts`：core 元数据行为。
- `packages/core/tests/Serialization.test.ts`：元数据往返。
- `packages/runtime/src/asset/ICEAssetSceneBuilder.ts`：传播已准备名称和 selection 身份。
- `packages/runtime/tests/AssetSceneBuilder.test.ts`：资产分组行为。
- `packages/renderer/src/types.ts`：pick 能力、屏幕点和 selection 帧数据。
- `packages/renderer/src/FakeRendererBackend.ts`：新能力和测试 pick 结果。
- `packages/renderer/src/WebGL2RendererBackend.ts`：pick 委托、overlay pass 和 picker 生命周期。
- `packages/renderer/tests/BackendContract.test.ts`：能力契约。
- `packages/renderer/tests/WebGL2GeometryBatch.test.ts`：稳定的 selection 身份。
- `packages/runtime/src/ICE3.ts`：点击 selection、诊断和帧 selection。
- `packages/runtime/src/layer/ICELabel.ts`：可变文本，无需重建标签。
- `packages/runtime/tests/LayerOrder.test.ts`：文本更新测量。
- `examples/m1/main.ts`：selection 标签和已选名称状态。
- `examples/m1/global.d.ts`：E2E selection 探测。
- `tests/e2e/m0.spec.ts`：拖动不得选择。
- `tests/e2e/m1.spec.ts`：点击、高亮、标签、清除和拖动选择测试。
- `docs/api/m0.md`：共享点击语义和诊断。
- `docs/api/m1.md`：设备选择行为。

---

### 任务 1：为 Core 对象添加设备元数据

**文件：**
- 修改：`packages/core/src/scene/ICENode.ts`
- 修改：`packages/core/src/scene/ICEMesh.ts`
- 测试：`packages/core/tests/Scene.test.ts`
- 测试：`packages/core/tests/Serialization.test.ts`

**接口：**
- 消费：现有 `ICENodeOptions`、`ICEMeshOptions` 和序列化辅助函数。
- 产出：`ICENodeOptions.displayName?: string`；`ICENode.displayName: string`；`ICEMeshOptions.selectionId?: string`；`ICEMesh.selectionId: string`。

- [ ] **步骤 1：编写预期失败的元数据测试**

添加到 `packages/core/tests/Scene.test.ts`：

```ts
it('uses display names for presentation and falls back to stable IDs', () => {
  expect(new ICENode({ id: 'motor-1', displayName: '一号泵' }).displayName)
    .toBe('一号泵');
  expect(new ICENode({ id: 'motor-2' }).displayName).toBe('motor-2');
});

it('defaults mesh selection identity to its stable ID', () => {
  const node = new ICEMesh({
    id: 'motor-3',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  });
  expect(node.selectionId).toBe('motor-3');
});

it('accepts a shared selection identity for multiple mesh primitives', () => {
  const geometry = new ICEIndexedGeometry({
    id: 'shared-geometry',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  const first = new ICEMesh({
    id: 'motor-4/primitive/0',
    selectionId: 'motor-4',
    geometry,
    material,
  });
  const second = new ICEMesh({
    id: 'motor-4/primitive/1',
    selectionId: 'motor-4',
    geometry,
    material,
  });
  expect([first.selectionId, second.selectionId]).toEqual(['motor-4', 'motor-4']);
});
```

添加到 `packages/core/tests/Serialization.test.ts`：

```ts
it('round-trips display and equipment selection names', () => {
  const registry = new ICETypeRegistry();
  registry.register('ice3:Mesh', ICEMesh);
  const scene = new ICEScene({ id: 'scene' });
  scene.addChild(new ICEMesh({
    id: 'motor-part',
    displayName: '一号泵',
    selectionId: 'motor-group',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  }));

  const restored = deserializeScene(serializeScene(scene), registry);
  const mesh = restored.scene.findByID('motor-part') as ICEMesh;
  expect(mesh.displayName).toBe('一号泵');
  expect(mesh.selectionId).toBe('motor-group');
});
```

- [ ] **步骤 2：验证测试因缺少 API 而失败**

运行：

```bash
npm test -- packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
```

预期：FAIL，因为 `displayName` 和 `selectionId` 不存在。

- [ ] **步骤 3：实现 core 元数据和序列化**

在 `ICENode` 中添加：

```ts
export interface ICENodeOptions {
  readonly id: string;
  readonly displayName?: string;
}

export interface ICESerializedNode {
  readonly displayName?: string;
}

readonly displayName: string;

constructor(options: ICENodeOptions) {
  super();
  if (!options.id.trim()) throw new TypeError('ICE node ID must not be empty');
  this.id = options.id;
  this.displayName = options.displayName?.trim() || options.id;
}

toJSON(): ICESerializedNode {
  return {
    id: this.id,
    displayName: this.displayName,
  };
}
```

在 `ICEMesh` 中添加：

```ts
export interface ICEMeshOptions extends ICENodeOptions {
  readonly selectionId?: string;
}

readonly selectionId: string;

constructor(options: ICEMeshOptions) {
  super(options);
  this.selectionId = options.selectionId?.trim() || options.id;
  this.geometry = options.geometry;
  this.material = options.material;
}
```

使用以下字段更新 `ICEMesh.fromJSON`：

```ts
static fromJSON(value: ICESerializedNode): ICEMesh {
  const geometry = value.geometry as Record<string, unknown>;
  const material = value.material as Record<string, unknown>;
  return new ICEMesh({
    id: value.id,
    displayName: typeof value.displayName === 'string'
      ? value.displayName
      : value.id,
    selectionId: typeof value.selectionId === 'string'
      ? value.selectionId
      : value.id,
    position: value.position,
    rotation: value.rotation,
    scale: value.scale,
    ...(value.matrix ? { matrix: value.matrix } : {}),
    geometry: new BoxGeometry({
      width: Number(geometry.width),
      height: Number(geometry.height),
      depth: Number(geometry.depth),
    }),
    material: new BasicMaterial({
      color: String(material.color),
      ...(typeof material.edgeColor === 'string'
        ? { edgeColor: material.edgeColor }
        : {}),
    }),
  });
}
```

- [ ] **步骤 4：运行测试以验证任务**

运行：

```bash
npm test -- packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
```

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/core/src/scene/ICENode.ts packages/core/src/scene/ICEMesh.ts packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
git commit -m "feat(core): add equipment selection metadata"
```

---

### 任务 2：传播已准备名称和设备分组

**文件：**
- 修改：`packages/runtime/src/asset/ICEAssetSceneBuilder.ts`
- 测试：`packages/runtime/tests/AssetSceneBuilder.test.ts`

**接口：**
- 消费：`ICEPreparedNode.name`、`ICEPreparedMesh.node`、`ICEMesh.selectionId`。
- 产出：具有 `displayName = source.name` 的导入网格节点，以及所有源节点 primitive 共享 `selectionId = source.id`。

- [ ] **步骤 1：编写预期失败的场景构建器测试**

添加：

```ts
it('preserves prepared display names and equipment identity', () => {
  const built = buildAssetScene(snapshotWithEdges);
  const mesh = built.scene.findByID('root/motor') as ICEMesh;
  expect(mesh.displayName).toBe('motor');
  expect(mesh.selectionId).toBe('root/motor');
});

it('keeps secondary primitives in the same equipment selection group', () => {
  const snapshot = {
    ...snapshotWithEdges,
    meshes: [
      ...snapshotWithEdges.meshes,
      {
        id: 'fixture/mesh/extra',
        node: 1,
        geometry: 0,
        material: 0,
      },
    ],
  };
  const built = buildAssetScene(snapshot);
  const sourceNode = built.scene.findByID('root/motor') as ICEMesh;
  const secondary = sourceNode.children[0] as ICEMesh;
  expect(secondary.selectionId).toBe('root/motor');
  expect(secondary.displayName).toBe('motor');
});
```

- [ ] **步骤 2：验证测试失败**

运行：

```bash
npm test -- packages/runtime/tests/AssetSceneBuilder.test.ts
```

预期：FAIL，因为构建器忽略已准备名称，且未设置共享 selection 身份。

- [ ] **步骤 3：实现传播**

对于节点上的第一个网格：

```ts
new ICEMesh({
  id: source.id,
  displayName: source.name,
  selectionId: source.id,
  matrix: source.matrix,
  geometry,
  material,
})
```

对于同一源节点上的每个额外网格：

```ts
new ICEMesh({
  id: mesh.id,
  displayName: source.name,
  selectionId: source.id,
  geometry,
  material,
})
```

- [ ] **步骤 4：验证任务测试和所有 runtime 测试**

运行：

```bash
npm test -- packages/runtime/tests/AssetSceneBuilder.test.ts
npm test -- packages/runtime
```

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/runtime/src/asset/ICEAssetSceneBuilder.ts packages/runtime/tests/AssetSceneBuilder.test.ts
git commit -m "feat(assets): group prepared primitives by equipment"
```

---

### 任务 3：添加 Selection 帧数据和 RGBA8 身份 codec

**文件：**
- 修改：`packages/renderer/src/types.ts`
- 修改：`packages/renderer/src/FakeRendererBackend.ts`
- 修改：`packages/renderer/src/WebGL2RendererBackend.ts`
- 创建：`packages/renderer/src/WebGL2PickCodec.ts`
- 创建：`packages/renderer/tests/PickCodec.test.ts`
- 修改：`packages/renderer/tests/BackendContract.test.ts`

**接口：**
- 产出：`ICEScreenPoint = Readonly<{ x: number; y: number }>`。
- 产出：`ICEFrame.selection: readonly string[]`。
- 产出：`ICERendererCapabilities.picking: boolean`。
- 产出：`ICERendererBackend.pick?(frame, point): string | undefined`。
- 产出：`encodeSelectionIndex(index): readonly [number, number, number, 255]` 和 `decodeSelectionIndex(pixel): number | undefined`。

- [ ] **步骤 1：编写预期失败的 codec 和契约测试**

创建 `packages/renderer/tests/PickCodec.test.ts`：

```ts
import { it } from 'node:test';
import { expect } from 'expect';
import {
  decodeSelectionIndex,
  encodeSelectionIndex,
} from '../src/WebGL2PickCodec';

it.each([
  [0, [0, 0, 0, 255]],
  [1, [1, 0, 0, 255]],
  [255, [255, 0, 0, 255]],
  [256, [0, 1, 0, 255]],
  [0xffffff, [255, 255, 255, 255]],
] as const)('encodes selection index %i', (index, expected) => {
  expect(encodeSelectionIndex(index)).toEqual(expected);
  expect(decodeSelectionIndex(expected)).toBe(index);
});

it('decodes zero as no selection and rejects out-of-range indices', () => {
  expect(decodeSelectionIndex([0, 0, 0, 255])).toBeUndefined();
  expect(() => encodeSelectionIndex(-1)).toThrow(/selection index/i);
  expect(() => encodeSelectionIndex(0x1000000)).toThrow(/selection index/i);
});
```

添加到 `BackendContract.test.ts`：

```ts
it('declares whether the backend supports exact picking', () => {
  expect(new FakeRendererBackend().capabilities.picking).toBe(false);
  expect(new WebGL2RendererBackend().capabilities.picking).toBe(true);
});
```

为每个 fake 帧 fixture 更新 `selection: []`。

- [ ] **步骤 2：验证 RED**

运行：

```bash
npm test -- packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
```

预期：FAIL，因为 codec 和能力不存在。

- [ ] **步骤 3：实现类型和 codec**

在 `types.ts` 中：

```ts
export type ICEScreenPoint = Readonly<{ x: number; y: number }>;

export type ICEFrame = {
  readonly frameId: number;
  readonly scene: ICEScene;
  readonly camera: ICEPerspectiveCamera;
  readonly viewport: ICEViewport;
  readonly dpr: number;
  readonly selection: readonly string[];
};

export interface ICERendererCapabilities {
  readonly backend: 'webgl2' | 'fake';
  readonly maxTextureSize: number;
  readonly picking: boolean;
}

export interface ICERendererBackend {
  pick?(frame: ICEFrame, point: ICEScreenPoint): string | undefined;
}
```

创建 `WebGL2PickCodec.ts`：

```ts
const MAX_SELECTION_INDEX = 0xffffff;

export function encodeSelectionIndex(
  index: number,
): readonly [number, number, number, 255] {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SELECTION_INDEX) {
    throw new RangeError('ICE selection index is out of range');
  }
  return [
    index & 0xff,
    (index >>> 8) & 0xff,
    (index >>> 16) & 0xff,
    255,
  ];
}

export function decodeSelectionIndex(
  pixel: ArrayLike<number>,
): number | undefined {
  if (pixel.length < 4) {
    throw new RangeError('ICE pick pixel must contain RGBA values');
  }
  const index = pixel[0]!
    + pixel[1]! * 256
    + pixel[2]! * 65_536;
  return index === 0 ? undefined : index;
}
```

在 fake 后端设置 `picking: false`，在 WebGL2 后端设置 `picking: true`。

- [ ] **步骤 4：验证 GREEN**

运行：

```bash
npm test -- packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
npm run typecheck
```

运行前，在 `BackendContract.test.ts` 和 `ICE3.renderFrame()` 中用 `selection: []` 或实时 selection 数组更新帧 fixture。预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/renderer/src/types.ts packages/renderer/src/FakeRendererBackend.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/WebGL2PickCodec.ts packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
git commit -m "feat(renderer): define pickup frame contract"
```

---

### 任务 4：实现离屏 WebGL2 拾取

**文件：**
- 创建：`packages/renderer/src/WebGL2Picker.ts`
- 修改：`packages/renderer/src/WebGL2RendererBackend.ts`
- 修改：`packages/renderer/src/WebGL2Program.ts`
- 修改：`packages/runtime/src/ICE3.ts`
- 测试：任务 8 中的浏览器 selection 测试

**接口：**
- 消费：`WebGL2Program`、`WebGL2GeometryCache`、`collectRenderables`、`encodeSelectionIndex`、`decodeSelectionIndex`。
- 产出：`ICEPickFrame`；`new WebGL2Picker(gl)`；`picker.pick(frame: ICEPickFrame, geometryCache, renderables): string | undefined`。

- [ ] **步骤 1：添加预期失败的渲染器能力断言**

扩展 `tests/e2e/m1.spec.ts`，添加一个检查真实后端是否声明支持 picking 的探测：

```ts
expect(await page.evaluate(
  () => window.__ice3M1.diagnostics().backend.picking,
)).toBe(true);
```

运行：

```bash
npm run test:e2e -- tests/e2e/m1.spec.ts --project=chromium --grep="prepared industrial asset"
```

预期：FAIL，因为诊断尚未暴露 `picking`。

- [ ] **步骤 2：实现 picker**

创建具有以下确切职责的 `WebGL2Picker.ts`：

```ts
import { ICEEngineError, ICEMatrix4 } from '@ice3/core';
import type { ICEGeometryRenderable } from './WebGL2GeometryBatch.js';
import type { WebGL2GeometryCache } from './WebGL2GeometryCache.js';
import {
  decodeSelectionIndex,
  encodeSelectionIndex,
} from './WebGL2PickCodec.js';
import { WebGL2Program } from './WebGL2Program.js';
import type { ICEFrame, ICEScreenPoint } from './types.js';

export type ICEPickFrame = ICEFrame & {
  readonly point: ICEScreenPoint;
};

export class WebGL2Picker {
  private program: WebGL2Program;
  private framebuffer: WebGLFramebuffer | null = null;
  private colorTexture: WebGLTexture | null = null;
  private depthBuffer: WebGLRenderbuffer | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new WebGL2Program(gl);
  }

  pick(
    frame: ICEPickFrame,
    cache: WebGL2GeometryCache,
    renderables: readonly ICEGeometryRenderable[],
  ): string | undefined {
    const selectionIds = new Map<string, number>();
    for (const renderable of renderables) {
      const id = renderable.mesh.selectionId;
      if (!selectionIds.has(id)) {
        if (selectionIds.size >= 0xffffff) {
          throw new Error('ICE3_PICK_CAPACITY');
        }
        selectionIds.set(id, selectionIds.size + 1);
      }
    }
    this.ensureTarget(
      Math.max(1, Math.round(frame.viewport.width * frame.dpr)),
      Math.max(1, Math.round(frame.viewport.height * frame.dpr)),
    );
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    this.program.use();
    this.program.setClipOffset(0, 0);
    const aspect = frame.viewport.width / Math.max(frame.viewport.height, 1);
    const viewProjection = frame.camera.getViewProjectionMatrix(aspect);
    const mvp = new ICEMatrix4();
    const world = new ICEMatrix4();
    for (const renderable of renderables) {
      const selectionIndex = selectionIds.get(renderable.mesh.selectionId)!;
      const color = encodeSelectionIndex(selectionIndex);
      this.program.setColor([
        color[0] / 255,
        color[1] / 255,
        color[2] / 255,
        1,
      ]);
      mvp.elements.set(viewProjection.elements);
      world.elements.set(renderable.worldMatrix);
      mvp.multiply(world);
      this.program.setMatrix(mvp);
      this.program.setVertexColors(false);
      const geometry = cache.retain(gl, renderable.mesh.geometry);
      gl.bindVertexArray(geometry.vertexArray);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        geometry.triangleCount,
        renderable.mesh.geometry.indices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
    }
    const pixelX = Math.max(
      0,
      Math.min(
        this.width - 1,
        Math.floor(frame.point.x * frame.dpr),
      ),
    );
    const pixelY = Math.max(
      0,
      Math.min(
        this.height - 1,
        Math.floor((frame.viewport.height - frame.point.y) * frame.dpr),
      ),
    );
    const pixel = new Uint8Array(4);
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(
      frame.viewport.x * frame.dpr,
      frame.viewport.y * frame.dpr,
      frame.viewport.width * frame.dpr,
      frame.viewport.height * frame.dpr,
    );
    const index = decodeSelectionIndex(pixel);
    return index === undefined
      ? undefined
      : [...selectionIds].find(([, value]) => value === index)?.[0];
  }

  dispose(): void {
    this.releaseTarget();
    this.program.dispose();
  }

  private ensureTarget(width: number, height: number): void {
    if (
      this.framebuffer
      && this.colorTexture
      && this.depthBuffer
      && this.width === width
      && this.height === height
    ) {
      return;
    }
    this.releaseTarget();
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const colorTexture = gl.createTexture();
    const depthBuffer = gl.createRenderbuffer();
    if (!framebuffer || !colorTexture || !depthBuffer) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(colorTexture);
      gl.deleteRenderbuffer(depthBuffer);
      throw new ICEEngineError(
        'ICE3_PICK_UNAVAILABLE',
        'ICE3_PICK_UNAVAILABLE: pick target allocation failed',
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      colorTexture,
      0,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT16,
      width,
      height,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depthBuffer,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(colorTexture);
      gl.deleteRenderbuffer(depthBuffer);
      throw new ICEEngineError(
        'ICE3_PICK_UNAVAILABLE',
        'ICE3_PICK_UNAVAILABLE: pick framebuffer is incomplete',
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.framebuffer = framebuffer;
    this.colorTexture = colorTexture;
    this.depthBuffer = depthBuffer;
    this.width = width;
    this.height = height;
  }

  private releaseTarget(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.colorTexture);
    gl.deleteRenderbuffer(this.depthBuffer);
    this.framebuffer = null;
    this.colorTexture = null;
    this.depthBuffer = null;
  }
}
```

在 `readPixels` 之前立即添加：

```ts
gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
```

释放 program 前，调用 `this.releaseTarget()`，且该调用位于 `dispose()` 内，确保资源恰好删除一次。

- [ ] **步骤 3：委托后端拾取**

在 `WebGL2RendererBackend` 中：

```ts
private picker: WebGL2Picker | null = null;

pick(frame: ICEFrame, point: ICEScreenPoint): string | undefined {
  if (!this.picker || !this.geometryCache) {
    throw new ICEEngineError(
      'ICE3_PICK_UNAVAILABLE',
      'ICE3_PICK_UNAVAILABLE: picker is not initialized',
    );
  }
  return this.picker.pick(
    { ...frame, point },
    this.geometryCache,
    collectRenderables(frame.scene),
  );
}
```

在 `createProgram` 中创建 picker，在上下文丢失时删除，在上下文恢复时重新创建，并在 `dispose` 中销毁。

将 `WebGL2Program` 片元精度从 `mediump` 改为 `highp`，使 RGB 字节身份在不同 WebGL2 实现之间保持可区分。

扩展声明的诊断后端结构，使浏览器探测无需类型转换即可读取新能力：

```ts
readonly backend: Readonly<{
  backend: 'webgl2' | 'fake';
  maxTextureSize: number;
  picking: boolean;
}>;
```

- [ ] **步骤 4：验证渲染器测试**

运行：

```bash
npm test -- packages/renderer
npm run typecheck
```

预期：PASS。在 runtime 诊断包含后端能力前，浏览器断言仍会失败。

- [ ] **步骤 5：提交**

```bash
git add packages/renderer/src/WebGL2Picker.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/WebGL2Program.ts tests/e2e/m1.spec.ts
git commit -m "feat(renderer): add GPU equipment picking"
```

---

### 任务 5：渲染非破坏性 Selection 高亮

**文件：**
- 修改：`packages/renderer/src/WebGL2GeometryBatch.ts`
- 修改：`packages/renderer/src/WebGL2RendererBackend.ts`
- 测试：`packages/renderer/tests/WebGL2GeometryBatch.test.ts`
- 测试：`tests/e2e/m1.spec.ts`

**接口：**
- 消费：`ICEFrame.selection`、`ICEMesh.selectionId`。
- 产出：`selectionIdentity(mesh: ICEMesh): string`。

- [ ] **步骤 1：编写预期失败的 selection 身份测试**

添加：

```ts
it('uses the declared equipment identity for rendering selection', () => {
  const mesh = new ICEMesh({
    id: 'motor-7/primitive/1',
    selectionId: 'motor-7',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
  });
  expect(selectionIdentity(mesh)).toBe('motor-7');
});
```

运行：

```bash
npm test -- packages/renderer/tests/WebGL2GeometryBatch.test.ts
```

预期：FAIL，因为 `selectionIdentity` 不存在。

- [ ] **步骤 2：实现高亮 pass**

从 `WebGL2GeometryBatch.ts` 导出：

```ts
export const selectionIdentity = (mesh: ICEMesh): string => mesh.selectionId;
```

将 `render(frame)` 改为只收集一次 renderable。在所有常规网格绘制完成后、`geometryCache.endFrame()` 之前：

```ts
if (frame.selection.length > 0) {
  const selected = new Set(frame.selection);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  this.program.setVertexColors(false);
  this.program.setColor([99 / 255, 215 / 255, 1, 0.16]);
  for (const renderable of renderables) {
    if (!selected.has(selectionIdentity(renderable.mesh))) continue;
    mvp.elements.set(viewProjection.elements);
    world.elements.set(renderable.worldMatrix);
    mvp.multiply(world);
    this.program.setMatrix(mvp);
    this.program.setClipOffset(0, 0);
    const geometry = this.geometryCache.retain(gl, renderable.mesh.geometry);
    gl.bindVertexArray(geometry.vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangleIndexBuffer);
    gl.drawElements(
      gl.TRIANGLES,
      geometry.triangleCount,
      renderable.mesh.geometry.indices instanceof Uint16Array
        ? gl.UNSIGNED_SHORT
        : gl.UNSIGNED_INT,
      0,
    );
  }
  this.program.setColor([99 / 255, 215 / 255, 1, 1]);
  for (const renderable of renderables) {
    if (!selected.has(selectionIdentity(renderable.mesh))) continue;
    const geometry = this.geometryCache.retain(gl, renderable.mesh.geometry);
    if (!geometry.edgeIndexBuffer) continue;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.edgeIndexBuffer);
    for (const [offsetX, offsetY] of EDGE_PIXEL_OFFSETS) {
      this.program.setClipOffset(offsetX * clipPixelX, offsetY * clipPixelY);
      gl.drawElements(
        gl.LINES,
        geometry.edgeCount,
        renderable.mesh.geometry.edgeIndices instanceof Uint16Array
          ? gl.UNSIGNED_SHORT
          : gl.UNSIGNED_INT,
        0,
      );
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  this.program.setClipOffset(0, 0);
}
```

变量 `renderables`、`mvp`、`world`、`viewProjection`、`clipPixelX` 和 `clipPixelY` 是常规渲染循环已创建的相同值；不要再次计算。

将现有 `frame.selection` 传入 `ICE3` 中的渲染调用，使用 `this.interaction.getSelection()`。保持 `geometryCache.beginFrame()` 位于主循环之前，`geometryCache.endFrame()` 位于高亮 pass 之后。

- [ ] **步骤 3：验证渲染器测试**

运行：

```bash
npm test -- packages/renderer
npm run typecheck
```

预期：PASS。

- [ ] **步骤 4：提交**

```bash
git add packages/renderer/src/WebGL2GeometryBatch.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/tests/WebGL2GeometryBatch.test.ts
git commit -m "feat(renderer): highlight selected equipment"
```

---

### 任务 6：点击选择并保留相机拖动

**文件：**
- 创建：`packages/runtime/src/input/ICESelectionGesture.ts`
- 创建：`packages/runtime/tests/SelectionGesture.test.ts`
- 修改：`packages/runtime/src/ICE3.ts`
- 修改：`packages/runtime/src/index.ts`
- 修改：`packages/ice3/src/index.ts`
- 修改：`packages/renderer/src/FakeRendererBackend.ts`
- 修改：`packages/runtime/tests/Projection.test.ts`
- 修改：`tests/e2e/m0.spec.ts`

**接口：**
- 消费：`ICE3.pick(point)`、`ICERendererCapabilities.picking`、`ICERendererBackend.pick`。
- 产出：`SELECTION_CLICK_THRESHOLD_PX = 4`；`isSelectionClick(start, end): boolean`；`selectionForOutcome(outcome): readonly string[] | undefined`。
- 产出诊断：`selectionCount`、`lastPickTimeMs`、`lastPickId`。

- [ ] **步骤 1：编写预期失败的手势测试**

创建 `packages/runtime/tests/SelectionGesture.test.ts`：

```ts
import { it } from 'node:test';
import { expect } from 'expect';
import {
  isSelectionClick,
  selectionForOutcome,
} from '../src/input/ICESelectionGesture';

it('treats movement up to four pixels as a selection click', () => {
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(true);
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
});

it('rejects movement beyond four pixels as a drag', () => {
  expect(isSelectionClick({ x: 10, y: 10 }, { x: 14.1, y: 10 })).toBe(false);
});

it('maps empty picks to a cleared selection and hits to one equipment ID', () => {
  expect(selectionForOutcome({ kind: 'empty' })).toEqual([]);
  expect(selectionForOutcome({ kind: 'hit', id: 'motor-9' }))
    .toEqual(['motor-9']);
  expect(selectionForOutcome({ kind: 'error' })).toBeUndefined();
});
```

更新 M0 拖动浏览器测试，使其移动超过阈值、返回起点、释放，并预期初始状态保持 `运行` 且 `selectedIds` 为空。

- [ ] **步骤 2：验证 RED**

运行：

```bash
npm test -- packages/runtime/tests/SelectionGesture.test.ts
npm run test:e2e -- tests/e2e/m0.spec.ts --project=chromium --grep="mouse drag"
```

预期：手势模块缺失；当前拖动会选择 `demo-block`。

- [ ] **步骤 3：实现点击选择**

创建：

```ts
export const SELECTION_CLICK_THRESHOLD_PX = 4;

export function isSelectionClick(
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y)
    <= SELECTION_CLICK_THRESHOLD_PX;
}

export type ICEPickOutcome =
  | { readonly kind: 'hit'; readonly id: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' };

export function selectionForOutcome(
  outcome: ICEPickOutcome,
): readonly string[] | undefined {
  if (outcome.kind === 'hit') return [outcome.id];
  if (outcome.kind === 'empty') return [];
  return undefined;
}
```

在 `ICE3` 中，添加指针手势状态：

```ts
type PointerGesture = {
  start: Readonly<{ x: number; y: number }>;
  end: Readonly<{ x: number; y: number }>;
  target: ICEInputTarget;
  dragged: boolean;
};

private readonly pointerGestures = new Map<number, PointerGesture>();
private lastPickTimeMs = 0;
private lastPickId: string | undefined;
```

在 pointer down 时，调用 `inputRouter.pointerDown` 并将其返回的目标与 `dragged: false` 一起存储。每次移动时，路由该移动，并设置 `dragged = true`，条件是 `isSelectionClick(start, point)` 变为 false。因此，即使指针稍后返回起点附近，拖动仍保持为拖动。在 pointer up 时：

```ts
const point = pointOf(event);
const gesture = this.pointerGestures.get(event.pointerId);
this.inputRouter.pointerUp(point, event.pointerId);
this.pointerGestures.delete(event.pointerId);
if (
  gesture
  && gesture.target.kind === 'scene'
  && !gesture.dragged
  && isSelectionClick(gesture.start, point)
) {
  const result = this.samplePick(point);
  const outcome: ICEPickOutcome = result.kind === 'hit'
    ? { kind: 'hit', id: result.node.id }
    : result;
  const nextSelection = selectionForOutcome(outcome);
  if (nextSelection !== undefined) {
    this.setSelection(nextSelection);
  }
}
```

从 `dispatchInput` 中移除 selection。在 `pointercancel`、window blur、stop 和 destroy 时清除手势。

将输入路由器的 `pickScene` 回调改为返回 `{ kind: 'scene' }` 而不执行拾取。这样可保持 pointer-down 路由开销较低，并将精确 GPU 拾取推迟到 pointer-up。

添加内部结果类型：

```ts
type ICEPickResult =
  | { readonly kind: 'hit'; readonly node: ICENode }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' };
```

使用以下内容更新 `FakeRendererBackend`：

```ts
constructor(options: {
  readonly picking?: boolean;
} = {}) {
  this.capabilities = {
    backend: 'fake',
    maxTextureSize: 4096,
    picking: options.picking ?? false,
  };
}

readonly capabilities: Readonly<ICERendererCapabilities>;
pickResult: string | undefined;
pickError: Error | undefined;
pick(): string | undefined {
  if (this.pickError) throw this.pickError;
  return this.pickResult;
}
```

默认保持能力 `picking: false`，以便现有 CPU picker 测试继续使用 `pickSceneNode`。

- [ ] **步骤 4：通过 GPU 路由语义 `pick()`**

添加诊断字段 `selectionCount`、`lastPickTimeMs`、`lastPickId`，然后实现：

```ts
pick(point: ICEScreenPoint): ICENode | undefined {
  const result = this.samplePick(point);
  return result.kind === 'hit' ? result.node : undefined;
}

private samplePick(point: ICEScreenPoint): ICEPickResult {
  this.assertActive();
  if (!this.scene || !this.camera) return { kind: 'empty' };
  if (this.backend.capabilities.picking && this.backend.pick) {
    const startedAt = performance.now();
    try {
      const selectionId = this.backend.pick({
        frameId: this.frameId,
        scene: this.scene,
        camera: this.camera,
        viewport: this.viewport,
        dpr: this.dpr,
        selection: this.interaction.getSelection(),
      }, point);
      this.lastPickId = selectionId;
      const node = selectionId
        ? this.scene.findByID(selectionId)
        : undefined;
      return node ? { kind: 'hit', node } : { kind: 'empty' };
    } catch (error) {
      this.recordDiagnostic(
        'ICE3_PICK_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
      return { kind: 'error' };
    } finally {
      this.lastPickTimeMs = performance.now() - startedAt;
    }
  }
  const node = pickSceneNode(this.scene, this.camera, this.viewport, point);
  return node ? { kind: 'hit', node } : { kind: 'empty' };
}
```

`{ kind: 'error' }` 分支有意返回 `undefined`，由 `selectionForOutcome` 产生，因此 pointer-up 保持当前 selection 不变，同时 `samplePick` 记录 `ICE3_PICK_UNAVAILABLE`。

- [ ] **步骤 5：验证 GREEN**

运行：

```bash
npm test -- packages/runtime/tests/SelectionGesture.test.ts packages/runtime/tests/Projection.test.ts
npm run test:e2e -- tests/e2e/m0.spec.ts --project=chromium --grep="mouse drag"
npm run typecheck
```

预期：PASS；拖动会旋转但不选择，常规点击仍可选择。

- [ ] **步骤 6：提交**

```bash
git add packages/runtime/src/input/ICESelectionGesture.ts packages/runtime/src/ICE3.ts packages/runtime/src/index.ts packages/ice3/src/index.ts packages/renderer/src/FakeRendererBackend.ts packages/runtime/tests/SelectionGesture.test.ts packages/runtime/tests/Projection.test.ts tests/e2e/m0.spec.ts
git commit -m "feat(runtime): select equipment on click"
```

---

### 任务 7：为 M1 示例添加 Selection 名称标签

**文件：**
- 修改：`packages/runtime/src/layer/ICELabel.ts`
- 修改：`packages/runtime/tests/LayerOrder.test.ts`
- 修改：`examples/m1/main.ts`
- 修改：`examples/m1/global.d.ts`

**接口：**
- 消费：`ICENode.displayName`、`SELECTION_CHANGE`、`ICEScreenLayer`、`ICELabel`。
- 产出：`ICELabel.setText(text: string): this`。
- 产出：`window.__ice3M1.selectedLabelText(): string | undefined`。

- [ ] **步骤 1：编写预期失败的标签测试**

添加：

```ts
it('updates label text and remeasures without replacing the label', () => {
  const label = new ICELabel({
    id: 'selection',
    text: 'A',
    screenPosition: [10, 20],
  });
  const context = document.createElement('canvas').getContext('2d')!;
  const before = label.measure(context).width;
  label.setText('A much longer equipment name');
  const after = label.measure(context);
  expect(label.text).toBe('A much longer equipment name');
  expect(after.width).toBeGreaterThan(before);
  expect(after.y).toBe(20);
});
```

- [ ] **步骤 2：验证 RED**

运行：

```bash
npm test -- packages/runtime/tests/LayerOrder.test.ts
```

预期：FAIL，因为 `setText` 不存在。

- [ ] **步骤 3：实现可变标签文本**

将公共 readonly 字段替换为：

```ts
private currentText: string;

get text(): string {
  return this.currentText;
}

setText(text: string): this {
  this.currentText = text;
  this.visible = text.length > 0;
  return this;
}
```

在调用宽度计算前，于构造函数中初始化 `currentText`。

- [ ] **步骤 4：为 M1 示例添加 selection 标签**

创建非交互式屏幕图层：

```ts
const selectionLayer = new ICEScreenLayer({
  id: 'selection-layer',
  order: 20,
  interactive: false,
});
const selectionLabel = new ICELabel({
  id: 'selection-label',
  text: '',
  screenPosition: [0, 0],
  color: '#e8f2fa',
  background: 'rgba(7, 20, 30, 0.94)',
  padding: 8,
});
selectionLabel.visible = false;
selectionLayer.addChild(selectionLabel);
engine.addLayer(selectionLayer);
```

跟踪 `selectedNode: ICENode | null`。在 `SELECTION_CHANGE` 时解析节点并调用：

```ts
selectedNode = selectedId ? handle?.scene.findByID(selectedId) ?? null : null;
selectionLabel.setText(selectedNode?.displayName ?? '');
selectionLabel.visible = Boolean(selectedNode);
status.textContent = selectedNode
  ? `已选中 ${selectedNode.displayName}`
  : '资产已加载';
```

在 `BEFORE_RENDER` 时投影 `selectedNode.getWorldPosition()`，将标签矩形钳制在视口内，并放置在投影点上方 24px。

资产销毁时，调用 `engine.setSelection([])`、隐藏标签并清除 `selectedNode`。

暴露：

```ts
selectedLabelText: () => selectionLabel.visible
  ? selectionLabel.text
  : undefined,
```

- [ ] **步骤 5：验证标签和 TypeScript**

运行：

```bash
npm test -- packages/runtime/tests/LayerOrder.test.ts
npm run typecheck:example
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add packages/runtime/src/layer/ICELabel.ts packages/runtime/tests/LayerOrder.test.ts examples/m1/main.ts examples/m1/global.d.ts
git commit -m "feat(example): label selected equipment"
```

---

### 任务 8：端到端验证 Selection 并记录行为

**文件：**
- 修改：`examples/m0/main.ts`
- 修改：`tests/e2e/m0.spec.ts`
- 修改：`tests/e2e/m1.spec.ts`
- 创建：`tests/e2e/selection-dpr.spec.ts`
- 修改：`docs/api/m0.md`
- 修改：`docs/api/m1.md`
- 修改：`README.md`

**接口：**
- 消费：`window.__ice3M1.selectedIds()`、`selectedLabelText()`、`scenePixelAtProjection()`、selection 诊断。
- 产出：点击、高亮、标签、清除、拖动和 DPR 行为的浏览器证据。

- [ ] **步骤 1：添加预期失败的端到端 selection 测试**

添加到 `tests/e2e/m1.spec.ts`：

```ts
test('selects one equipment unit with a label and cyan highlight', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  const before = await page.evaluate(() => window.__ice3M1.scenePixelAtProjection());

  await page.mouse.click(stage.x + center.x, stage.y + center.y);

  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  expect(await page.evaluate(() => window.__ice3M1.selectedLabelText()))
    .toBeTruthy();
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.scenePixelAtProjection()),
  ).not.toEqual(before);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().lastPickTimeMs,
  )).toBeGreaterThan(0);
});

test('clears selection on empty click and does not select while dragging', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');

  await page.mouse.move(stage.x + center.x, stage.y + center.y);
  await page.mouse.down();
  await page.mouse.move(stage.x + center.x + 40, stage.y + center.y, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__ice3M1.selectedIds())).toEqual([]);

  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  await page.mouse.click(stage.x + stage.width - 20, stage.y + 20);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(0);
  expect(await page.evaluate(() => window.__ice3M1.selectedLabelText()))
    .toBeUndefined();
});
```

创建 `tests/e2e/selection-dpr.spec.ts`：

```ts
import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

test('selects at the projected center with a two-times device scale', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
});
```

向 `examples/m0/main.ts` 添加合成重叠设备模式：

```ts
const overlapProbe = new URLSearchParams(window.location.search)
  .has('selection-probe');
if (overlapProbe) {
  block.visible = false;
  scene.addChild(new ICEMesh({
    id: 'far-large',
    position: [0, 0, -1],
    scale: [2, 2, 2],
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#166534' }),
  }));
  scene.addChild(new ICEMesh({
    id: 'near-small',
    position: [0, 0, 1],
    scale: [0.4, 0.4, 0.4],
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#2563eb' }),
  }));
}
```

添加到 `tests/e2e/m0.spec.ts`：

```ts
test('GPU picking selects the nearest overlapping device', async ({ page }) => {
  await page.goto('/?selection-probe=1');
  const center = await page.evaluate(() => window.__ice3M0.projection());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect(page.locator('[data-role="status"]')).toHaveText(
    '已选中 near-small',
  );
});
```

扩展 M0 上下文丢失测试，在恢复后点击探测中心，并断言选中 `near-small`。这会检验 picker 重建。

- [ ] **步骤 2：运行测试并验证行为不完整处的失败**

运行：

```bash
npm run test:e2e -- tests/e2e/m1.spec.ts --project=chromium --grep="selects one equipment|clears selection"
```

最终接线前的预期：在标签、高亮、清除断言处 FAIL，并给出聚焦错误。应修复生产代码，不得削弱断言。

- [ ] **步骤 3：记录公共行为**

添加到 `docs/api/m0.md`：

```md
Selection is committed on short click release, not pointer down. Camera drags
do not change the selection. `pick(point)` uses exact backend picking when the
active backend advertises that capability and otherwise uses the semantic
fallback used by tests.
```

添加到 `docs/api/m1.md`：

```md
For prepared assets, one named mesh node is one selectable equipment unit.
Multiple primitives from the same source node share one selection identity.
Short-clicking visible geometry highlights the equipment and shows its source
display name; clicking empty space clears the selection.
```

在 M1 README 中添加一条说明，介绍精确的设备点击选择和非破坏性青色高亮。

- [ ] **步骤 4：运行完整项目验证**

运行：

```bash
npm run verify
npm pack --workspaces --dry-run
```

预期：

- 架构测试通过
- TypeScript 和示例类型检查通过
- 所有 Node.js 测试通过
- 所有 Chromium 和 WebKit 测试通过
- workspace 包 dry-run 排除客户资产和报告

- [ ] **步骤 5：审计资产和名称**

运行：

```bash
git status --short --branch
git diff --check
git ls-files '*.glb' '*.gltf'
git status --short --ignored
```

对照已批准的合成 fixture 审查已跟踪模型列表。对照 `AGENTS.md` 中的名称法律规则审查每个已更改的文档和代码文件。预期：没有已跟踪的客户资产、临时输出或受限名称。

- [ ] **步骤 6：提交并合并**

```bash
git add examples/m0/main.ts tests/e2e/m0.spec.ts tests/e2e/m1.spec.ts tests/e2e/selection-dpr.spec.ts docs/api/m0.md docs/api/m1.md README.md
git commit -m "test: verify equipment selection"
git switch main
git merge --ff-only feature/equipment-selection
```

然后重启 M1 开发服务器，并通过被忽略的本地引用验证本地提供的模型，不得捕获或提交该模型。

## 相关文档

- `ICE3-ENG-IDX-001` — [文档索引](../README.md)
- `ICE3-ENG-SPEC-003` — [设备选择设计](../specs/2026-10-27-equipment-selection-design.md)
