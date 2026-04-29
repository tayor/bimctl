import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectEngines } from '../src/engines/detect.js';

async function writeExecutable(filePath: string, content: string): Promise<string> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}

describe('engine detection', () => {
  it('marks env-provided engines as ready when their startup probes succeed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-detect-ok-'));
    const freecadPath = await writeExecutable(join(directory, 'FreeCADCmd'), `#!/bin/sh
case "$1" in
  --version)
    echo "FreeCAD 1.1.1"
    exit 0
    ;;
esac
echo "unexpected args: $*" >&2
exit 1
`);
    const energyPlusPath = await writeExecutable(join(directory, 'energyplus'), `#!/bin/sh
case "$1" in
  --version)
    echo "EnergyPlus 26.1.0"
    exit 0
    ;;
esac
echo "unexpected args: $*" >&2
exit 1
`);

    const detected = await detectEngines({
      cwd: directory,
      env: {
        ...process.env,
        BIMCTL_FREECAD_CMD: freecadPath,
        BIMCTL_ENERGYPLUS_CMD: energyPlusPath
      }
    });

    expect(detected.ready).toBe(true);
    expect(detected.freecad?.runnable).toBe(true);
    expect(detected.energyplus?.runnable).toBe(true);
    expect(detected.recommendations).toEqual([]);
  });

  it('reports a non-runnable EnergyPlus binary as not ready', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-detect-fail-'));
    const freecadPath = await writeExecutable(join(directory, 'FreeCADCmd'), `#!/bin/sh
echo "FreeCAD 1.1.1"
exit 0
`);
    const energyPlusPath = await writeExecutable(join(directory, 'energyplus'), `#!/bin/sh
echo "GLIBC_2.38 not found" >&2
exit 1
`);

    const detected = await detectEngines({
      cwd: directory,
      env: {
        ...process.env,
        BIMCTL_FREECAD_CMD: freecadPath,
        BIMCTL_ENERGYPLUS_CMD: energyPlusPath
      }
    });

    expect(detected.ready).toBe(false);
    expect(detected.energyplus?.executable).toBe(true);
    expect(detected.energyplus?.runnable).toBe(false);
    expect(detected.energyplus?.probeMessage).toContain('GLIBC_2.38 not found');
    expect(detected.recommendations.some((value) => value.includes('GLIBC_2.38 not found'))).toBe(true);
  });

  it('prefers a runnable workspace EnergyPlus install from .tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-detect-tools-'));
    await mkdir(join(directory, '.tools', 'EnergyPlus-25.2.0'), { recursive: true });
    const energyPlusPath = await writeExecutable(join(directory, '.tools', 'EnergyPlus-25.2.0', 'energyplus'), `#!/bin/sh
case "$1" in
  --version)
    echo "EnergyPlus, Version 25.2.0-cf7368216c"
    exit 0
    ;;
esac
exit 1
`);

    const detected = await detectEngines({
      cwd: directory,
      env: {
        ...process.env,
        PATH: ''
      }
    });

    expect(detected.energyplus?.command).toBe(energyPlusPath);
    expect(detected.energyplus?.runnable).toBe(true);
  });
});