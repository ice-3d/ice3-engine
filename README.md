# ICE3 Engine

> Document ID: ICE3-ENG-RM-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

ICE3 Engine is a programmable 3D runtime for industrial applications. It
prioritizes geometry, spatial organization, deterministic lifecycle, stable
equipment identity, and shared 2D/3D interaction over cinematic lighting.

## Capabilities

| Area | Current capability |
|---|---|
| Scene | Typed scene graph, node ownership, transforms, serialization, disposal |
| Rendering | Native WebGL2 geometry, flat materials, optional geometry edges |
| Composition | Ordered Canvas2D layers over or alongside 3D content |
| Input | Shared pointer and keyboard routing, orbit, pan, zoom, and picking |
| Assets | ICE3 Prepared GLB Profile reader and scene builder |
| Streaming | OGC 3D Tiles 1.1 loading, camera work sets, prefetch, and eviction |
| LOD | Screen-space error selection with stable parent coverage |
| Batching | Static prepared batches, instancing, and optional Worker-generated batches |
| Diagnostics | Stable error codes, frame metrics, GPU residency, and Tileset statistics |

Consumers import from the public `ice3` package. The packages under `@ice3/*`
are implementation boundaries and are not public import paths.

## Quick Start

Requirements:

- Node.js 24.22.1 LTS
- npm 11 or newer
- A browser with WebGL2

```bash
git clone https://github.com/ice-3d/ice3-engine.git
cd ice3-engine
nvm use
npm install
npm run dev:example:m1
```

Open `http://127.0.0.1:8104/`. The default example incrementally loads the
synthetic wastewater plant. Use `http://127.0.0.1:8103/` for the minimal M0
scene and `http://127.0.0.1:8104/?demo=adaptive` for idle-time Worker batching.

## Minimal Scene

```ts
import {
  ICE3,
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEPerspectiveCamera,
  ICEScene,
} from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = new ICE3().init(host);
const scene = new ICEScene({ id: 'main' });
const camera = new ICEPerspectiveCamera({
  id: 'camera',
  position: [3, 2, 4],
  target: [0, 0, 0],
});

scene.addChild(new ICEMesh({
  id: 'sample-device',
  geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
  material: new ICEBasicMaterial({ color: '#2f81f7' }),
}));

engine.setScene(scene).setCamera(camera).start();

// Release DOM listeners, scene ownership, and GPU resources when finished.
engine.destroy();
```

## Asset Workflow

The runtime accepts only ICE3 Prepared GLB Profile v1 assets. General-purpose
source parsing, conversion, simplification, and partitioning belong to
[`ice3-toolchain`](https://github.com/ice-3d/ice3-toolchain/blob/main/README.md).

The shared format and compatibility rules are defined by the canonical
[Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md).

## Repository Assets

The runnable wastewater example uses the versioned Tileset hierarchy under
`examples/m1/assets/wastewater-plant/tiled/`. The monolithic source GLB and
full-model Prepared GLB are local generated intermediates and are ignored by
Git. Only bounded runtime slices are committed.

## Verification

```bash
npm run docs:check
npm run test:architecture
npm run typecheck
npm run typecheck:example
npm test
npm run test:e2e
npm run verify
```

`verify` runs the documentation gate, architecture checks, type checks, unit
tests, the build, and browser tests in Chromium and WebKit.

## Boundaries

- No generic source-format compatibility in the browser.
- No animation, skins, morph targets, textures, or complex materials in the
  current profile.
- No implicit tiling, external Tilesets, or runtime mesh simplification.
- No business rules, workflow engines, or Agent policy in the engine.
- Lighting and materials are intentionally basic; geometry and spatial
  behavior are the product priority.

## Documentation

- [Documentation index](docs/README.md)
- [Runtime architecture](docs/architecture.md)
- [Getting started](docs/guides/getting-started.md)
- [Asset loading](docs/guides/asset-loading.md)
- [Development and troubleshooting](docs/guides/development-and-troubleshooting.md)
- [M0 API](docs/api/m0.md)
- [M1 Asset API](docs/api/m1.md)
- [Diagnostics](docs/diagnostics.md)
- [Architecture decisions](docs/decisions/README.md)

## AI-assisted development

This project makes substantial use of AI-assisted development. 本项目在设计和实现过程中大量使用了 AI 辅助开发。

## License

This project is licensed under the [MIT License](LICENSE).
