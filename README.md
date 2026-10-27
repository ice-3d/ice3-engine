# ICE3 Engine

ICE3 Engine is a modern, programmable 3D engine for industrial applications. M0 is a runnable vertical slice that proves the public API, native WebGL2 scene rendering, shared 2D/3D input, world-anchored labels, screen HUD, lifecycle management, and browser verification.

## Architecture

```text
@ice3/core      Scene model, math, events, diagnostics, serialization
      ↑
@ice3/renderer  Renderer contract and WebGL2 backend
      ↑
@ice3/runtime   Engine lifecycle, layers, projection, input and orbit control
      ↑
ice3            Public package with the approved stable exports
```

Consumers import only from `ice3`. Internal package paths are private.

## M0 capabilities

- Create an engine, scene, perspective camera, box geometry, and basic material.
- Draw visible boxes through a native WebGL2 backend.
- Add world-anchored and screen-anchored Canvas2D labels.
- Route pointer and wheel input from the top 2D layer to the 3D scene.
- Rotate and zoom the camera with `ICEOrbitController`.
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
```

Open <http://127.0.0.1:8103>.

## Verification

```bash
npm run test:architecture
npm run typecheck
npm run typecheck:example
npm test
npm run test:e2e
npm run verify
```

The browser matrix covers current Chromium and WebKit. The example server always uses port `8103`, and Playwright does not reuse an existing server.

## M0 boundaries

M0 does not include model loading, LOD, instancing, spatial streaming, industrial semantics, Agent integration, asset tools, post-processing, or a WebGPU backend.

API details are in [docs/api/m0.md](docs/api/m0.md). Stable diagnostic codes are in [docs/diagnostics.md](docs/diagnostics.md).
