import { basename, join } from 'node:path';
import { detectEngines } from './detect.js';
import { ensureDirectory, readJsonFile, writeJsonFile, writeTextFile } from '../fs.js';
import { generateEnergyPlusIdf } from '../idf.js';
import { runExternalCommand } from '../process.js';
import { BimModelSchema, validateBimModel } from '../schema.js';
import { BimctlError, ExternalRunResult } from '../types.js';

const ENERGYPLUS_VERSION_TIMEOUT_MS = 4_000;

export interface ExportIdfOptions {
  energyPlusCommand?: string;
  energyPlusVersion?: string;
  cwd?: string;
}

export interface ExportIdfResult {
  idfPath: string;
  bytes: number;
  zones: number;
}

export interface SimulateOptions {
  outputDir: string;
  energyPlusCommand?: string;
  energyPlusVersion?: string;
  weatherPath?: string;
  jobs?: number;
  dryRun?: boolean;
  timeoutMs?: number;
  cwd?: string;
}

export interface SimulationResult {
  modelPath: string;
  outputDir: string;
  idfPath: string;
  status: 'dry-run' | 'completed';
  command?: string;
  args?: string[];
  run?: ExternalRunResult;
  reports: {
    errPath: string;
    sqlitePath: string;
  };
}

function parseEnergyPlusVersion(output: string): string | undefined {
  const match = output.match(/Version\s+(\d+\.\d+)/i);
  return match?.[1];
}

async function detectEnergyPlusVersion(command: string, cwd?: string): Promise<string | undefined> {
  const run = await runExternalCommand(command, ['--version'], {
    cwd,
    timeoutMs: ENERGYPLUS_VERSION_TIMEOUT_MS,
    maxOutputBytes: 8_000
  });

  if (run.timedOut || run.exitCode !== 0) return undefined;
  return parseEnergyPlusVersion(`${run.stdout}\n${run.stderr}`);
}

async function resolveEnergyPlusVersion(options: ExportIdfOptions): Promise<string | undefined> {
  if (options.energyPlusVersion) return options.energyPlusVersion;
  if (!options.energyPlusCommand) return undefined;
  return await detectEnergyPlusVersion(options.energyPlusCommand, options.cwd);
}

export async function exportIdfFromModelFile(modelPath: string, idfPath: string, options: ExportIdfOptions = {}): Promise<ExportIdfResult> {
  const input = await readJsonFile(modelPath);
  const validation = validateBimModel(input);
  if (!validation.valid || !validation.model) {
    throw new BimctlError('model_invalid', `Model failed validation: ${validation.errors.map((issue) => issue.message).join('; ')}`);
  }

  const idf = generateEnergyPlusIdf(validation.model, {
    energyPlusVersion: await resolveEnergyPlusVersion(options)
  });
  await writeTextFile(idfPath, idf);
  return { idfPath, bytes: Buffer.byteLength(idf), zones: validation.model.spaces.length };
}

export async function simulateModel(modelPath: string, options: SimulateOptions): Promise<SimulationResult> {
  await ensureDirectory(options.outputDir);
  const input = await readJsonFile(modelPath);
  const model = BimModelSchema.parse(input);
  const validation = validateBimModel(model);
  if (!validation.valid) {
    throw new BimctlError('model_invalid', `Model failed validation: ${validation.errors.map((issue) => issue.message).join('; ')}`);
  }

  if (options.jobs !== undefined && (!Number.isInteger(options.jobs) || options.jobs < 1)) {
    throw new BimctlError('invalid_jobs', 'EnergyPlus jobs must be a positive integer.');
  }

  const command = options.energyPlusCommand ?? (await detectEngines({ cwd: options.cwd })).energyplus?.command;
  if (!options.dryRun && !command) {
    throw new BimctlError('energyplus_not_found', 'EnergyPlus executable was not found. Set BIMCTL_ENERGYPLUS_CMD or pass --energyplus.');
  }

  const energyPlusVersion = await resolveEnergyPlusVersion({
    energyPlusCommand: command,
    energyPlusVersion: options.energyPlusVersion,
    cwd: options.cwd
  });

  const idfPath = join(options.outputDir, `${basename(modelPath).replace(/\.json$/i, '')}.idf`);
  const idf = generateEnergyPlusIdf(model, { energyPlusVersion });
  await writeTextFile(idfPath, idf);
  await writeJsonFile(join(options.outputDir, 'bimctl-run.json'), {
    modelPath,
    idfPath,
    energyPlusVersion: energyPlusVersion ?? null,
    jobs: options.jobs ?? null,
    dryRun: Boolean(options.dryRun),
    createdAt: new Date().toISOString()
  });

  const reports = {
    errPath: join(options.outputDir, 'eplusout.err'),
    sqlitePath: join(options.outputDir, 'eplusout.sql')
  };

  if (options.dryRun) {
    return { modelPath, outputDir: options.outputDir, idfPath, status: 'dry-run', reports };
  }

  if (!command) {
    throw new BimctlError('energyplus_not_found', 'EnergyPlus executable was not found. Set BIMCTL_ENERGYPLUS_CMD or pass --energyplus.');
  }

  const args = ['-d', options.outputDir, '-x'];
  if (options.weatherPath) args.push('-w', options.weatherPath);
  if (options.jobs) args.push('-j', String(options.jobs));
  args.push(idfPath);

  const run = await runExternalCommand(command, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000
  });

  if (run.timedOut) {
    throw new BimctlError('energyplus_timeout', `EnergyPlus exceeded the configured timeout of ${options.timeoutMs ?? 10 * 60 * 1000} ms.`, {
      stderr: run.stderr.slice(-4000),
      stdout: run.stdout.slice(-4000)
    });
  }

  if (run.exitCode !== 0) {
    throw new BimctlError('energyplus_failed', `EnergyPlus exited with code ${run.exitCode ?? 'unknown'}.`, {
      stderr: run.stderr.slice(-4000),
      stdout: run.stdout.slice(-4000)
    });
  }

  return {
    modelPath,
    outputDir: options.outputDir,
    idfPath,
    status: 'completed',
    command,
    args,
    run,
    reports
  };
}