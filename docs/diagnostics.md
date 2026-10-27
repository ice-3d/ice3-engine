# ICE3 M0 Diagnostics

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
| `ICE3_TOOL_RUNTIME_CONVERSION_REQUIRED` | Asset declares that runtime conversion is required | Move conversion into the external toolchain |

## Rendering

| Code | Trigger | Caller action |
| --- | --- | --- |
| `ICE3_WEBGL2_UNAVAILABLE` | WebGL2 context creation fails | Use a certified WebGL2 browser and GPU configuration |
| `ICE3_SHADER_COMPILE_FAILED` | Native shader compilation fails | Inspect the diagnostic and renderer logs |
| `ICE3_SHADER_LINK_FAILED` | Program linking or uniform lookup fails | Verify shader compatibility with the active backend |
| `ICE3_GPU_RESOURCE_FAILED` | GPU buffer or vertex-array allocation fails | Reduce resource pressure and recreate the context |

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
