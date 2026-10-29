# ICE3 Diagnostics

> Document ID: ICE3-ENG-REF-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers
Diagnostics use stable codes. Callers should branch on `code`, not on message text.

## Engine and target

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_INVALID_TARGET` | Selector resolves to no element, a canvas has no parent, or a canvas cannot be created | Provide a connected host element |
| `ICE3_ALREADY_INITIALIZED` | `init()` is called more than once on one engine | Create a new engine after `destroy()` |
| `ICE3_ENGINE_NOT_READY` | Rendering is requested without a scene or camera, or a backend method runs before initialization | Complete scene, camera, and initialization configuration |
| `ICE3_ENGINE_DESTROYED` | A backend or engine operation runs after disposal | Stop using the instance and create a replacement |
| `ICE3_CONTEXT_LOST` | The browser loses the GPU context | Keep the app visible, wait for restoration, and inspect the event |
| `ICE3_CONTEXT_RESTORED` | The browser restores the GPU context and the engine can draw again | Resume normal operation and verify a new frame |

## Scene and layers

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_DUPLICATE_OBJECT_ID` | A scene node reuses an existing ID without being the same object | Assign a unique stable ID |
| `ICE3_SCENE_CYCLE` | A parent-child operation would form a cycle | Restructure the node hierarchy |
| `ICE3_LAYER_ORDER_CONFLICT` | A layer conflicts with an existing layer identity | Use one stable ID per layer |
| `ICE3_UNKNOWN_ANCHOR` | A world label references an ID absent from the active scene | Correct the anchor ID or add the target node |
| `ICE3_UNKNOWN_TYPE` | Deserialization finds an unregistered type ID | Register the type before loading |
| `ICE3_INVALID_NODE_DATA` | Deserialization finds malformed data for a registered node type | Repair the snapshot or migrate it to the current schema |

## Assets

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_ASSET_FETCH_FAILED` | Asset network request fails | Check the URL, network, and permissions |
| `ICE3_ASSET_ABORTED` | The supplied abort signal cancels loading | Retry only if the caller starts a new request |
| `ICE3_ASSET_INVALID_GLB` | GLB framing, scene graph, or required profile fields are invalid | Regenerate the asset with the toolchain |
| `ICE3_ASSET_PROFILE_UNSUPPORTED` | GLB is not a supported ICE3 prepared profile | Process the source model with the toolchain |
| `ICE3_ASSET_ACCESSOR_INVALID` | Accessor type, alignment, range, or indices violate the profile | Regenerate the prepared GLB |
| `ICE3_ASSET_UNSUPPORTED_FEATURE` | The profile contains animation, texture, camera, light, or another M1-forbidden feature | Re-export only the supported scene subset |
| `ICE3_ASSET_DUPLICATE_ID` | Node or mesh semantic IDs collide | Regenerate deterministic IDs with the toolchain |
| `ICE3_ASSET_INTEGRITY_FAILED` | Explicit BIN digest verification fails | Rebuild or redownload the asset |
| `ICE3_ASSET_CONTRACT_MISSING` | A legacy prepared asset has no collaboration contract | Rebuild with a current toolchain when possible |
| `ICE3_ASSET_CONTRACT_UNSUPPORTED` | Contract version or budget metadata is unsupported | Rebuild with a compatible toolchain/runtime pair |
| `ICE3_ASSET_STATS_MISMATCH` | Embedded asset stats differ from the prepared structure | Rebuild the asset and inspect toolchain output |
| `ICE3_ASSET_BATCH_INVALID` | Batch metadata, semantic arrays, primitive references, or semantic indices are invalid | Regenerate the static batches with the current toolchain |
| `ICE3_TOOL_RUNTIME_CONVERSION_REQUIRED` | Asset declares that runtime conversion is required | Move conversion into the external toolchain |

## Tilesets

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_TILESET_INVALID` | Tileset JSON, required identity, bounds, transform, or content reference is malformed | Regenerate the Tileset with the toolchain |
| `ICE3_TILESET_UNSUPPORTED` | Tileset uses `region`, external tilesets, implicit tiling, unsupported content, or another unapproved feature | Export the supported local Cartesian explicit-tree subset |
| `ICE3_TILESET_TILE_FAILED` | One partition fails request, profile validation, or scene merge | Inspect the tile ID and retain successfully loaded partitions |
| `ICE3_TILESET_DUPLICATE_ID` | A partition reuses a scene ID already present in another loaded partition | Regenerate stable unique IDs with the toolchain |
| `ICE3_TILESET_ABORTED` | The caller signal or Tileset disposal cancels loading | Start a new load if the Tileset is still needed |
| `ICE3_TILESET_CAMERA_REQUIRED` | Tileset work-set scheduling is created without a camera | Pass the active perspective camera |
| `ICE3_TILESET_RESIDENT_BUDGET_EXCEEDED` | Resident partitions exceed the soft memory or tile budget | Expect a larger visible working set or reduce partition sizes; the warning is deduplicated until residency returns within budget |
| `ICE3_TILESET_LOD_INVALID` | The SSE threshold or LOD hierarchy configuration is invalid | Use a positive threshold and regenerate the hierarchical Tileset |
| `ICE3_TILESET_LOD_FALLBACK` | Finer target content is unavailable and a resident coarse ancestor remains visible | Inspect the target tile failure; keep the current fallback coverage |
| `ICE3_TILESET_CONTENTS_INVALID` | A tile has conflicting, empty, or duplicate content entries | Regenerate the Tileset |
| `ICE3_SCENE_QUERY_INVALID` | Query limit or world ray is invalid | Correct the query input |
| `ICE3_CAMERA_FOCUS_INVALID` | Focus padding or bounds are invalid | Pass positive padding and finite bounds |

## Rendering

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_WEBGL2_UNAVAILABLE` | WebGL2 context creation fails | Use a certified WebGL2 browser and GPU configuration |
| `ICE3_SHADER_COMPILE_FAILED` | Native shader compilation fails | Inspect the diagnostic and renderer logs |
| `ICE3_SHADER_LINK_FAILED` | Program linking or uniform lookup fails | Verify shader compatibility with the active backend |
| `ICE3_GPU_RESOURCE_FAILED` | GPU buffer or vertex-array allocation fails | Reduce resource pressure and recreate the context |
| `ICE3_RENDER_INSTANCING_FALLBACK` | Instance buffers cannot be allocated and repeated geometry uses ordinary draws | Reduce GPU memory pressure; selection remains available |
| `ICE3_RENDER_BATCH_ADAPTIVE_STARTED` | An idle-time adaptive render batch generation starts | Informational only; camera motion cancels it |
| `ICE3_RENDER_BATCH_ADAPTIVE_COMPLETED` | A complete candidate generation atomically replaces the active batch layout | Continue normal rendering and selection |
| `ICE3_RENDER_BATCH_ADAPTIVE_CANCELLED` | Camera motion, disposal, or a lifecycle change cancels a candidate generation | The previous active generation remains available |
| `ICE3_RENDER_BATCH_ADAPTIVE_FAILED` | Worker preparation or frame-budgeted upload fails | Keep the active generation and inspect the reported cause |
| `ICE3_RENDER_BATCH_MEMORY_REJECTED` | A candidate exceeds the configured extra GPU byte budget | Raise the optional budget or reduce the visible source set |

## Diagnostic shape

```ts
interface ICEDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}
```

`ICE3` exposes the most recent diagnostic through `getDiagnostics().lastDiagnostic` and emits `DIAGNOSTIC` when a new diagnostic is recorded.

Renderer diagnostics also expose cumulative `gpuUploads` and `gpuEvictions`
counts. These counters make unexpected GPU buffer churn visible during camera,
LOD, and residency regression tests.

## Related Documents

- `ICE3-ENG-IDX-001` — [Documentation index](README.md)
- `ICE3-ENG-API-002` — [M1 Asset API](api/m1.md)
- `ICE3-ENG-GUIDE-003` — [Development and troubleshooting](guides/development-and-troubleshooting.md)
