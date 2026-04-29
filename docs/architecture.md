# Architecture

`bimctl` is built as a small TypeScript core with two operator surfaces: a human CLI and an MCP stdio server for AI agents. The core modules avoid CLI state so the same validation, model creation, FreeCAD scripting, and EnergyPlus orchestration paths are used everywhere.

## Stack

- Node.js 20+ and TypeScript ESM for npm, `npx`, and global installs.
- Commander for CLI command routing.
- Zod for runtime validation and typed BIM JSON parsing.
- Official Model Context Protocol SDK for stdio tools.
- FreeCAD through generated Python scripts run by `FreeCADCmd`, `freecadcmd`, or an AppImage command.
- EnergyPlus through generated IDF files and the `energyplus` executable.

## Data Flow

1. `model create`, `model create-building`, or `init` creates deterministic BIM JSON.
2. `model validate` applies schema checks plus semantic checks such as unique space IDs and window bounds.
3. `model report` computes pre-simulation engineering takeoff metrics and optional per-space CSV output.
4. `model export-idf` converts BIM JSON into a standalone EnergyPlus IDF.
5. `freecad build` writes a FreeCAD Python build script and optionally executes it.
6. `simulate` writes reproducible run inputs and optionally executes EnergyPlus.
7. `mcp` exposes the same operations as structured tools for agents.

## Extension Points

- Add new schemas in `src/schema.ts` and mirror them in `schemas/`.
- Add model analysis helpers beside `src/analysis.ts` when the operation does not need an external engine.
- Add model exporters beside `src/idf.ts`.
- Add engine adapters under `src/engines/`.
- Add MCP tools in `src/mcp.ts` only after the corresponding core operation exists.

## Reliability Choices

- All file-producing operations have dry-run support where external engines are involved.
- External engine processes have finite timeouts, escalate from `SIGTERM` to `SIGKILL`, and report timeout failures as structured errors.
- Relative paths are resolved against an explicit `--cwd` for reproducibility.
- CLI JSON output is wrapped in `{ ok, data | error }` envelopes.
- MCP tools return both text JSON and `structuredContent`.
- Tests cover schema validation, IDF generation, dry-run orchestration, and the compiled CLI.
- Multi-zone generated buildings use shared-face detection during IDF export so adjacent rectangular zones become interzone surfaces instead of exterior walls.
- Engineering reports are computed from validated BIM JSON before simulation so daily QA checks can run without FreeCAD or EnergyPlus.

## Engine Setup

`bimctl doctor` searches `BIMCTL_FREECAD_CMD`, `FREECAD_CMD`, PATH, workspace FreeCAD AppImages, `BIMCTL_ENERGYPLUS_CMD`, `ENERGYPLUS_EXE`, PATH, and common EnergyPlus install locations. Downloaded installers are detected as artifacts but are not bundled into the npm package.