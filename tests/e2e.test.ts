import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFreeCadModel } from '../src/engines/freecad.js';
import { exportIdfFromModelFile, simulateModel } from '../src/engines/energyplus.js';
import { initializeProject } from '../src/project.js';

describe('dry-run BIM workflow', () => {
  it('initializes, exports IDF, prepares FreeCAD, and prepares simulation inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-e2e-'));
    const project = await initializeProject(directory, { name: 'E2E Project' });
    const idfPath = join(directory, 'runs', 'shoebox.idf');
    const idf = await exportIdfFromModelFile(project.modelPath, idfPath);
    expect(idf.zones).toBe(1);
    expect(await readFile(idfPath, 'utf8')).toContain('E2E Project');

    const freecad = await buildFreeCadModel(project.modelPath, {
      outputPath: join(directory, 'runs', 'shoebox.FCStd'),
      dryRun: true
    });
    expect(freecad.status).toBe('dry-run');
    expect(await readFile(freecad.scriptPath, 'utf8')).toContain('Part.makeBox');

    const simulation = await simulateModel(project.modelPath, {
      outputDir: join(directory, 'runs', 'sim'),
      dryRun: true
    });
    expect(simulation.status).toBe('dry-run');
    expect(await readFile(simulation.idfPath, 'utf8')).toContain('HVACTemplate:Zone:IdealLoadsAirSystem');
  });
});