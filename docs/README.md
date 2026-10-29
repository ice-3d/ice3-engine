# ICE3 Engine Documentation Index

> Document ID: ICE3-ENG-IDX-001
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## Start Here

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-RM-001` | [ICE3 Engine](../README.md) | Active | Runtime overview, quick start, and repository map |
| `ICE3-ENG-ARC-001` | [Engine Architecture](architecture.md) | Active | Package boundaries, frame lifecycle, and asset flow |
| `ICE3-ENG-IDX-002` | [Architecture Decisions](decisions/README.md) | Active | Index of engine design decisions |
| `ICE3-ENG-POL-001` | [Repository policy](../AGENTS.md) | Active | Architecture and delivery constraints |

## Guides

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-GUIDE-001` | [Getting Started](guides/getting-started.md) | Active | Run the M0 and M1 examples |
| `ICE3-ENG-GUIDE-002` | [Asset Loading](guides/asset-loading.md) | Active | Load Prepared GLB and Tileset content |
| `ICE3-ENG-GUIDE-003` | [Development and Troubleshooting](guides/development-and-troubleshooting.md) | Active | Validate changes and diagnose failures |

## API And Reference

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-API-001` | [M0 Public API](api/m0.md) | Active | Core scene, camera, renderer, layer, and input API |
| `ICE3-ENG-API-002` | [M1 Asset API](api/m1.md) | Active | Prepared asset and Tileset runtime API |
| `ICE3-ENG-REF-001` | [Diagnostics](diagnostics.md) | Active | Stable runtime and asset diagnostic codes |

## Decisions

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-ADR-001` | [Public Facade and Package Boundaries](decisions/0001-public-facade-and-package-boundaries.md) | Active | Keep consumers on the public API |
| `ICE3-ENG-ADR-002` | [Geometry-First Industrial Rendering](decisions/0002-geometry-first-industrial-rendering.md) | Active | Prioritize geometry and spatial behavior |
| `ICE3-ENG-ADR-003` | [Camera-Driven Tileset and LOD](decisions/0003-camera-driven-tileset-and-lod.md) | Active | Preserve complete coverage while streaming |

## Specifications

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-SPEC-001` | [M0 Design](specs/2026-10-27-engine-m0-design.md) | Implemented | Engine baseline and lifecycle design |
| `ICE3-ENG-SPEC-002` | [M1 Asset Design](specs/2026-10-27-engine-m1-asset-design.md) | Implemented | Prepared GLB and spatial runtime design |
| `ICE3-ENG-SPEC-003` | [Equipment Selection](specs/2026-10-27-equipment-selection-design.md) | Implemented | Stable equipment picking and highlight design |

## Implementation Plans

| ID | Title | Status | Purpose |
|---|---|---|---|
| `ICE3-ENG-PLAN-001` | [Engine M0](plans/2026-10-27-engine-m0.md) | Implemented | Baseline engine implementation |
| `ICE3-ENG-PLAN-002` | [Asset Runtime](plans/2026-10-27-engine-m1-asset-runtime.md) | Implemented | Prepared asset runtime implementation |
| `ICE3-ENG-PLAN-003` | [Equipment Selection](plans/2026-10-27-equipment-selection.md) | Implemented | Equipment selection implementation |
