# ICE3 Engine

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
<http://127.0.0.1:8104> for the prepared GLB asset.

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
- Show an accessible staging overlay while large prepared assets load and keep
  actionable failure feedback in place when loading cannot complete.
- Keep a compact, non-blocking control hint visible after the scene is ready.
- Select a named equipment unit with an exact GPU click pick and preserve
  source colors under a non-destructive yellow highlight.
- Reject ordinary GLB or profile features that need runtime conversion.

## M0 boundaries

M0 does not include model loading, LOD, instancing, spatial streaming, industrial semantics, Agent integration, asset tools, post-processing, or a WebGPU backend.

M1 does not include generic glTF compatibility, animation, skins, Morph
targets, textures, complex materials, instancing, LOD, spatial queries, or
runtime source-format conversion.

API details are in [docs/api/m0.md](docs/api/m0.md) and
[docs/api/m1.md](docs/api/m1.md). Stable diagnostic codes are in
[docs/diagnostics.md](docs/diagnostics.md).
