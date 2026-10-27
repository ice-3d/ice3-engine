# ICE3 Engine Repository Rules

## Architecture

- Public consumers import only from `ice3`.
- Dependency direction is `@ice3/core` ← `@ice3/renderer` ← `@ice3/runtime` ← `ice3`.
- `@ice3/core` must remain independent of DOM, Canvas, GPU, and sibling packages.
- Renderer implementations must not leak GPU objects through public APIs.
- Applications, scripts, tests, editors, and external adapters use the same public semantic API.

## Delivery

- Develop on a feature branch; merge to `main` only after the full verification gate passes.
- Every behavioral change starts with a failing test and ends with the full suite green.
- Add no runtime dependency without an explicit design ruling.
- Keep M0 scope free of unrelated rendering or industrial features.

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
