#!/usr/bin/env node
import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeBimModelFile, ModelEngineeringMetrics, spaceMetricsCsv } from './analysis.js';
import { detectEngines } from './engines/detect.js';
import { exportIdfFromModelFile, simulateModel } from './engines/energyplus.js';
import { buildFreeCadModel } from './engines/freecad.js';
import { readJsonFile, resolvePath, writeJsonFile, writeTextFile } from './fs.js';
import { initializeProject } from './project.js';
import { createBuildingModel, createShoeboxModel, validateBimModel } from './schema.js';
import { BimctlError } from './types.js';
import { VERSION } from './version.js';
import { startMcpServer } from './mcp.js';

type OutputMode = 'human' | 'json';

function commandCwd(program: Command): string {
  return resolvePath(String(program.opts().cwd ?? process.cwd()));
}

function outputMode(program: Command): OutputMode {
  return program.opts().json ? 'json' : 'human';
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printResult(program: Command, value: unknown, humanMessage: string): void {
  if (outputMode(program) === 'json') {
    printJson({ ok: true, data: value });
    return;
  }
  process.stdout.write(`${humanMessage}\n`);
}

function formatNumber(value: number, fractionDigits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits });
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

function formatModelReport(metrics: ModelEngineeringMetrics, csvPath?: string): string {
  const lines = [
    `Project: ${metrics.project.name}`,
    `Spaces: ${metrics.summary.spaceCount} across ${metrics.summary.floorCount} floor${metrics.summary.floorCount === 1 ? '' : 's'}`,
    `Area: ${formatNumber(metrics.summary.floorAreaM2)} m2 floor, ${formatNumber(metrics.summary.volumeM3)} m3 volume`,
    `Envelope: ${formatNumber(metrics.summary.exteriorWallAreaM2)} m2 walls, ${formatNumber(metrics.summary.roofAreaM2)} m2 roof, ${formatNumber(metrics.summary.groundContactAreaM2)} m2 ground`,
    `Windows: ${formatNumber(metrics.summary.windowAreaM2)} m2, WWR ${formatPercent(metrics.summary.windowToWallRatio)}`,
    `Loads: ${formatNumber(metrics.summary.people, 0)} people, ${formatNumber(metrics.summary.lightingW, 0)} W lighting, ${formatNumber(metrics.summary.equipmentW, 0)} W equipment, ${formatNumber(metrics.summary.internalLoadWPerM2, 1)} W/m2 internal`,
    `Infiltration: ${formatNumber(metrics.summary.infiltrationM3S, 4)} m3/s design flow estimate`
  ];
  if (csvPath) lines.push(`Space CSV: ${csvPath}`);
  return lines.join('\n');
}

function printError(program: Command, error: unknown): void {
  const payload = error instanceof BimctlError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: 'unexpected_error', message: error instanceof Error ? error.message : String(error) };

  if (outputMode(program) === 'json') {
    printJson({ ok: false, error: payload });
  } else {
    process.stderr.write(`bimctl: ${payload.message}\n`);
  }
}

function numberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received ${value}`);
  return parsed;
}

function integerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, received ${value}`);
  return parsed;
}

function withErrors<TArgs extends unknown[]>(program: Command, action: (...args: TArgs) => Promise<void>): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await action(...args);
    } catch (error) {
      printError(program, error);
      process.exitCode = 1;
    }
  };
}

export function createCli(): Command {
  const program = new Command();
  program
    .name('bimctl')
    .description('Headless BIM CLI and MCP server for FreeCAD and EnergyPlus')
    .version(VERSION)
    .option('--json', 'emit structured JSON envelopes')
    .option('--cwd <dir>', 'working directory for relative paths', process.cwd());

  program.command('doctor')
    .description('detect FreeCAD, EnergyPlus, and local engine artifacts')
    .action(withErrors(program, async () => {
      const cwd = commandCwd(program);
      const result = await detectEngines({ cwd });
      const status = result.ready ? 'ready' : 'needs engine setup';
      printResult(program, result, `bimctl doctor: ${status}`);
    }));

  program.command('init')
    .argument('[dir]', 'project directory', '.')
    .option('--name <name>', 'project display name')
    .option('--force', 'overwrite existing bimctl files')
    .description('initialize a bimctl project')
    .action(withErrors(program, async (directory = '.', options: { name?: string; force?: boolean }) => {
      const target = resolvePath(directory, commandCwd(program));
      const result = await initializeProject(target, { name: options.name, force: options.force });
      printResult(program, result, `Initialized bimctl project at ${result.directory}`);
    }));

  const model = program.command('model').description('create, validate, and export BIM JSON models');

  model.command('create')
    .option('-o, --out <file>', 'output BIM JSON file', 'model.bim.json')
    .option('--name <name>', 'project name')
    .option('--width <m>', 'space width in meters', numberOption)
    .option('--depth <m>', 'space depth in meters', numberOption)
    .option('--height <m>', 'space height in meters', numberOption)
    .option('--people <count>', 'number of occupants', numberOption)
    .description('create a valid shoebox BIM JSON model')
    .action(withErrors(program, async (options: { out: string; name?: string; width?: number; depth?: number; height?: number; people?: number }) => {
      const outputPath = resolvePath(options.out, commandCwd(program));
      const generated = createShoeboxModel({
        projectName: options.name,
        width: options.width,
        depth: options.depth,
        height: options.height,
        people: options.people
      });
      await writeJsonFile(outputPath, generated);
      printResult(program, { outputPath, model: generated }, `Created BIM model at ${outputPath}`);
    }));

  model.command('create-building')
    .option('-o, --out <file>', 'output BIM JSON file', 'building.bim.json')
    .option('--name <name>', 'project name')
    .option('--floors <n>', 'number of floors', integerOption)
    .option('--rows <n>', 'zone rows along the Y axis', integerOption)
    .option('--columns <n>', 'zone columns along the X axis', integerOption)
    .option('--zone-width <m>', 'zone width in meters', numberOption)
    .option('--zone-depth <m>', 'zone depth in meters', numberOption)
    .option('--floor-height <m>', 'floor-to-floor zone height in meters', numberOption)
    .option('--people-per-space <count>', 'occupants per generated space', numberOption)
    .option('--window-width <m>', 'generated perimeter window width in meters', numberOption)
    .option('--window-height <m>', 'generated perimeter window height in meters', numberOption)
    .description('create a multi-zone rectangular building BIM JSON model')
    .action(withErrors(program, async (options: { out: string; name?: string; floors?: number; rows?: number; columns?: number; zoneWidth?: number; zoneDepth?: number; floorHeight?: number; peoplePerSpace?: number; windowWidth?: number; windowHeight?: number }) => {
      const outputPath = resolvePath(options.out, commandCwd(program));
      const generated = createBuildingModel({
        projectName: options.name,
        floors: options.floors,
        rows: options.rows,
        columns: options.columns,
        zoneWidth: options.zoneWidth,
        zoneDepth: options.zoneDepth,
        floorHeight: options.floorHeight,
        peoplePerSpace: options.peoplePerSpace,
        windowWidth: options.windowWidth,
        windowHeight: options.windowHeight
      });
      await writeJsonFile(outputPath, generated);
      printResult(program, { outputPath, model: generated }, `Created multi-zone BIM model at ${outputPath}`);
    }));

  model.command('validate')
    .argument('<file>', 'BIM JSON model')
    .option('--strict', 'treat warnings as errors')
    .description('validate a BIM JSON model')
    .action(withErrors(program, async (file: string, options: { strict?: boolean }) => {
      const modelPath = resolvePath(file, commandCwd(program));
      const result = validateBimModel(await readJsonFile(modelPath), { strict: options.strict });
      printResult(program, { modelPath, ...result }, result.valid ? 'Model is valid' : 'Model is invalid');
      if (!result.valid) process.exitCode = 1;
    }));

  model.command('report')
    .argument('<file>', 'BIM JSON model')
    .option('--csv <file>', 'write per-space engineering metrics as CSV')
    .description('summarize engineering quantities, loads, envelope area, and WWR')
    .action(withErrors(program, async (file: string, options: { csv?: string }) => {
      const cwd = commandCwd(program);
      const modelPath = resolvePath(file, cwd);
      const metrics = await analyzeBimModelFile(modelPath);
      const csvPath = options.csv ? resolvePath(options.csv, cwd) : undefined;
      if (csvPath) await writeTextFile(csvPath, spaceMetricsCsv(metrics));

      if (outputMode(program) === 'json') {
        printJson({ ok: true, data: { modelPath, csvPath, metrics } });
      } else {
        process.stdout.write(`${formatModelReport(metrics, csvPath)}\n`);
      }
    }));

  model.command('export-idf')
    .argument('<file>', 'BIM JSON model')
    .requiredOption('-o, --out <file>', 'output EnergyPlus IDF file')
    .option('--energyplus <command>', 'EnergyPlus executable used to infer the target IDF version')
    .option('--energyplus-version <version>', 'target EnergyPlus version for the exported IDF')
    .description('export an EnergyPlus IDF from a BIM JSON model')
    .action(withErrors(program, async (file: string, options: { out: string; energyplus?: string; energyplusVersion?: string }) => {
      const modelPath = resolvePath(file, commandCwd(program));
      const outputPath = resolvePath(options.out, commandCwd(program));
      const result = await exportIdfFromModelFile(modelPath, outputPath, {
        energyPlusCommand: options.energyplus,
        energyPlusVersion: options.energyplusVersion,
        cwd: commandCwd(program)
      });
      printResult(program, result, `Wrote EnergyPlus IDF to ${result.idfPath}`);
    }));

  const freecad = program.command('freecad').description('FreeCAD model build commands');
  freecad.command('build')
    .argument('<file>', 'BIM JSON model')
    .requiredOption('-o, --out <file>', 'output .FCStd path')
    .option('--freecad <command>', 'FreeCADCmd/freecadcmd/AppImage command')
    .option('--dry-run', 'write scripts and metadata without executing FreeCAD')
    .option('--timeout-ms <ms>', 'external process timeout', numberOption)
    .description('build a FreeCAD model from BIM JSON')
    .action(withErrors(program, async (file: string, options: { out: string; freecad?: string; dryRun?: boolean; timeoutMs?: number }) => {
      const modelPath = resolvePath(file, commandCwd(program));
      const outputPath = resolvePath(options.out, commandCwd(program));
      const result = await buildFreeCadModel(modelPath, {
        outputPath,
        freecadCommand: options.freecad,
        dryRun: options.dryRun,
        timeoutMs: options.timeoutMs,
        cwd: commandCwd(program)
      });
      printResult(program, result, `${result.status === 'dry-run' ? 'Prepared' : 'Built'} FreeCAD model at ${result.outputPath}`);
    }));

  program.command('simulate')
    .argument('<file>', 'BIM JSON model')
    .option('-o, --out <dir>', 'simulation output directory')
    .option('--energyplus <command>', 'EnergyPlus executable')
    .option('--energyplus-version <version>', 'target EnergyPlus version for generated IDF')
    .option('--weather <epw>', 'optional EPW weather file')
    .option('--jobs <n>', 'EnergyPlus worker threads', numberOption)
    .option('--dry-run', 'write reproducible EnergyPlus inputs without executing EnergyPlus')
    .option('--timeout-ms <ms>', 'external process timeout', numberOption)
    .description('orchestrate an EnergyPlus simulation')
    .action(withErrors(program, async (file: string, options: { out?: string; energyplus?: string; energyplusVersion?: string; weather?: string; jobs?: number; dryRun?: boolean; timeoutMs?: number }) => {
      const cwd = commandCwd(program);
      const modelPath = resolvePath(file, cwd);
      const outputDir = resolvePath(options.out ?? join('runs', new Date().toISOString().replace(/[:.]/g, '-')), cwd);
      const result = await simulateModel(modelPath, {
        outputDir,
        energyPlusCommand: options.energyplus,
        energyPlusVersion: options.energyplusVersion,
        weatherPath: options.weather ? resolvePath(options.weather, cwd) : undefined,
        jobs: options.jobs,
        dryRun: options.dryRun,
        timeoutMs: options.timeoutMs,
        cwd
      });
      printResult(program, result, `${result.status === 'dry-run' ? 'Prepared' : 'Completed'} simulation in ${result.outputDir}`);
    }));

  program.command('mcp')
    .description('start the bimctl MCP server over stdio')
    .action(withErrors(program, async () => {
      await startMcpServer();
    }));

  return program;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectExecution()) {
  await createCli().parseAsync(process.argv);
}