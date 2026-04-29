import { createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectEngines } from './detect.js';
import { ensureDirectory, isExecutable, readJsonFile, writeJsonFile, writeTextFile } from '../fs.js';
import { runExternalCommand } from '../process.js';
import { BimModelSchema, validateBimModel } from '../schema.js';
import { BimctlError, ExternalRunResult } from '../types.js';

const FREECAD_APPIMAGE_EXTRACT_TIMEOUT_MS = 120_000;

export interface FreeCadBuildOptions {
  outputPath: string;
  freecadCommand?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  cwd?: string;
}

export interface FreeCadBuildResult {
  modelPath: string;
  outputPath: string;
  scriptPath: string;
  status: 'dry-run' | 'completed';
  command?: string;
  args?: string[];
  run?: ExternalRunResult;
}

export function buildFreeCadPythonScript(): string {
  return String.raw`import json
import sys

import FreeCAD as App
import Part


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: freecad-build.py MODEL_JSON OUTPUT_FCSTD")

    model_path = sys.argv[-2]
    output_path = sys.argv[-1]
    with open(model_path, "r", encoding="utf-8") as handle:
        model = json.load(handle)

    doc = App.newDocument(model["project"]["id"].replace("-", "_"))
    for space in model["spaces"]:
        dimensions = space["dimensions"]
        origin = space.get("origin", {"x": 0, "y": 0, "z": 0})
        shape = Part.makeBox(
            float(dimensions["width"]),
            float(dimensions["depth"]),
            float(dimensions["height"]),
            App.Vector(float(origin["x"]), float(origin["y"]), float(origin["z"])),
        )
        feature = doc.addObject("Part::Feature", space["id"])
        feature.Label = space["name"]
        feature.Shape = shape

    doc.recompute()
    doc.saveAs(output_path)


if __name__ == "__main__":
    main()
`;
}

async function extractAppImageFreeCadCmd(command: string): Promise<string> {
  const info = await stat(command);
  const cacheKey = createHash('sha256')
    .update(`${command}:${info.size}:${info.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const extractionRoot = join(tmpdir(), 'bimctl-freecad-appimage', cacheKey);
  const freecadCmd = join(extractionRoot, 'squashfs-root', 'usr', 'bin', 'freecadcmd');

  if (await isExecutable(freecadCmd)) return freecadCmd;

  await rm(extractionRoot, { recursive: true, force: true });
  await ensureDirectory(extractionRoot);

  const extraction = await runExternalCommand(command, ['--appimage-extract'], {
    cwd: extractionRoot,
    timeoutMs: FREECAD_APPIMAGE_EXTRACT_TIMEOUT_MS,
    maxOutputBytes: 20_000
  });

  if (extraction.timedOut) {
    throw new BimctlError('freecad_extract_timeout', `FreeCAD AppImage extraction exceeded ${FREECAD_APPIMAGE_EXTRACT_TIMEOUT_MS} ms.`, {
      stderr: extraction.stderr.slice(-4000),
      stdout: extraction.stdout.slice(-4000)
    });
  }

  if (extraction.exitCode !== 0 || !await isExecutable(freecadCmd)) {
    throw new BimctlError('freecad_extract_failed', 'Unable to locate freecadcmd inside the FreeCAD AppImage.', {
      stderr: extraction.stderr.slice(-4000),
      stdout: extraction.stdout.slice(-4000)
    });
  }

  return freecadCmd;
}

async function resolveFreeCadCommand(command: string): Promise<string> {
  return basename(command).toLowerCase().endsWith('.appimage')
    ? await extractAppImageFreeCadCmd(command)
    : command;
}

function freecadArgs(scriptPath: string, modelPath: string, outputPath: string): string[] {
  return [scriptPath, '--pass', modelPath, outputPath];
}

export async function buildFreeCadModel(modelPath: string, options: FreeCadBuildOptions): Promise<FreeCadBuildResult> {
  const input = await readJsonFile(modelPath);
  const model = BimModelSchema.parse(input);
  const validation = validateBimModel(model);
  if (!validation.valid) {
    throw new BimctlError('model_invalid', `Model failed validation: ${validation.errors.map((issue) => issue.message).join('; ')}`);
  }

  await ensureDirectory(dirname(options.outputPath));
  const scriptPath = `${options.outputPath}.freecad.py`;
  await writeTextFile(scriptPath, buildFreeCadPythonScript());
  await writeJsonFile(`${options.outputPath}.metadata.json`, {
    modelPath,
    outputPath: options.outputPath,
    createdAt: new Date().toISOString(),
    zones: model.spaces.length
  });

  if (options.dryRun) {
    return { modelPath, outputPath: options.outputPath, scriptPath, status: 'dry-run' };
  }

  const command = options.freecadCommand ?? (await detectEngines({ cwd: options.cwd })).freecad?.command;
  if (!command) {
    throw new BimctlError('freecad_not_found', 'FreeCAD executable was not found. Set BIMCTL_FREECAD_CMD or pass --freecad.');
  }

  const resolvedCommand = await resolveFreeCadCommand(command);
  const args = freecadArgs(scriptPath, modelPath, options.outputPath);
  const run = await runExternalCommand(resolvedCommand, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000
  });

  if (run.timedOut) {
    throw new BimctlError('freecad_timeout', `FreeCAD exceeded the configured timeout of ${options.timeoutMs ?? 5 * 60 * 1000} ms.`, {
      stderr: run.stderr.slice(-4000),
      stdout: run.stdout.slice(-4000)
    });
  }

  if (run.exitCode !== 0) {
    throw new BimctlError('freecad_failed', `FreeCAD exited with code ${run.exitCode ?? 'unknown'}.`, {
      stderr: run.stderr.slice(-4000),
      stdout: run.stdout.slice(-4000)
    });
  }

  return {
    modelPath,
    outputPath: options.outputPath,
    scriptPath,
    status: 'completed',
    command: resolvedCommand,
    args,
    run
  };
}