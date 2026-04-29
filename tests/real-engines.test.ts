import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectEngines } from '../src/engines/detect.js';
import { buildFreeCadModel } from '../src/engines/freecad.js';
import { simulateModel } from '../src/engines/energyplus.js';
import { initializeProject } from '../src/project.js';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

describe('real engine smoke', () => {
  it('builds a FreeCAD model and runs a bounded EnergyPlus smoke simulation', async () => {
    const detected = await detectEngines({ cwd: workspaceRoot });
    expect(detected.ready, detected.recommendations.join(' ')).toBe(true);
    expect(detected.freecad).not.toBeNull();
    expect(detected.energyplus).not.toBeNull();

    const previousAppImageMode = process.env.APPIMAGE_EXTRACT_AND_RUN;
    const previousOpenMpThreads = process.env.OMP_NUM_THREADS;

    try {
      if (detected.freecad?.command.toLowerCase().endsWith('.appimage')) {
        process.env.APPIMAGE_EXTRACT_AND_RUN = '1';
      }
      process.env.OMP_NUM_THREADS = '1';

      const directory = await mkdtemp(join(tmpdir(), 'bimctl-real-'));
      const project = await initializeProject(directory, { name: 'Real Smoke Test' });
      const freecadPath = join(directory, 'runs', 'shoebox.FCStd');
      const simulationDir = join(directory, 'runs', 'sim');

      const freecad = await buildFreeCadModel(project.modelPath, {
        outputPath: freecadPath,
        freecadCommand: detected.freecad?.command,
        timeoutMs: 30_000,
        cwd: workspaceRoot
      });
      expect(freecad.status).toBe('completed');
      expect((await stat(freecad.outputPath)).size).toBeGreaterThan(0);

      const simulation = await simulateModel(project.modelPath, {
        outputDir: simulationDir,
        energyPlusCommand: detected.energyplus?.command,
        jobs: 1,
        timeoutMs: 45_000,
        cwd: workspaceRoot
      });
      expect(simulation.status).toBe('completed');

      const errText = await readFile(simulation.reports.errPath, 'utf8');
      expect(errText).not.toContain('**  Fatal  **');
    } finally {
      if (previousAppImageMode === undefined) {
        delete process.env.APPIMAGE_EXTRACT_AND_RUN;
      } else {
        process.env.APPIMAGE_EXTRACT_AND_RUN = previousAppImageMode;
      }

      if (previousOpenMpThreads === undefined) {
        delete process.env.OMP_NUM_THREADS;
      } else {
        process.env.OMP_NUM_THREADS = previousOpenMpThreads;
      }
    }
  }, 90_000);
});