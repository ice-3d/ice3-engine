# Geometry-First Industrial Rendering

> Document ID: ICE3-ENG-ADR-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Context

Industrial users rely primarily on spatial relationships, equipment identity,
process connections, and readable geometry. Photorealistic lighting and complex
material authoring increase runtime cost and can obscure engineering geometry.

## Decision

The engine prioritizes accurate geometry, stable bounds, clear color separation,
visible edges, spatial culling, and selection. Basic flat colors, edges, and
minimal lighting support are sufficient for the current product scope.

## Considered Alternatives

- Optimize first for physically based rendering.
- Depend on elaborate scene lighting for readable equipment.
- Encode engineering meaning only through textures.

These alternatives increase cost and make critical geometry harder to validate
and select.

## Consequences

- The flat renderer remains the primary test target.
- Geometric and spatial regressions receive higher priority than visual effects.
- Material features remain bounded until a concrete industrial requirement
  justifies their cost.

## Compatibility

Prepared assets preserve display colors and semantic identities. Future
lighting or material backends must keep the geometry-first default behavior
available.

## Verification

- Browser tests assert a uniform flat example appearance and visible edges.
- Picking tests assert exact geometry selection.
- Performance diagnostics separate geometry uploads from frame presentation.

## Related Documents

- `ICE3-ENG-API-001` — [M0 Public API](../api/m0.md)
- `ICE3-DOC-ADR-001` — [Universal engine and vertical applications](https://github.com/ice-3d/ice3-doc/blob/main/docs/decisions/0001-universal-engine-and-vertical-applications.md)
