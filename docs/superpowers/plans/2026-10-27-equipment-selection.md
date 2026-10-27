# Equipment Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add precise whole-equipment single selection with GPU picking, cyan rendering highlights, and a follow-along equipment name label.

**Architecture:** Selection identity lives on meshes and is propagated by prepared-asset scene construction. The WebGL2 backend renders a temporary RGBA8 identity image only when picking, while runtime input distinguishes short clicks from camera drags. The normal renderer then draws a non-destructive highlight overlay from the shared selection state.

**Tech Stack:** TypeScript, ESM, WebGL2, Canvas2D, node-test, Playwright, npm workspaces

**Spec:** `docs/superpowers/specs/2026-10-27-equipment-selection-design.md`

## Global Constraints

- Develop on one feature branch and merge to `main` only after `npm run verify` and `npm pack --workspaces --dry-run` pass.
- Use Node 24 LTS from `.nvmrc`.
- Keep public consumers on the `ice3` entry only.
- Do not expose WebGL objects through public APIs.
- Keep `@ice3/core` independent of DOM, Canvas, GPU, and sibling packages.
- Do not modify the prepared-asset format or toolchain.
- Use `selectionId` as the stable selection unit and `id` as the semantic object identity.
- Treat drags longer than 4 CSS pixels as camera gestures, not selection clicks.
- Use `#63d7ff` for selection accents and 16% opacity for surface tint.
- Never add a real customer model or derived file to tests, fixtures, screenshots, docs, commits, or packages.
- Use synthetic geometry or existing distributable fixtures for all automated selection tests.
- Do not introduce competitor or vendor product names anywhere.

## Review Focus

- A drag must never change selection, even if the pointer starts over a device.
- Overlapping geometry must select the nearest visible surface, not the nearest bounding box.
- Multiple render primitives from one source node must resolve to one equipment identity.
- Interactive 2D controls must block selection; the non-interactive operation hint must remain click-through.
- Picking must survive DPR changes, context restoration, empty pixels, and resource-allocation failures without breaking normal rendering.

## File Structure

**Create**

- `packages/renderer/src/WebGL2PickCodec.ts`: pure RGBA8 selection-index encoding and decoding.
- `packages/renderer/src/WebGL2Picker.ts`: offscreen WebGL2 identity target and click-time pick pass.
- `packages/runtime/src/input/ICESelectionGesture.ts`: click-vs-drag threshold logic.
- `packages/renderer/tests/PickCodec.test.ts`: codec boundaries and invalid values.
- `packages/runtime/tests/SelectionGesture.test.ts`: pointer movement threshold.

**Modify**

- `packages/core/src/scene/ICENode.ts`: `displayName`.
- `packages/core/src/scene/ICEMesh.ts`: `selectionId`.
- `packages/core/tests/Scene.test.ts`: core metadata behavior.
- `packages/core/tests/Serialization.test.ts`: metadata round-trip.
- `packages/runtime/src/asset/ICEAssetSceneBuilder.ts`: propagate prepared names and selection identities.
- `packages/runtime/tests/AssetSceneBuilder.test.ts`: asset grouping behavior.
- `packages/renderer/src/types.ts`: pick capability, screen point, selection frame data.
- `packages/renderer/src/FakeRendererBackend.ts`: new capabilities and test pick result.
- `packages/renderer/src/WebGL2RendererBackend.ts`: pick delegation, overlay pass, picker lifetime.
- `packages/renderer/tests/BackendContract.test.ts`: capability contract.
- `packages/renderer/tests/WebGL2GeometryBatch.test.ts`: stable selection identity.
- `packages/runtime/src/ICE3.ts`: click selection, diagnostics, frame selection.
- `packages/runtime/src/layer/ICELabel.ts`: mutable text without label recreation.
- `packages/runtime/tests/LayerOrder.test.ts`: text-update measurement.
- `examples/m1/main.ts`: selection label and selected-name status.
- `examples/m1/global.d.ts`: E2E selection probes.
- `tests/e2e/m0.spec.ts`: drag must not select.
- `tests/e2e/m1.spec.ts`: click, highlight, label, clear, and drag selection tests.
- `docs/api/m0.md`: shared click semantics and diagnostics.
- `docs/api/m1.md`: equipment selection behavior.

---

### Task 1: Add Equipment Metadata to Core Objects

**Files:**
- Modify: `packages/core/src/scene/ICENode.ts`
- Modify: `packages/core/src/scene/ICEMesh.ts`
- Test: `packages/core/tests/Scene.test.ts`
- Test: `packages/core/tests/Serialization.test.ts`

**Interfaces:**
- Consumes: existing `ICENodeOptions`, `ICEMeshOptions`, serialization helpers.
- Produces: `ICENodeOptions.displayName?: string`; `ICENode.displayName: string`; `ICEMeshOptions.selectionId?: string`; `ICEMesh.selectionId: string`.

- [ ] **Step 1: Write failing metadata tests**

Add to `packages/core/tests/Scene.test.ts`:

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

Add to `packages/core/tests/Serialization.test.ts`:

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

- [ ] **Step 2: Verify tests fail for missing APIs**

Run:

```bash
npx node-test run packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
```

Expected: FAIL because `displayName` and `selectionId` do not exist.

- [ ] **Step 3: Implement core metadata and serialization**

In `ICENode` add:

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

In `ICEMesh` add:

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

Update `ICEMesh.fromJSON` with these fields:

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

- [ ] **Step 4: Run tests to verify the task**

Run:

```bash
npx node-test run packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scene/ICENode.ts packages/core/src/scene/ICEMesh.ts packages/core/tests/Scene.test.ts packages/core/tests/Serialization.test.ts
git commit -m "feat(core): add equipment selection metadata"
```

---

### Task 2: Propagate Prepared Names and Equipment Groups

**Files:**
- Modify: `packages/runtime/src/asset/ICEAssetSceneBuilder.ts`
- Test: `packages/runtime/tests/AssetSceneBuilder.test.ts`

**Interfaces:**
- Consumes: `ICEPreparedNode.name`, `ICEPreparedMesh.node`, `ICEMesh.selectionId`.
- Produces: imported mesh nodes with `displayName = source.name` and all source-node primitives sharing `selectionId = source.id`.

- [ ] **Step 1: Write failing scene-builder tests**

Add:

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

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npx node-test run packages/runtime/tests/AssetSceneBuilder.test.ts
```

Expected: FAIL because the builder ignores prepared names and does not set a shared selection identity.

- [ ] **Step 3: Implement propagation**

For the first mesh on a node:

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

For every additional mesh on the same source node:

```ts
new ICEMesh({
  id: mesh.id,
  displayName: source.name,
  selectionId: source.id,
  geometry,
  material,
})
```

- [ ] **Step 4: Verify task tests and all runtime tests**

Run:

```bash
npx node-test run packages/runtime/tests/AssetSceneBuilder.test.ts
npx node-test run packages/runtime
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/asset/ICEAssetSceneBuilder.ts packages/runtime/tests/AssetSceneBuilder.test.ts
git commit -m "feat(assets): group prepared primitives by equipment"
```

---

### Task 3: Add Selection Frame Data and RGBA8 Identity Codec

**Files:**
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/FakeRendererBackend.ts`
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Create: `packages/renderer/src/WebGL2PickCodec.ts`
- Create: `packages/renderer/tests/PickCodec.test.ts`
- Modify: `packages/renderer/tests/BackendContract.test.ts`

**Interfaces:**
- Produces: `ICEScreenPoint = Readonly<{ x: number; y: number }>`.
- Produces: `ICEFrame.selection: readonly string[]`.
- Produces: `ICERendererCapabilities.picking: boolean`.
- Produces: `ICERendererBackend.pick?(frame, point): string | undefined`.
- Produces: `encodeSelectionIndex(index): readonly [number, number, number, 255]` and `decodeSelectionIndex(pixel): number | undefined`.

- [ ] **Step 1: Write failing codec and contract tests**

Create `packages/renderer/tests/PickCodec.test.ts`:

```ts
import { expect, it } from 'node-test';
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

Add to `BackendContract.test.ts`:

```ts
it('declares whether the backend supports exact picking', () => {
  expect(new FakeRendererBackend().capabilities.picking).toBe(false);
  expect(new WebGL2RendererBackend().capabilities.picking).toBe(true);
});
```

Update every fake frame fixture with `selection: []`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx node-test run packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
```

Expected: FAIL because the codec and capability do not exist.

- [ ] **Step 3: Implement types and codec**

In `types.ts`:

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

Create `WebGL2PickCodec.ts`:

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

Set `picking: false` on the fake backend and `picking: true` on the WebGL2 backend.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx node-test run packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
npm run typecheck
```

Before running, update the frame fixtures in `BackendContract.test.ts` and `ICE3.renderFrame()` with `selection: []` or the live selection array. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/types.ts packages/renderer/src/FakeRendererBackend.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/WebGL2PickCodec.ts packages/renderer/tests/PickCodec.test.ts packages/renderer/tests/BackendContract.test.ts
git commit -m "feat(renderer): define pickup frame contract"
```

---

### Task 4: Implement Offscreen WebGL2 Picking

**Files:**
- Create: `packages/renderer/src/WebGL2Picker.ts`
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Modify: `packages/renderer/src/WebGL2Program.ts`
- Modify: `packages/runtime/src/ICE3.ts`
- Test: browser selection tests in Task 8

**Interfaces:**
- Consumes: `WebGL2Program`, `WebGL2GeometryCache`, `collectRenderables`, `encodeSelectionIndex`, `decodeSelectionIndex`.
- Produces: `ICEPickFrame`; `new WebGL2Picker(gl)`; `picker.pick(frame: ICEPickFrame, geometryCache, renderables): string | undefined`.

- [ ] **Step 1: Add a failing renderer capability assertion**

Extend `tests/e2e/m1.spec.ts` with a probe that checks the real backend advertises picking:

```ts
expect(await page.evaluate(
  () => window.__ice3M1.diagnostics().backend.picking,
)).toBe(true);
```

Run:

```bash
npm run test:e2e -- tests/e2e/m1.spec.ts --project=chromium --grep="prepared industrial asset"
```

Expected: FAIL because diagnostics do not yet expose `picking`.

- [ ] **Step 2: Implement the picker**

Create `WebGL2Picker.ts` with these exact responsibilities:

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

Immediately before `readPixels`, add:

```ts
gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
```

Use `this.releaseTarget()` in `dispose()` before disposing the program so resources are deleted exactly once.

- [ ] **Step 3: Delegate backend picking**

In `WebGL2RendererBackend`:

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

Create the picker in `createProgram`, delete it on context loss, recreate it on context restore, and dispose it in `dispose`.

Change `WebGL2Program` fragment precision from `mediump` to `highp` so RGB byte identities remain distinct across WebGL2 implementations.

Extend the declared diagnostics backend shape so the browser probe can read the
new capability without a cast:

```ts
readonly backend: Readonly<{
  backend: 'webgl2' | 'fake';
  maxTextureSize: number;
  picking: boolean;
}>;
```

- [ ] **Step 4: Verify renderer tests**

Run:

```bash
npx node-test run packages/renderer
npm run typecheck
```

Expected: PASS. The browser assertion remains failing until runtime diagnostics include backend capabilities.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/WebGL2Picker.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/WebGL2Program.ts tests/e2e/m1.spec.ts
git commit -m "feat(renderer): add GPU equipment picking"
```

---

### Task 5: Render Non-Destructive Selection Highlights

**Files:**
- Modify: `packages/renderer/src/WebGL2GeometryBatch.ts`
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Test: `packages/renderer/tests/WebGL2GeometryBatch.test.ts`
- Test: `tests/e2e/m1.spec.ts`

**Interfaces:**
- Consumes: `ICEFrame.selection`, `ICEMesh.selectionId`.
- Produces: `selectionIdentity(mesh: ICEMesh): string`.

- [ ] **Step 1: Write failing selection-identity test**

Add:

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

Run:

```bash
npx node-test run packages/renderer/tests/WebGL2GeometryBatch.test.ts
```

Expected: FAIL because `selectionIdentity` does not exist.

- [ ] **Step 2: Implement highlight pass**

Export from `WebGL2GeometryBatch.ts`:

```ts
export const selectionIdentity = (mesh: ICEMesh): string => mesh.selectionId;
```

Change `render(frame)` to collect renderables once. After all normal meshes are drawn and before `geometryCache.endFrame()`:

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

The variables `renderables`, `mvp`, `world`, `viewProjection`, `clipPixelX`, and `clipPixelY` are the same values already created by the normal render loop; do not recalculate them a second time.

Pass the existing `frame.selection` into the render call in `ICE3`, using `this.interaction.getSelection()`. Keep `geometryCache.beginFrame()` before the main loop and `geometryCache.endFrame()` after the highlight pass.

- [ ] **Step 3: Verify renderer tests**

Run:

```bash
npx node-test run packages/renderer
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/WebGL2GeometryBatch.ts packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/tests/WebGL2GeometryBatch.test.ts
git commit -m "feat(renderer): highlight selected equipment"
```

---

### Task 6: Select on Click and Preserve Camera Drag

**Files:**
- Create: `packages/runtime/src/input/ICESelectionGesture.ts`
- Create: `packages/runtime/tests/SelectionGesture.test.ts`
- Modify: `packages/runtime/src/ICE3.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/ice3/src/index.ts`
- Modify: `packages/renderer/src/FakeRendererBackend.ts`
- Modify: `packages/runtime/tests/Projection.test.ts`
- Modify: `tests/e2e/m0.spec.ts`

**Interfaces:**
- Consumes: `ICE3.pick(point)`, `ICERendererCapabilities.picking`, `ICERendererBackend.pick`.
- Produces: `SELECTION_CLICK_THRESHOLD_PX = 4`; `isSelectionClick(start, end): boolean`; `selectionForOutcome(outcome): readonly string[] | undefined`.
- Produces diagnostics: `selectionCount`, `lastPickTimeMs`, `lastPickId`.

- [ ] **Step 1: Write failing gesture tests**

Create `packages/runtime/tests/SelectionGesture.test.ts`:

```ts
import { expect, it } from 'node-test';
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

Update the M0 drag browser test to move away beyond the threshold, return to
the start point, release, and expect the initial status remains `运行` and
`selectedIds` stays empty.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx node-test run packages/runtime/tests/SelectionGesture.test.ts
npm run test:e2e -- tests/e2e/m0.spec.ts --project=chromium --grep="mouse drag"
```

Expected: gesture module missing; drag currently selects `demo-block`.

- [ ] **Step 3: Implement click selection**

Create:

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

In `ICE3`, add pointer gesture state:

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

On pointer down, call `inputRouter.pointerDown` and store its returned target
with `dragged: false`. On every move, route the move and set `dragged = true`
as soon as `isSelectionClick(start, point)` becomes false. Dragging therefore
stays a drag even if the pointer later returns near its start. On pointer up:

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

Remove selection from `dispatchInput`. Clear gestures on `pointercancel`, window blur, stop, and destroy.

Change the input router’s `pickScene` callback to return `{ kind: 'scene' }` without running a pick. This keeps pointer-down routing cheap and defers exact GPU picking to pointer-up.

Add the internal result type:

```ts
type ICEPickResult =
  | { readonly kind: 'hit'; readonly node: ICENode }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' };
```

Update `FakeRendererBackend` with:

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

Keep capabilities `picking: false` by default so existing CPU-picker tests
continue to use `pickSceneNode`.

- [ ] **Step 4: Route semantic `pick()` through GPU**

Add diagnostics fields `selectionCount`, `lastPickTimeMs`, `lastPickId`, then implement:

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

The `{ kind: 'error' }` branch deliberately returns `undefined` from
`selectionForOutcome`, so pointer-up leaves the current selection unchanged
while `samplePick` records `ICE3_PICK_UNAVAILABLE`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx node-test run packages/runtime/tests/SelectionGesture.test.ts packages/runtime/tests/Projection.test.ts
npm run test:e2e -- tests/e2e/m0.spec.ts --project=chromium --grep="mouse drag"
npm run typecheck
```

Expected: PASS; drag rotates without selection, normal click still selects.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/input/ICESelectionGesture.ts packages/runtime/src/ICE3.ts packages/runtime/src/index.ts packages/ice3/src/index.ts packages/renderer/src/FakeRendererBackend.ts packages/runtime/tests/SelectionGesture.test.ts packages/runtime/tests/Projection.test.ts tests/e2e/m0.spec.ts
git commit -m "feat(runtime): select equipment on click"
```

---

### Task 7: Add Selection Name Label to the M1 Example

**Files:**
- Modify: `packages/runtime/src/layer/ICELabel.ts`
- Modify: `packages/runtime/tests/LayerOrder.test.ts`
- Modify: `examples/m1/main.ts`
- Modify: `examples/m1/global.d.ts`

**Interfaces:**
- Consumes: `ICENode.displayName`, `SELECTION_CHANGE`, `ICEScreenLayer`, `ICELabel`.
- Produces: `ICELabel.setText(text: string): this`.
- Produces: `window.__ice3M1.selectedLabelText(): string | undefined`.

- [ ] **Step 1: Write failing label test**

Add:

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

- [ ] **Step 2: Verify RED**

Run:

```bash
npx node-test run packages/runtime/tests/LayerOrder.test.ts
```

Expected: FAIL because `setText` does not exist.

- [ ] **Step 3: Implement mutable label text**

Replace the public readonly field with:

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

Initialize `currentText` in the constructor before calling the width calculation.

- [ ] **Step 4: Add the selection label to the M1 example**

Create a non-interactive screen layer:

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

Track `selectedNode: ICENode | null`. On `SELECTION_CHANGE`, resolve the node and call:

```ts
selectedNode = selectedId ? handle?.scene.findByID(selectedId) ?? null : null;
selectionLabel.setText(selectedNode?.displayName ?? '');
selectionLabel.visible = Boolean(selectedNode);
status.textContent = selectedNode
  ? `已选中 ${selectedNode.displayName}`
  : '资产已加载';
```

On `BEFORE_RENDER`, project `selectedNode.getWorldPosition()`, clamp the label rect inside the viewport, and place it 24px above the projected point.

When the asset is disposed, call `engine.setSelection([])`, hide the label, and clear `selectedNode`.

Expose:

```ts
selectedLabelText: () => selectionLabel.visible
  ? selectionLabel.text
  : undefined,
```

- [ ] **Step 5: Verify label and TypeScript**

Run:

```bash
npx node-test run packages/runtime/tests/LayerOrder.test.ts
npm run typecheck:example
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/layer/ICELabel.ts packages/runtime/tests/LayerOrder.test.ts examples/m1/main.ts examples/m1/global.d.ts
git commit -m "feat(example): label selected equipment"
```

---

### Task 8: Verify Selection End to End and Document Behavior

**Files:**
- Modify: `examples/m0/main.ts`
- Modify: `tests/e2e/m0.spec.ts`
- Modify: `tests/e2e/m1.spec.ts`
- Create: `tests/e2e/selection-dpr.spec.ts`
- Modify: `docs/api/m0.md`
- Modify: `docs/api/m1.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `window.__ice3M1.selectedIds()`, `selectedLabelText()`, `scenePixelAtProjection()`, selection diagnostics.
- Produces: browser evidence for click, highlight, label, clear, drag, and DPR behavior.

- [ ] **Step 1: Add failing end-to-end selection tests**

Add to `tests/e2e/m1.spec.ts`:

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

Create `tests/e2e/selection-dpr.spec.ts`:

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

Add a synthetic overlapping-device mode to `examples/m0/main.ts`:

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

Add to `tests/e2e/m0.spec.ts`:

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

Extend the context-loss M0 test to click the probe center after restoration
and assert `near-small` is selected. This exercises picker recreation.

- [ ] **Step 2: Run tests and verify failures where behavior is incomplete**

Run:

```bash
npm run test:e2e -- tests/e2e/m1.spec.ts --project=chromium --grep="selects one equipment|clears selection"
```

Expected before final wiring: FAIL at label/highlight/clear assertions with focused errors. Fix production code rather than weakening the assertions.

- [ ] **Step 3: Document the public behavior**

Add to `docs/api/m0.md`:

```md
Selection is committed on short click release, not pointer down. Camera drags
do not change the selection. `pick(point)` uses exact backend picking when the
active backend advertises that capability and otherwise uses the semantic
fallback used by tests.
```

Add to `docs/api/m1.md`:

```md
For prepared assets, one named mesh node is one selectable equipment unit.
Multiple primitives from the same source node share one selection identity.
Short-clicking visible geometry highlights the equipment and shows its source
display name; clicking empty space clears the selection.
```

Add an M1 README bullet for precise equipment click selection and non-destructive
cyan highlighting.

- [ ] **Step 4: Run the complete project verification**

Run:

```bash
npm run verify
npm pack --workspaces --dry-run
```

Expected:

- architecture tests pass
- TypeScript and example type checks pass
- all node-test tests pass
- all Chromium and WebKit tests pass
- workspace package dry-runs exclude customer assets and reports

- [ ] **Step 5: Audit assets and names**

Run:

```bash
git status --short --branch
git diff --check
git ls-files '*.glb' '*.gltf'
git status --short --ignored
```

Review the tracked model list against the approved synthetic fixtures. Review
every changed doc and code file against the legal-name rules in `AGENTS.md`.
Expected: no tracked customer assets, scratch output, or restricted names.

- [ ] **Step 6: Commit and merge**

```bash
git add examples/m0/main.ts tests/e2e/m0.spec.ts tests/e2e/m1.spec.ts tests/e2e/selection-dpr.spec.ts docs/api/m0.md docs/api/m1.md README.md
git commit -m "test: verify equipment selection"
git switch main
git merge --ff-only feature/equipment-selection
```

Then restart the M1 development server and verify the locally supplied model through the ignored local reference without capturing or committing it.
