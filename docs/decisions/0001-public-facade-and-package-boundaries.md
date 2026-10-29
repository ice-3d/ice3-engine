# Public Facade And Package Boundaries

> Document ID: ICE3-ENG-ADR-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Context

The runtime is implemented across several packages. Exposing their internal
paths would make package structure, renderer internals, and asset implementation
details part of the public contract.

## Decision

Applications import only from `ice3`. Internal packages may depend only on
declared lower layers. `@ice3/core` has no DOM, Canvas, GPU, or sibling package
dependency. Renderer implementations do not expose GPU objects through public
APIs.

## Considered Alternatives

- Let applications import each package directly.
- Publish renderer-specific objects through runtime methods.
- Put all implementation in one package without enforced boundaries.

These alternatives provide short-term convenience but make backend changes and
independent testing unsafe.

## Consequences

- The public facade owns exports and compatibility.
- Architecture tests can reject illegal dependency edges.
- Internal packages remain independently testable.
- Some internal capabilities require an explicit public facade decision before
  applications can use them.

## Compatibility

Existing public `ice3` exports remain the supported path. Removing or changing a
public symbol requires a versioning and migration decision.

## Verification

```bash
npm run test:architecture
npm run typecheck
```

## Related Documents

- `ICE3-ENG-ARC-001` — [Engine architecture](../architecture.md)
- `ICE3-ENG-API-001` — [M0 Public API](../api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
