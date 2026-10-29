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
- Use Node.js 24.22.1 LTS from `.nvmrc`; this exact version is used by the verification gate.

## Commit identity

- Every Git author and committer name in this repository must be `damoqiongqiu`.
- Verify the configured and recorded names before committing, merging, or pushing.

## Naming and legal boundary

- Do not use competitor, vendor, or third-party product names in documents, code, comments, identifiers, links, or examples.
- Do not use their brand words, case variants, truncations, or concatenations as package names, directories, classes, or variables.
- Describe comparisons only with approved neutral categories such as “general 3D library”, “declarative chart extension”, or “commercial HMI/SCADA implementation”.
- Do not link to external materials that expose prohibited names. Keep any necessary research outside product repositories and subject it to legal review.
- Audit names before every commit and release.

## Customer asset protection

- Real customer model assets remain in a controlled local directory outside every repository.
- Original models and derived assets must not enter source, tests, examples, documentation, screenshots, logs, build output, packages, or Git history.
- Derived assets include converted models, simplified models, previews, thumbnails, extracted textures, and other identifiable content.
- Do not stage, commit, push, or upload customer assets or derivative data to any remote service.
- Tests, demos, and public builds use synthetic, sanitized, or explicitly redistributable assets.
- Before completing asset-related work, inspect Git status, tracked files, ignore rules, and staged content.

## Cross-repository contracts

- `ice3-doc` is the single source of truth for formats, metrics, budgets, compatibility rules, shared diagnostics, and other cross-project contracts.
- This repository documents its own implementation and links to the canonical contract instead of independently maintaining a complete copy.
- A contract change requires checking every consumer in the ICE3 family and passing the frozen contract or conformance tests.

## Verification

```bash
npm run verify
npm pack --workspaces --dry-run
```

## Related Documents

- `ICE3-ENG-IDX-001` — [Documentation index](docs/README.md)
- `ICE3-ENG-ARC-001` — [Engine architecture](docs/architecture.md)
