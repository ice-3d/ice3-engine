# ICE3 Engine Getting Started

> Document ID: ICE3-ENG-GUIDE-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Intended Outcome

Run the engine locally and render either the minimal M0 box scene or the
incrementally loaded M1 wastewater example.

## Prerequisites

- Node.js 24 LTS or 26+
- npm 11 or newer
- WebGL2-capable Chromium or WebKit

## Procedure

Run from the repository root:

```bash
nvm use
npm install
npm run dev:example
```

Open `http://127.0.0.1:8103/`.

For the tiled industrial scene:

```bash
npm run dev:example:m1
```

Open `http://127.0.0.1:8104/`.

## Expected Result

- M0 shows a flat-shaded cube with visible geometry edges.
- Mouse drag rotates, wheel zooms, and WASD or arrow keys pan.
- M1 shows an accessible loading state, then the tiled wastewater plant.
- M1 clicking selects an equipment unit; dragging does not select.
- A selected unit receives a strong yellow highlight and an information panel.

## Failure Diagnosis

| Symptom | Check |
|---|---|
| WebGL2 unavailable | Enable hardware acceleration and use a current browser |
| Blank M1 scene | Check `docs/diagnostics.md` and the browser network panel for Tileset or GLB failures |
| Assets show as placeholders | Confirm the checked-in `tiled/` tree exists |
| Connection refused | Confirm the command is still running on its documented port |

## Related Documents

- `ICE3-ENG-RM-001` — [README](../../README.md)
- `ICE3-ENG-API-001` — [M0 Public API](../api/m0.md)
- `ICE3-ENG-API-002` — [M1 Asset API](../api/m1.md)
- `ICE3-ENG-GUIDE-002` — [Asset loading](asset-loading.md)
