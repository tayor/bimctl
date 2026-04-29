import { execFile } from 'node:child_process';
import { mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const CLI_TIMEOUT_MS = 5_000;

async function runCli(args: string[], cwd: string) {
  const result = await execFileAsync(process.execPath, [cliPath, '--json', '--cwd', cwd, ...args], {
    cwd,
    timeout: CLI_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });
  return JSON.parse(result.stdout);
}

describe('bimctl CLI', () => {
  it('runs an end-to-end dry-run workflow through the compiled bin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-cli-'));
    const init = await runCli(['init', '.', '--name', 'CLI Project'], directory);
    expect(init.ok).toBe(true);

    const modelPath = join(directory, 'models', 'shoebox.bim.json');
    const validate = await runCli(['model', 'validate', modelPath], directory);
    expect(validate.data.valid).toBe(true);

    const simulate = await runCli(['simulate', modelPath, '--out', 'runs/cli', '--dry-run'], directory);
    expect(simulate.data.status).toBe('dry-run');
    expect(await readFile(join(directory, 'runs', 'cli', 'shoebox.bim.idf'), 'utf8')).toContain('CLI Project');
  });

  it('creates and exports a multi-zone building through the compiled bin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-cli-building-'));
    const create = await runCli([
      'model',
      'create-building',
      '--out',
      'building.bim.json',
      '--name',
      'CLI Building',
      '--floors',
      '1',
      '--rows',
      '1',
      '--columns',
      '2'
    ], directory);
    expect(create.ok).toBe(true);
    expect(create.data.model.spaces).toHaveLength(2);

    const exportIdf = await runCli(['model', 'export-idf', 'building.bim.json', '--out', 'building.idf'], directory);
    expect(exportIdf.data.zones).toBe(2);
    expect(await readFile(join(directory, 'building.idf'), 'utf8')).toContain('F1_R1_C2 west');

    const report = await runCli(['model', 'report', 'building.bim.json', '--csv', 'spaces.csv'], directory);
    expect(report.data.metrics.summary.spaceCount).toBe(2);
    expect(report.data.metrics.summary.floorAreaM2).toBe(60);
    expect(await readFile(join(directory, 'spaces.csv'), 'utf8')).toContain('windowToWallRatio');
  });

  it('executes correctly through an npm-style bin symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-symlink-'));
    const binPath = join(directory, 'bimctl');
    await symlink(cliPath, binPath);

    const result = await execFileAsync(binPath, ['--version'], {
      cwd: directory,
      timeout: CLI_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    });
    expect(result.stdout.trim()).toBe('0.1.0');
  });
});