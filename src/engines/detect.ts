import { readdir } from 'node:fs/promises';
import { basename, delimiter, join } from 'node:path';
import { fileSize, isExecutable, pathExists, resolvePath } from '../fs.js';
import { runExternalCommand } from '../process.js';

const ENGINE_PROBE_TIMEOUT_MS = 4_000;

export interface EngineArtifact {
  path: string;
  kind: 'executable' | 'installer' | 'appimage';
  executable: boolean;
  sizeBytes: number | null;
}

export interface EngineExecutable {
  command: string;
  source: 'env' | 'path' | 'workspace' | 'known-location';
  executable: boolean;
  runnable: boolean;
  probeMessage?: string;
}

export interface EngineDetectionResult {
  cwd: string;
  freecad: EngineExecutable | null;
  energyplus: EngineExecutable | null;
  artifacts: {
    freecadAppImages: EngineArtifact[];
    energyPlusInstallers: EngineArtifact[];
  };
  ready: boolean;
  recommendations: string[];
}

function probeArgsFor(command: string): string[] {
  const commandName = basename(command).toLowerCase();
  if (commandName === 'energyplus') return ['--version'];
  if (commandName.endsWith('.appimage')) return ['--appimage-version'];
  return ['--version'];
}

function formatProbeFailure(output: string): string {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? `startup probe failed: ${firstLine}` : 'startup probe failed.';
}

async function probeExecutable(command: string): Promise<Pick<EngineExecutable, 'runnable' | 'probeMessage'>> {
  const run = await runExternalCommand(command, probeArgsFor(command), {
    timeoutMs: ENGINE_PROBE_TIMEOUT_MS,
    maxOutputBytes: 8_000
  });

  if (run.timedOut) {
    return {
      runnable: false,
      probeMessage: `startup probe timed out after ${ENGINE_PROBE_TIMEOUT_MS} ms.`
    };
  }

  if (run.exitCode === 0) {
    return { runnable: true };
  }

  return {
    runnable: false,
    probeMessage: formatProbeFailure(run.stderr || run.stdout)
  };
}

async function executableCandidate(command: string, source: EngineExecutable['source']): Promise<EngineExecutable | null> {
  if (!await pathExists(command)) return null;
  const executable = await isExecutable(command);
  if (!executable) {
    return {
      command,
      source,
      executable,
      runnable: false,
      probeMessage: 'File exists but is not executable.'
    };
  }

  return {
    command,
    source,
    executable,
    ...(await probeExecutable(command))
  };
}

async function findOnPath(names: string[], env: NodeJS.ProcessEnv): Promise<EngineExecutable | null> {
  const pathValue = env.PATH ?? '';
  let firstCandidate: EngineExecutable | null = null;
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (await pathExists(candidate)) {
        const detected = await executableCandidate(candidate, 'path');
        if (!detected) continue;
        if (!firstCandidate) firstCandidate = detected;
        if (detected.executable && detected.runnable) return detected;
      }
    }
  }
  return firstCandidate;
}

async function findWorkspaceInstalledEnergyPlus(cwd: string): Promise<EngineExecutable | null> {
  const candidatePaths: string[] = [];
  const searchRoots = [cwd, join(cwd, '.tools')];

  for (const root of searchRoots) {
    const entries = await readdir(root).catch(() => []);
    for (const entry of entries) {
      if (!/^EnergyPlus-[^.].*/.test(entry)) continue;
      const candidate = join(root, entry, 'energyplus');
      if (await pathExists(candidate)) {
        candidatePaths.push(candidate);
      }
    }
  }

  const uniqueCandidates = [...new Set(candidatePaths)].sort((left, right) => right.localeCompare(left));
  let firstCandidate: EngineExecutable | null = null;
  for (const candidate of uniqueCandidates) {
    const detected = await executableCandidate(candidate, 'workspace');
    if (!detected) continue;
    if (!firstCandidate) firstCandidate = detected;
    if (detected.executable && detected.runnable) return detected;
  }

  return firstCandidate;
}

async function findKnownEnergyPlus(knownLocations: string[]): Promise<EngineExecutable | null> {
  let firstCandidate: EngineExecutable | null = null;
  for (const location of knownLocations) {
    const detected = await executableCandidate(location, 'known-location');
    if (!detected) continue;
    if (!firstCandidate) firstCandidate = detected;
    if (detected.executable && detected.runnable) return detected;
  }

  return firstCandidate;
}

function preferRunnable(...candidates: Array<EngineExecutable | null>): EngineExecutable | null {
  return candidates.find((candidate) => candidate?.executable && candidate.runnable) ?? candidates.find((candidate) => candidate !== null) ?? null;
}

async function workspaceArtifacts(cwd: string): Promise<EngineDetectionResult['artifacts']> {
  const entries = await readdir(cwd).catch(() => []);
  const freecadAppImages: EngineArtifact[] = [];
  const energyPlusInstallers: EngineArtifact[] = [];

  for (const entry of entries) {
    const absolutePath = join(cwd, entry);
    if (/^FreeCAD_.*\.AppImage$/i.test(entry)) {
      freecadAppImages.push({
        path: absolutePath,
        kind: 'appimage',
        executable: await isExecutable(absolutePath),
        sizeBytes: await fileSize(absolutePath)
      });
    }
    if (/^EnergyPlus-.*\.run$/i.test(entry)) {
      energyPlusInstallers.push({
        path: absolutePath,
        kind: 'installer',
        executable: await isExecutable(absolutePath),
        sizeBytes: await fileSize(absolutePath)
      });
    }
  }

  return { freecadAppImages, energyPlusInstallers };
}

export async function detectEngines(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<EngineDetectionResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const artifacts = await workspaceArtifacts(cwd);
  const recommendations: string[] = [];

  const freecadEnv = env.BIMCTL_FREECAD_CMD ?? env.FREECAD_CMD;
  const energyplusEnv = env.BIMCTL_ENERGYPLUS_CMD ?? env.ENERGYPLUS_EXE;

  let freecad = freecadEnv
    ? await executableCandidate(resolvePath(freecadEnv, cwd), 'env')
    : await findOnPath(['FreeCADCmd', 'freecadcmd', 'freecad'], env);

  if (!freecadEnv) {
    const executableAppImage = artifacts.freecadAppImages.find((artifact) => artifact.executable);
    if (executableAppImage) {
      freecad = preferRunnable(freecad, await executableCandidate(executableAppImage.path, 'workspace'));
    }
  }

  const knownEnergyPlusLocations = [
    '/usr/local/EnergyPlus-26-1-0/energyplus',
    '/usr/local/EnergyPlus-26.1.0/energyplus',
    '/usr/local/bin/energyplus'
  ];
  const pathEnergyPlus = energyplusEnv
    ? await executableCandidate(resolvePath(energyplusEnv, cwd), 'env')
    : await findOnPath(['energyplus'], env);
  let energyplus = pathEnergyPlus;

  if (!energyplusEnv) {
    energyplus = preferRunnable(
      pathEnergyPlus,
      await findWorkspaceInstalledEnergyPlus(cwd),
      await findKnownEnergyPlus(knownEnergyPlusLocations)
    );
  }

  if (freecad && !freecad.runnable) {
    recommendations.push(`FreeCAD was found at ${freecad.command} but ${freecad.probeMessage ?? 'it failed a startup probe.'}`);
  } else if (!freecad && artifacts.freecadAppImages.length > 0) {
    recommendations.push('Make the FreeCAD AppImage executable with chmod +x, or set BIMCTL_FREECAD_CMD to FreeCADCmd/freecadcmd.');
  } else if (!freecad) {
    recommendations.push('Install FreeCAD or set BIMCTL_FREECAD_CMD to a FreeCADCmd/freecadcmd executable.');
  }

  if (energyplus && !energyplus.runnable) {
    recommendations.push(`EnergyPlus was found at ${energyplus.command} but ${energyplus.probeMessage ?? 'it failed a startup probe.'}`);
  } else if (!energyplus && artifacts.energyPlusInstallers.length > 0) {
    recommendations.push('Run the EnergyPlus installer, then set BIMCTL_ENERGYPLUS_CMD to the installed energyplus executable if it is not on PATH.');
  } else if (!energyplus) {
    recommendations.push('Install EnergyPlus or set BIMCTL_ENERGYPLUS_CMD to an energyplus executable.');
  }

  return {
    cwd,
    freecad,
    energyplus,
    artifacts,
    ready: Boolean(freecad?.executable && freecad.runnable && energyplus?.executable && energyplus.runnable),
    recommendations
  };
}