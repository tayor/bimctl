import { join } from 'node:path';
import { assertWritableTarget, ensureDirectory, writeJsonFile } from './fs.js';
import { createShoeboxModel } from './schema.js';
import { VERSION } from './version.js';

export interface ProjectManifest {
  schema: 'https://tayor.github.io/bimctl/schemas/project.schema.json';
  name: string;
  bimctlVersion: string;
  defaultModel: string;
  runsDir: string;
  engines: {
    freecadCommandEnv: 'BIMCTL_FREECAD_CMD';
    energyPlusCommandEnv: 'BIMCTL_ENERGYPLUS_CMD';
  };
}

export interface InitializeProjectOptions {
  name?: string;
  force?: boolean;
}

export interface InitializeProjectResult {
  directory: string;
  manifestPath: string;
  modelPath: string;
  runsDir: string;
}

export async function initializeProject(directory: string, options: InitializeProjectOptions = {}): Promise<InitializeProjectResult> {
  const manifestPath = join(directory, 'bimctl.project.json');
  const modelPath = join(directory, 'models', 'shoebox.bim.json');
  const runsDir = join(directory, 'runs');
  const projectName = options.name ?? 'bimctl project';

  await assertWritableTarget(manifestPath, options.force);
  await assertWritableTarget(modelPath, options.force);
  await ensureDirectory(join(directory, 'models'));
  await ensureDirectory(runsDir);

  const manifest: ProjectManifest = {
    schema: 'https://tayor.github.io/bimctl/schemas/project.schema.json',
    name: projectName,
    bimctlVersion: VERSION,
    defaultModel: 'models/shoebox.bim.json',
    runsDir: 'runs',
    engines: {
      freecadCommandEnv: 'BIMCTL_FREECAD_CMD',
      energyPlusCommandEnv: 'BIMCTL_ENERGYPLUS_CMD'
    }
  };

  await writeJsonFile(manifestPath, manifest);
  await writeJsonFile(modelPath, createShoeboxModel({ projectName }));

  return { directory, manifestPath, modelPath, runsDir };
}