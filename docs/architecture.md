# ICE3 Engine Architecture

> Document ID: ICE3-ENG-ARC-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## System Context

`ice3-engine` consumes prepared assets and application scene intent. It does not
parse source formats, own business rules, or depend on the Agent Console.

```text
Prepared GLB / Tileset
          ↓
   @ice3/assets reader
          ↓
    @ice3/runtime scene
          ↓
 @ice3/renderer WebGL2
          ↓
       browser GPU

consumer → ice3 public facade → internal packages
```

## Package Responsibilities

| Package | Responsibility |
|---|---|
| `@ice3/core` | Math, scene graph, geometry, materials, camera, events, serialization, and diagnostics; no DOM or GPU dependency |
| `@ice3/assets` | Prepared GLB and Tileset parsing, profile validation, and immutable snapshots |
| `@ice3/renderer` | WebGL2 frame execution, geometry residency, instancing, render batches, and picking |
| `@ice3/runtime` | Engine lifecycle, 2D layers, input routing, asset handles, Tileset scheduling, and LOD |
| `ice3` | Public package facade used by applications |

The dependency direction is:

```text
@ice3/core ← @ice3/assets ← @ice3/runtime → ice3
     ↑                          ↓
@ice3/renderer ────────────────┘
```

No external consumer imports another package's private source path.

## Frame Lifecycle

1. `ICE3` creates the scene and 2D layer canvases and initializes the renderer.
2. Input is resolved from the topmost interactive layer, then routed to 2D,
   controls, or 3D picking as appropriate.
3. Camera and scene changes request a render frame.
4. The renderer collects visible meshes or prepared batches and applies
   byte-budgeted GPU upload or eviction.
5. Pick requests render a temporary semantic identity frame when exact picking
   is required.
6. The visible frame is presented, diagnostics update, and idle work may begin.

`start()` is idempotent and on-demand. `destroy()` releases listeners, layers,
frame requests, scene ownership, and GPU resources.

## Asset Flow

1. `ICETilesetLoader` reads the Tileset and validates the supported local
   Cartesian subset.
2. The scheduler selects visible, prefetch, and retained tiles from camera
   bounds and screen-space error.
3. `@ice3/assets` parses each Prepared GLB and validates its profile.
4. The scene builder instantiates semantic nodes, indexed geometry, materials,
   and selection identities.
5. The runtime commits complete tile chunks atomically and keeps prior coverage
   visible until replacement content is ready.
6. The renderer uploads resident geometry under frame and byte budgets.

## 2D And 3D Composition

The runtime uses one ordered layer model. Screen-space and world-anchored 2D
layers share pointer, wheel, focus, resize, and disposal behavior with 3D
content. A hit layer can block or pass an event according to its declared
policy.

## Failure Behavior

- Unsupported assets produce stable diagnostic codes before scene publication.
- A failed tile leaves completed partitions interactive.
- A failed LOD transition retains the last complete representation.
- A failed GPU upload leaves the previous generation active.
- A lost WebGL context pauses rendering until restoration completes.
- Disposal is idempotent and removes pending work and resources.

## Related Documents

- `ICE3-ENG-RM-001` — [README](../README.md)
- `ICE3-ENG-API-001` — [M0 Public API](api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](api/m1.md)
- `ICE3-ENG-REF-001` — [Diagnostics](diagnostics.md)
- `ICE3-ENG-ADR-001` — [Public facade and package boundaries](decisions/0001-public-facade-and-package-boundaries.md)
- `ICE3-DOC-ARC-001` — [ICE3 family architecture](https://github.com/ice-3d/ice3-doc/blob/main/docs/architecture.md)
