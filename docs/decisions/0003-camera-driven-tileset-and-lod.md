# Camera-Driven Tileset And LOD

> Document ID: ICE3-ENG-ADR-003
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Context

An industrial Tileset may contain much more geometry than the current camera can
use. Loading every tile creates long startup times and unnecessary GPU memory,
while naive replacement can expose holes or lose the current selection.

## Decision

The runtime derives visible, prefetch, and retained tile sets from the camera,
bounds, and screen-space error. Complete child coverage replaces parent coverage
only after required content is resident. Failed or stale work leaves the
last-known-complete representation visible.

Stable semantic selection IDs are independent from LOD node IDs.

## Considered Alternatives

- Load all tiles before first render.
- Replace parent content immediately on camera movement.
- Use node names as selection identity.

These alternatives trade predictable interaction and identity stability for
shorter implementation work that does not hold at industrial scene sizes.

## Consequences

- Initial rendering can occur before all tiles are resident.
- Visible coverage takes precedence over soft residency targets.
- Coarse and fine nodes can coexist during transition.
- Selection must be cleared only when no resident content contains its semantic
  identity.

## Compatibility

The runtime supports an explicit, local Cartesian OGC 3D Tiles subset. Broader
tiling features require a new compatibility decision.

## Verification

```bash
npm test -- packages/runtime/tests/asset
npm run test:e2e
```

## Related Documents

- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
- `ICE3-ENG-GUIDE-002` — [Asset loading](../guides/asset-loading.md)
- `ICE3-DOC-SPEC-002` — [Adaptive Tileset Scheduler](https://github.com/ice-3d/ice3-doc/blob/main/docs/specs/2026-10-27-adaptive-tileset-scheduler-design.md)
