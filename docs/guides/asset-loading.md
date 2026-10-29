# ICE3 Engine Asset Loading

> Document ID: ICE3-ENG-GUIDE-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Intended Outcome

Open a standard GLB containing the ICE3 Prepared profile or a supported local
OGC 3D Tiles 1.1 Tileset and keep scene, network, and GPU resources bounded.

## Prerequisites

- A file produced by `ice3-toolchain`.
- A perspective camera that owns the current view.
- The asset files served from the same origin for the examples.

## Open A Prepared GLB

```ts
import { ICE3, ICEAssetLoader, ICEPerspectiveCamera } from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = new ICE3().init(host);
const camera = new ICEPerspectiveCamera({
  id: 'camera',
  position: [3, 2, 4],
  target: [0, 0, 0],
});
const loader = new ICEAssetLoader(engine);
const handle = await loader.open('/assets/device.glb');

engine.setScene(handle.scene).setCamera(camera).start();
```

## Open A Tileset

```ts
import { ICETilesetLoader } from 'ice3';

const tileset = new ICETilesetLoader(engine, {
  camera,
  maxConcurrentRequests: 2,
  commitPerFrame: 1,
});
const handle = await tileset.open('/assets/plant/tileset.json');
engine.setScene(handle.scene);
await handle.whenIdle();
```

Use `whenIdle()` for the current camera work set. `whenComplete()` is not
defined because a camera-driven scene does not retain every tile at once.

## Lifecycle

- Keep the handle alive while its scene is in use.
- Call `handle.dispose()` when the asset is no longer needed.
- Use `loader.clear(url)` to clear cached decoded bytes only after active scene
  instances are disposed or no longer required.
- A failed refinement does not remove last-known-complete coverage.

## Expected Result

- Invalid profiles fail before a partial scene appears.
- Completed partitions become visible atomically.
- The selected equipment identity survives LOD replacement.
- Resident tile counts and GPU bytes are available through diagnostics.

## Related Documents

- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
- `ICE3-ENG-REF-001` — [Diagnostics](../diagnostics.md)
- `ICE3-DOC-CTR-001` — [Asset Preparation Contract v1](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)
