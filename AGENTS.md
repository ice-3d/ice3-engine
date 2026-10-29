# ICE3 Engine Repository Rules

> Document ID: ICE3-ENG-POL-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers
## Architecture

- Public consumers import only from `ice3`.
- Dependency direction is `@ice3/core` ← `@ice3/assets` ← `@ice3/runtime` ← `ice3`, with `@ice3/core` ← `@ice3/renderer` also feeding runtime.
- `@ice3/core` must remain independent of DOM, Canvas, GPU, and sibling packages.
- Renderer implementations must not leak GPU objects through public APIs.
- Runtime accepts only ICE3 Prepared GLB Profile assets; source-format parsing and heavy geometry conversion stay in `ice3-toolchain`.
- Applications, scripts, tests, editors, and external adapters use the same public semantic API.

## Delivery

- Develop on a feature branch; merge to `main` only after the full verification gate passes.
- Every behavioral change starts with a failing test and ends with the full suite green.
- Add no runtime dependency without an explicit design ruling.
- Keep M1 free of generic format compatibility, animation, textures, LOD, and industrial business features.
- Use the Node version from `.nvmrc`; current verification runs on Node 24 LTS.

## Naming and legal boundary

- Do not use competitor, vendor, or third-party product names in documents, code, comments, identifiers, links, or examples.
- Do not use their brand words, case variants, truncations, or concatenations as package names, directories, classes, or variables.
- Describe comparisons only with approved neutral categories such as “general 3D library”, “declarative chart extension”, or “commercial HMI/SCADA implementation”.
- Audit names before every commit and release.

## Verification

```bash
npm run verify
npm pack --workspaces --dry-run
```

## Related Documents

- `ICE3-ENG-IDX-001` — [Documentation index](docs/README.md)
- `ICE3-ENG-ARC-001` — [Engine architecture](docs/architecture.md)
