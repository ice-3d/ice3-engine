# ICE3 Engine

> Document ID: ICE3-ENG-RM-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers
ICE3 Engine is a modern, programmable 3D engine for industrial applications. M0 is a runnable vertical slice that proves the public API, native WebGL2 scene rendering, shared 2D/3D input, layered composition, lifecycle management, and browser verification.

## Architecture

```text
@ice3/core ← @ice3/assets        Prepared GLB reader
    ↑            ↑
@ice3/renderer   @ice3/runtime   Rendering, loading, and scene lifetime
          \       /
             ice3                Public package
```

Consumers import only from `ice3`. Internal package paths are private.

Cross-repository asset formats, shared metrics, budgets, compatibility, and
diagnostic codes are defined by the canonical
[Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md).

## M0 capabilities

- Create an engine, scene, perspective camera, box geometry, and flat basic material.
- Add optional high-contrast geometry edges without relying on lighting.
- Draw visible boxes through a native WebGL2 backend.
- Add world-anchored and screen-anchored Canvas2D labels.
- Route pointer and wheel input from the top 2D layer to the 3D scene.
- Rotate from geometry or empty space, zoom with damping, and pan in the view
  plane with WASD or arrow keys through `ICEOrbitController`.
- Resize with correct DPR handling.
- Recover rendering resources after GPU context restoration.
- Serialize and restore the M0 scene model.
- Destroy and rebuild without duplicate listeners or frame requests.

## Development

Requirements:

- Node.js 24 LTS or 26+
- npm 11 or newer

```bash
nvm use
npm install
npm run dev:example
npm run dev:example:m1
```

Open <http://127.0.0.1:8103> for the programmatic M0 scene and
<http://127.0.0.1:8104> for the incrementally loaded tiled asset.
Open <http://127.0.0.1:8104/?demo=adaptive> for the idle-time Worker batching
demo.

## Repository assets

The runnable wastewater example uses the versioned Tileset hierarchy under
`examples/m1/assets/wastewater-plant/tiled/`. The monolithic source GLB and the
full-model Prepared GLB are local generated intermediates; those directories are
ignored and must be produced with the ICE3 toolchain when needed for validation.
Only the bounded runtime slices are committed so normal clones and static
deployments avoid oversized Git objects.

## Verification

```bash
npm run test:architecture
npm run typecheck
npm run typecheck:example
npm test
npm run test:e2e
npm run verify
```

The browser matrix covers current Chromium and WebKit. Playwright does not
reuse existing example servers.

## M1 capabilities

- Read only ICE3 Prepared GLB Profile v1 assets.
- Load nodes with matrix transforms and shared indexed geometry.
- Render prepared triangle and crease-edge buffers.
- Cache immutable decoded bytes while creating independent scene instances.
- Cancel loads, dispose assets idempotently, and release GPU buffers.
- Validate and expose the embedded asset preparation contract and runtime
  renderer diagnostics.
- Show an accessible staging overlay while large prepared assets load and keep
  actionable failure feedback in place when loading cannot complete.
- Keep a compact, non-blocking control hint visible after the scene is ready.
- Select a named equipment unit with an exact GPU click pick and preserve
  source colors under a non-destructive yellow highlight.
- Reject ordinary GLB or profile features that need runtime conversion.
- Open an OGC 3D Tiles 1.1 Tileset with a required perspective camera and
  maintain a camera-driven visible, prefetch, and retention work set.
- Cull geometry against the current view frustum, prefetch a bounded offscreen
  margin, and unload partitions after they leave the retention margin.
- Apply a soft resident-count and geometry-byte budget without ever omitting
  visible equipment to satisfy that budget.
- Keep GPU geometry for resident Tiles across camera-driven visibility changes,
  with a frame grace window and byte-budgeted LRU eviction for non-resident
  resources.
- Upload each committed Tile before it becomes visible and expose cumulative
  GPU upload/eviction diagnostics.
- Commit at most one partition per frame by default, with configurable request
  concurrency and per-frame commit limits.
- Merge completed partitions into one scene so equipment selection and spatial
  interaction continue to work across tile boundaries.
- Expose immutable work-set and residency statistics, emit partition lifecycle
  events, preserve successful partitions after a tile failure, and release all
  partitions idempotently.
- Clear a selection before unloading the partition that contains it.
- Select a camera-driven LOD cut from hierarchical Tilesets using
  screen-space error, keeping parent coarse content until replacement children
  are ready.
- Preserve semantic equipment selection while the same device moves between
  coarse and fine scene nodes.
- Consume optional static render batches from Prepared GLB while retaining
  stable device selection, exact GPU picking, and yellow highlight.
- Submit compatible repeated geometry through one instanced draw with one
  shared geometry buffer and a stable per-instance semantic index.
- Fall back to ordinary mesh submission when instance-buffer allocation fails
  and expose the fallback count in renderer diagnostics.
- Opt into idle-time adaptive render batching with bounded Workers, transferable
  buffers, frame-budgeted candidate uploads, cancellation on camera motion, and
  atomic generation activation.

## M0 boundaries

M0 does not include model loading, LOD, instancing, spatial streaming, industrial semantics, Agent integration, asset tools, post-processing, or a WebGPU backend.

M1 does not include generic glTF compatibility, animation, skins, Morph
targets, textures, complex materials, implicit tiling, external Tilesets, or
runtime source-format conversion.
The first Tileset runtime supports explicit `children`, local Cartesian `box` or
`sphere` bounds, relative Prepared GLB content, finite tile transforms, and
`REPLACE` refinement.

The runtime waits for the current work set through `whenIdle()`. There is no
`whenComplete()` because a camera-driven Tileset is not expected to retain every
partition at once. Hierarchical LOD content is generated by the toolchain and
selected at runtime with `geometricError`; the browser never simplifies a mesh.

API details are in [docs/api/m0.md](docs/api/m0.md) and
[docs/api/m1.md](docs/api/m1.md). Stable diagnostic codes are in
[docs/diagnostics.md](docs/diagnostics.md).

## AI-assisted development

This project makes substantial use of AI-assisted development. 本项目在设计和实现过程中大量使用了 AI 辅助开发。

## License

This project is licensed under the [MIT License](LICENSE).
