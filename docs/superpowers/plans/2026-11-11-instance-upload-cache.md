# Instance Upload Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop re-uploading unchanged WebGL2 instance matrices, opacity and semantic indices, and update changed instance data with bounded buffer ranges.

**Architecture:** Extend the existing private `WebGL2InstanceCache` entry with copies of the last uploaded arrays and per-cache upload statistics. `retain()` will compare arrays, skip identical uploads, use `bufferSubData()` for an unchanged-length contiguous dirty span, and fall back to `bufferData()` when the instance count changes. Public scene and geometry APIs remain unchanged.

**Tech Stack:** TypeScript 7, Node.js 24.22.1, WebGL2, Node test runner

**Spec:** `../ice3-city/docs/superpowers/specs/2026-11-11-traffic-wasm-performance-design.md`

## Global Constraints

- Use Node.js `24.22.1`.
- Do not change public Scene, Mesh or Material behavior.
- Do not alter batch grouping order or selection identity.
- Preserve WebGL2 and WebGPU behavior.
- Keep the renderer’s dependency-free public facade.
- Commit Git author and committer names must be `damoqiongqiu`.

## Review Focus

- A static batch must issue no buffer update after the first upload.
- A one-instance matrix change must update only the smallest correct contiguous range.
- An instance-count change must use a full allocation and must not read stale tail data.
- An opacity-only change must upload the opacity buffer, not the matrix or semantic buffers.
- A semantic-only change must upload the semantic buffer, not the matrix or opacity buffers.

---

## File Structure

- Modify `packages/renderer/src/WebGL2InstanceBatch.ts`: array snapshots, change detection,
  ranged uploads and statistics.
- Modify `packages/renderer/tests/WebGL2InstanceBatch.test.ts`: GPU-call recording tests.
- Modify `packages/renderer/src/WebGL2RendererBackend.ts`: collect per-frame upload statistics.
- Modify `packages/renderer/src/types.ts`: add the required upload fields to the renderer stats
  contract.
- Modify `packages/runtime/src/ICE3.ts`: expose additive renderer diagnostics.
- Modify `docs/api/m1.md` and `docs/guides/development-and-troubleshooting.md`: document the new
  diagnostics and what they prove.

### Task 1: Add exact change detection and ranged uploads

**Files:**
- Modify: `packages/renderer/src/WebGL2InstanceBatch.ts`
- Modify: `packages/renderer/tests/WebGL2InstanceBatch.test.ts`

**Interfaces:**
- Consumes: `ICEInstanceBatch`
- Produces:
  - `WebGL2InstanceUploadStats`
  - `WebGL2InstanceCache.uploadStats`
  - additive `WebGL2InstanceEntry` private snapshot fields

- [ ] **Step 1: Write failing static-batch upload tests**

Replace the existing `fakeWebGL2()` helper with one that records uploads:

```ts
type UploadCall =
  | { readonly kind: 'data'; readonly bytes: number }
  | {
    readonly kind: 'subdata';
    readonly byteOffset: number;
    readonly bytes: number;
  };

function recordingWebGL2(calls: UploadCall[]): WebGL2RenderingContext {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    UNSIGNED_INT: 0x1405,
    DYNAMIC_DRAW: 0x88e8,
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    deleteVertexArray: () => undefined,
    deleteBuffer: () => undefined,
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: (_target, data) => {
      calls.push({
        kind: 'data',
        bytes: data instanceof ArrayBuffer
          ? data.byteLength
          : data.byteLength,
      });
    },
    bufferSubData: (_target, byteOffset, data) => {
      calls.push({
        kind: 'subdata',
        byteOffset,
        bytes: data instanceof ArrayBuffer
          ? data.byteLength
          : data.byteLength,
      });
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    vertexAttribDivisor: () => undefined,
  } as unknown as WebGL2RenderingContext;
}

function triangleGeometry(id: string): ICEIndexedGeometry {
  return new ICEIndexedGeometry({
    id,
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

function fakeGeometryCache(
  geometry: ICEIndexedGeometry,
): import('../src/WebGL2GeometryCache.js').WebGL2GeometryCache {
  return {
    retain: () => ({
      vertexArray: {} as WebGLVertexArrayObject,
      positionBuffer: {} as WebGLBuffer,
      triangleIndexBuffer: {} as WebGLBuffer,
      edgeIndexBuffer: null,
      colorBuffer: null,
      semanticBuffer: null,
      triangleCount: geometry.indices.length,
      edgeCount: 0,
      bytes: 0,
    }),
  } as unknown as import('../src/WebGL2GeometryCache.js').WebGL2GeometryCache;
}

function instanceBatch(
  geometry: ICEIndexedGeometry,
  material: ICEBasicMaterial,
  translations: readonly number[],
): ICEInstanceBatch {
  const instanceMatrices = new Float32Array(translations.length * 16);
  translations.forEach((translation, index) => {
    const offset = index * 16;
    instanceMatrices[offset] = 1;
    instanceMatrices[offset + 5] = 1;
    instanceMatrices[offset + 10] = 1;
    instanceMatrices[offset + 12] = translation;
    instanceMatrices[offset + 15] = 1;
  });
  return {
    id: `instance:${geometry.id}`,
    geometry,
    material,
    instanceMatrices,
    instanceOpacity: new Float32Array(translations.length).fill(1),
    semanticIds: translations.map((_value, index) => `selection-${index}`),
    semanticIndices: Uint32Array.from(
      { length: translations.length },
      (_value, index) => index,
    ),
    meshIds: translations.map((_value, index) => `mesh-${index}`),
    materialKey: material.color,
  };
}
```

Add:

```ts
test('skips all uploads when an instance batch is unchanged', () => {
  const geometry = triangleGeometry('cache-static');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  const batch = instanceBatch(geometry, material, [0, 4]);

  cache.retain(gl, fakeGeometryCache(geometry), batch);
  const afterFirst = calls.length;
  cache.retain(gl, fakeGeometryCache(geometry), batch);

  expect(calls.length).toBe(afterFirst);
  expect(cache.uploadStats.skippedBatches).toBe(1);
  expect(cache.uploadStats.bytes).toBe(0);
});
```

- [ ] **Step 2: Write failing ranged-change tests**

Add:

```ts
test('uploads only the changed matrix span', () => {
  const geometry = triangleGeometry('cache-range');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  const first = instanceBatch(geometry, material, [0, 4, 8]);
  const second = instanceBatch(geometry, material, [0, 4, 8]);
  second.instanceMatrices[17] = 3;

  cache.retain(gl, fakeGeometryCache(geometry), first);
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), second);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 17 * 4,
    bytes: 4,
  }]);
  expect(cache.uploadStats.bytes).toBe(4);
});

test('full uploads when the instance count changes', () => {
  const geometry = triangleGeometry('cache-resize');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(gl, fakeGeometryCache(geometry), instanceBatch(geometry, material, [0, 4]));
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), instanceBatch(geometry, material, [0]));

  expect(calls.some((call) => call.kind === 'data')).toBe(true);
  expect(cache.uploadStats.fullUploads).toBe(1);
});

test('uploads only opacity when opacity changes', () => {
  const geometry = triangleGeometry('cache-opacity');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(
    gl,
    fakeGeometryCache(geometry),
    instanceBatch(geometry, material, [0, 4]),
  );
  const changed = instanceBatch(geometry, material, [0, 4]);
  changed.instanceOpacity[1] = 0.5;
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), changed);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 4,
    bytes: 4,
  }]);
});

test('uploads only semantic indices when selection changes', () => {
  const geometry = triangleGeometry('cache-semantic');
  const material = new ICEBasicMaterial({ color: '#ffb000' });
  const calls: UploadCall[] = [];
  const gl = recordingWebGL2(calls);
  const cache = new WebGL2InstanceCache();
  cache.retain(
    gl,
    fakeGeometryCache(geometry),
    instanceBatch(geometry, material, [0, 4]),
  );
  const changed = instanceBatch(geometry, material, [0, 4]);
  changed.semanticIndices[1] = 9;
  calls.length = 0;
  cache.retain(gl, fakeGeometryCache(geometry), changed);

  expect(calls).toEqual([{
    kind: 'subdata',
    byteOffset: 4,
    bytes: 4,
  }]);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node --import tsx --test packages/renderer/tests/WebGL2InstanceBatch.test.ts
```

Expected: FAIL because the fake context has no upload definitions/statistics and unchanged
batches still call `bufferData()`.

- [ ] **Step 4: Add cache snapshots and statistics**

Add:

```ts
export type WebGL2InstanceUploadStats = {
  readonly calls: number;
  readonly bytes: number;
  readonly skippedBatches: number;
  readonly fullUploads: number;
  readonly rangedUploads: number;
};
```

Private entry fields:

```ts
matrixSnapshot: Float32Array;
opacitySnapshot: Float32Array;
semanticSnapshot: Uint32Array;
```

Cache fields:

```ts
private stats = {
  calls: 0,
  bytes: 0,
  skippedBatches: 0,
  fullUploads: 0,
  rangedUploads: 0,
};

get uploadStats(): Readonly<WebGL2InstanceUploadStats> {
  return this.stats;
}
```

- [ ] **Step 5: Implement the bounded range helper**

Add:

```ts
function changedFloatRange(
  previous: Float32Array,
  next: Float32Array,
): readonly [number, number] | null {
  let first = -1;
  let last = -1;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] === next[index]) continue;
    if (first < 0) first = index;
    last = index;
  }
  return first < 0 ? null : [first, last + 1];
}

function changedUintRange(
  previous: Uint32Array,
  next: Uint32Array,
): readonly [number, number] | null {
  let first = -1;
  let last = -1;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] === next[index]) continue;
    if (first < 0) first = index;
    last = index;
  }
  return first < 0 ? null : [first, last + 1];
}
```

- [ ] **Step 6: Implement upload decisions**

For an existing entry with unchanged multiplication count:

1. Compute each changed range.
2. If all ranges are `null`, increment `skippedBatches` and return the existing entry.
3. For each changed range, call `bufferSubData` with `range[0] * BYTES_PER_ELEMENT` and
   `next.subarray(range[0], range[1])`.
4. Replace the corresponding snapshot with `next.slice()`.
5. Add `calls`, uploaded bytes, and `rangedUploads` to statistics.

For a new entry or changed instance count, use the existing `bufferData()` calls, store all
three snapshots, and increment `fullUploads`.

Reset statistics in `beginFrame()`. Do not reset snapshots there.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --import tsx --test packages/renderer/tests/WebGL2InstanceBatch.test.ts
```

Expected: PASS, including existing instance-count and byte-footprint tests.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/WebGL2InstanceBatch.ts packages/renderer/tests/WebGL2InstanceBatch.test.ts
git commit -m "perf(renderer): upload only changed instance data"
```

### Task 2: Expose per-frame upload diagnostics

**Files:**
- Modify: `packages/renderer/src/WebGL2RendererBackend.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/runtime/src/ICE3.ts`
- Modify: `packages/runtime/tests/EngineLifecycle.test.ts`
- Modify: `packages/renderer/tests/WebGL2RendererBackend.test.ts`

**Interfaces:**
- Consumes: `WebGL2InstanceCache.uploadStats`
- Produces: additive `renderer.instanceUploads` and `renderer.instanceUploadBytes`

- [ ] **Step 1: Write a failing stats test**

Add to the backend stats test:

```ts
expect(typeof stats.renderer.instanceUploads).toBe('number');
expect(typeof stats.renderer.instanceUploadBytes).toBe('number');
expect(stats.renderer.instanceUploads >= 0).toBe(true);
expect(stats.renderer.instanceUploadBytes >= 0).toBe(true);
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --import tsx --test packages/renderer/tests/WebGL2RendererBackend.test.ts
```

Expected: FAIL because the two fields are missing.

- [ ] **Step 3: Publish frame statistics**

In `WebGL2RendererBackend`, initialize both frame fields to zero and copy
`this.instanceCache!.uploadStats` after the main pass and picker/depth passes settle for the
frame. Use the final cumulative frame value rather than sampling between passes.

Add the fields to `ICERendererStats` as required numbers so fake renderers report zero.

- [ ] **Step 4: Verify runtime diagnostics**

Add assertions to the runtime lifecycle test that `getDiagnostics().renderer` contains both
fields and that a fresh frame reports non-negative values.

- [ ] **Step 5: Run renderer and runtime tests**

Run:

```bash
node --import tsx --test packages/renderer/tests/WebGL2RendererBackend.test.ts
node --import tsx --test packages/runtime/tests/EngineLifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/WebGL2RendererBackend.ts packages/renderer/src/types.ts packages/runtime/src/ICE3.ts packages/runtime/tests/EngineLifecycle.test.ts packages/renderer/tests/WebGL2RendererBackend.test.ts
git commit -m "feat(renderer): report instance upload diagnostics"
```

### Task 3: Document and verify the optimization

**Files:**
- Modify: `docs/api/m1.md`
- Modify: `docs/guides/development-and-troubleshooting.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: diagnostics from Task 2
- Produces: operator-facing explanation and verification instructions

- [ ] **Step 1: Document the diagnostic meaning**

Add:

```text
renderer.instanceUploads:
  Number of uploaded instance array ranges in this frame.

renderer.instanceUploadBytes:
  Number of bytes sent to instance buffers in this frame.

Expected static scene:
  After the first frame, instanceUploadBytes is 0 while the camera moves.

Expected animated batch:
  Only the changed matrix/opacity span is uploaded.
```

Explain that zero upload bytes do not mean zero draw calls and do not prove the scene changed.

- [ ] **Step 2: Run the full engine gate**

Run:

```bash
npm run build
npm test
npm run test:architecture
npm run typecheck
```

Expected: all tests pass.

- [ ] **Step 3: Run the Chrome integration check**

Start the city viewer from the city worktree:

```bash
npm run dev
```

Open the URL in the user's installed Google Chrome. Use `?demo=1&size=96`, wait for the city
to settle, then inspect diagnostics while rotating the camera:

- `renderedInstances` remains stable.
- `instanceUploadBytes` falls to zero for static batches.
- Traffic movement produces bounded positive uploads without frame spikes.

- [ ] **Step 4: Commit**

```bash
git add docs/api/m1.md docs/guides/development-and-troubleshooting.md README.md
git commit -m "docs(renderer): explain instance upload diagnostics"
```

## Self-Review

- Spec coverage: Tasks 1–2 implement upload suppression, bounded ranged updates and
  diagnostics; Task 3 covers documentation and real-Chrome verification.
- Placeholder scan: every upload branch and test has concrete arrays, ranges and assertions.
- Type consistency: `WebGL2InstanceUploadStats` is produced in Task 1 and consumed in Task 2;
  `instanceUploadBytes` is the diagnostic name in Tasks 2–3.
- Review focus: static, one-matrix, count-change, opacity-only and semantic-only cases are
  covered by Task 1.
