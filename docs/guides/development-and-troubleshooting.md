# ICE3 Engine Development And Troubleshooting

> Document ID: ICE3-ENG-GUIDE-003
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Intended Outcome

Change engine behavior with the repository's architecture, test, and diagnostic
gates intact.

## Development Workflow

```bash
nvm use
npm install
npm run typecheck
npm test
npm run test:e2e
npm run verify
```

Run the complete gate before merging to `main`. Browser tests cover Chromium and
WebKit and start their own example servers.

## Common Failures

| Diagnostic or symptom | Resolution |
|---|---|
| `ICE3_ASSET_PROFILE_UNSUPPORTED` | Regenerate with the current toolchain and verify the Prepared profile |
| `ICE3_ASSET_CONTRACT_MISSING` | Use a current asset with the collaboration contract |
| `ICE3_TILESET_UNSUPPORTED` | Use explicit children, local Cartesian bounds, relative content, and `REPLACE` refinement |
| `ICE3_RENDERER_UNSUPPORTED` | Use a browser and device that expose WebGL2 |
| Repeated blank frames after context loss | Wait for context restoration and inspect renderer diagnostics |
| Large M1 asset missing locally | Generate it with `ice3-toolchain`; source and prepared intermediates are ignored |

## Debugging Rules

- Reproduce the behavior with the public API rather than testing private source
  imports.
- Use stable diagnostic codes rather than message text.
- Check GPU upload and eviction counters before changing residency budgets.
- Preserve prior visible coverage while refining a Tileset.
- Never introduce runtime source conversion to bypass an asset failure.

## Related Documents

- `ICE3-ENG-REF-001` — [Diagnostics](../diagnostics.md)
- `ICE3-ENG-ADR-001` — [Public facade and package boundaries](../decisions/0001-public-facade-and-package-boundaries.md)
- `ICE3-DOC-ADR-002` — [Offline open asset pipeline](https://github.com/ice-3d/ice3-doc/blob/main/docs/decisions/0002-offline-open-asset-pipeline.md)
