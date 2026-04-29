# bimctl

`bimctl` is a headless BIM command-line platform and MCP stdio server for agent-friendly FreeCAD and EnergyPlus workflows. It gives humans and AI coding agents one stable JSON interface for creating simple building models, validating them, exporting EnergyPlus IDF, building FreeCAD geometry, and orchestrating simulations.

The package is designed for `npx bimctl ...`, `npm i -g bimctl`, and MCP clients such as Claude Code or Codex-compatible agent runtimes.

## Install

```bash
npm i -g bimctl
bimctl doctor
```

During local development:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Quick Start

```bash
bimctl init my-building --name "My Building"
cd my-building
bimctl model validate models/shoebox.bim.json --json
bimctl model report models/shoebox.bim.json --csv runs/shoebox-spaces.csv
bimctl model export-idf models/shoebox.bim.json --out runs/shoebox.idf
bimctl simulate models/shoebox.bim.json --out runs/sim --dry-run
```

Create a larger multi-zone rectangular building when you need a richer test model:

```bash
bimctl model create-building --name "Small Office" --floors 2 --rows 2 --columns 3 --out models/small-office.bim.json
bimctl model report models/small-office.bim.json --csv runs/small-office-spaces.csv
bimctl model export-idf models/small-office.bim.json --out runs/small-office.idf
```

Run against real engines after installing/configuring them:

```bash
export BIMCTL_FREECAD_CMD=/path/to/FreeCADCmd
export BIMCTL_ENERGYPLUS_CMD=/path/to/energyplus
bimctl freecad build models/shoebox.bim.json --out runs/shoebox.FCStd
bimctl simulate models/shoebox.bim.json --out runs/sim --jobs 1 --timeout-ms 30000
```

## MCP

Start the stdio server:

```bash
bimctl mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "bimctl": {
      "command": "npx",
      "args": ["-y", "bimctl", "mcp"]
    }
  }
}
```

Exposed tools:

- `bimctl_doctor`
- `bimctl_init_project`
- `bimctl_create_model`
- `bimctl_create_building_model`
- `bimctl_validate_model`
- `bimctl_analyze_model`
- `bimctl_export_idf`
- `bimctl_simulate`
- `bimctl_freecad_build`

All tools return structured JSON content and are safe to call in dry-run mode before executing external engines.

## Model Format

The canonical model format is BIM JSON. The schema is published in [schemas/bim-model.schema.json](schemas/bim-model.schema.json). The first supported model primitive is a deterministic rectangular thermal zone with dimensions, origin, windows, internal loads, thermostat setpoints, and simulation output preferences. `model create-building` composes that primitive into multi-floor, multi-zone rectangular grids, and the EnergyPlus exporter marks fully shared faces as interzone surfaces.

`model report` provides a pre-simulation engineering takeoff: floor area, volume, envelope areas, window-to-wall ratio, loads, infiltration design-flow estimate, and optional per-space CSV output for spreadsheet review.

## Architecture

See [docs/architecture.md](docs/architecture.md) for module boundaries, pipeline choices, extension points, and publishing notes.

## Testing

```bash
npm test
npm run test:e2e
npm run test:real-engines
```

The default and e2e test suites use dry-run engine orchestration only, so they do not launch FreeCAD or EnergyPlus.

`npm run test:real-engines` is a bounded smoke test for a one-zone, design-day-only model. It probes engine startup first, uses a single EnergyPlus worker via `--jobs 1`, and applies short process timeouts so an incompatible or unhealthy installation fails fast instead of running for a long time.

`bimctl doctor` now performs a short startup probe for detected engines, so ABI problems such as missing glibc/libstdc++ versions show up before a long run.

## License

MIT, Copyright (c) 2026 Mohammed Tayor.