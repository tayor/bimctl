import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateModel } from '../src/engines/energyplus.js';
import { initializeProject } from '../src/project.js';

async function writeExecutable(filePath: string, content: string): Promise<string> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}

describe('EnergyPlus orchestration', () => {
  it('passes through the configured job count to the EnergyPlus process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-energyplus-'));
    const project = await initializeProject(directory, { name: 'EnergyPlus Test' });
    const energyPlusPath = await writeExecutable(join(directory, 'energyplus'), `#!/bin/sh
set -eu
if [ "$#" -gt 0 ] && [ "$1" = "--version" ]; then
  echo "EnergyPlus, Version 25.2.0-cf7368216c"
  exit 0
fi
output_dir=""
jobs=""
expand="no"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d)
      output_dir="$2"
      shift 2
      ;;
    -x)
      expand="yes"
      shift
      ;;
    -j)
      jobs="$2"
      shift 2
      ;;
    *)
      input_path="$1"
      shift
      ;;
  esac
done
printf '%s' "$jobs" > "$output_dir/jobs.txt"
printf '%s' "$expand" > "$output_dir/expand.txt"
printf '%s' "$input_path" > "$output_dir/input.txt"
: > "$output_dir/eplusout.err"
: > "$output_dir/eplusout.sql"
`);

    const result = await simulateModel(project.modelPath, {
      outputDir: join(directory, 'runs', 'sim'),
      energyPlusCommand: energyPlusPath,
      jobs: 1,
      timeoutMs: 2_000
    });

    expect(result.status).toBe('completed');
    expect(result.args).toContain('-x');
    expect(result.args).toContain('-j');
    expect(result.args).toContain('1');
    expect(await readFile(join(directory, 'runs', 'sim', 'expand.txt'), 'utf8')).toBe('yes');
    expect(await readFile(join(directory, 'runs', 'sim', 'jobs.txt'), 'utf8')).toBe('1');
    expect(await readFile(join(directory, 'runs', 'sim', 'input.txt'), 'utf8')).toBe(result.idfPath);
    expect(await readFile(result.idfPath, 'utf8')).toContain('Version,\n  25.2;');
  });
});