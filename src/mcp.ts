import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeBimModelFile } from './analysis.js';
import { detectEngines } from './engines/detect.js';
import { exportIdfFromModelFile, simulateModel } from './engines/energyplus.js';
import { buildFreeCadModel } from './engines/freecad.js';
import { resolvePath, writeJsonFile } from './fs.js';
import { initializeProject } from './project.js';
import { createBuildingModel, createShoeboxModel, validateBimModel } from './schema.js';
import { readJsonFile } from './fs.js';
import { VERSION } from './version.js';

interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
}

function structuredPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { result: payload };
}

function toolResult(payload: unknown): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: structuredPayload(payload)
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'bimctl', version: VERSION },
    {
      instructions: 'Use bimctl tools for deterministic BIM JSON creation, validation, FreeCAD model builds, and EnergyPlus simulation orchestration. Prefer dryRun first when exploring.'
    }
  );

  server.registerTool(
    'bimctl_doctor',
    {
      title: 'Detect BIM engines',
      description: 'Detect FreeCAD and EnergyPlus executables and local installer artifacts.',
      inputSchema: z.object({ cwd: z.string().optional() })
    },
    async ({ cwd }) => toolResult(await detectEngines({ cwd: cwd ? resolvePath(cwd) : process.cwd() }))
  );

  server.registerTool(
    'bimctl_init_project',
    {
      title: 'Initialize BIM project',
      description: 'Create a bimctl project manifest, models directory, runs directory, and sample shoebox model.',
      inputSchema: z.object({ directory: z.string(), name: z.string().optional(), force: z.boolean().optional() })
    },
    async ({ directory, name, force }) => toolResult(await initializeProject(resolvePath(directory), { name, force }))
  );

  server.registerTool(
    'bimctl_create_model',
    {
      title: 'Create shoebox BIM model',
      description: 'Generate a valid single-zone BIM JSON model.',
      inputSchema: z.object({
        outputPath: z.string(),
        projectName: z.string().optional(),
        width: z.number().optional(),
        depth: z.number().optional(),
        height: z.number().optional(),
        people: z.number().optional()
      })
    },
    async ({ outputPath, projectName, width, depth, height, people }) => {
      const model = createShoeboxModel({ projectName, width, depth, height, people });
      const absoluteOutputPath = resolvePath(outputPath);
      await writeJsonFile(absoluteOutputPath, model);
      return toolResult({ outputPath: absoluteOutputPath, model });
    }
  );

  server.registerTool(
    'bimctl_create_building_model',
    {
      title: 'Create multi-zone BIM model',
      description: 'Generate a valid multi-floor, multi-zone rectangular BIM JSON model.',
      inputSchema: z.object({
        outputPath: z.string(),
        projectName: z.string().optional(),
        floors: z.number().int().positive().optional(),
        rows: z.number().int().positive().optional(),
        columns: z.number().int().positive().optional(),
        zoneWidth: z.number().positive().optional(),
        zoneDepth: z.number().positive().optional(),
        floorHeight: z.number().positive().optional(),
        peoplePerSpace: z.number().nonnegative().optional(),
        windowWidth: z.number().positive().optional(),
        windowHeight: z.number().positive().optional()
      })
    },
    async ({ outputPath, projectName, floors, rows, columns, zoneWidth, zoneDepth, floorHeight, peoplePerSpace, windowWidth, windowHeight }) => {
      const model = createBuildingModel({ projectName, floors, rows, columns, zoneWidth, zoneDepth, floorHeight, peoplePerSpace, windowWidth, windowHeight });
      const absoluteOutputPath = resolvePath(outputPath);
      await writeJsonFile(absoluteOutputPath, model);
      return toolResult({ outputPath: absoluteOutputPath, model });
    }
  );

  server.registerTool(
    'bimctl_validate_model',
    {
      title: 'Validate BIM model',
      description: 'Validate a bimctl BIM JSON model and return structured errors and warnings.',
      inputSchema: z.object({ modelPath: z.string(), strict: z.boolean().optional() })
    },
    async ({ modelPath, strict }) => {
      const absoluteModelPath = resolvePath(modelPath);
      return toolResult({ modelPath: absoluteModelPath, ...validateBimModel(await readJsonFile(absoluteModelPath), { strict }) });
    }
  );

  server.registerTool(
    'bimctl_analyze_model',
    {
      title: 'Analyze BIM model',
      description: 'Return engineering takeoff metrics such as area, volume, envelope, WWR, loads, and infiltration.',
      inputSchema: z.object({ modelPath: z.string() })
    },
    async ({ modelPath }) => toolResult(await analyzeBimModelFile(resolvePath(modelPath)))
  );

  server.registerTool(
    'bimctl_export_idf',
    {
      title: 'Export EnergyPlus IDF',
      description: 'Convert a BIM JSON model to an EnergyPlus IDF file.',
      inputSchema: z.object({
        modelPath: z.string(),
        outputPath: z.string(),
        energyPlusCommand: z.string().optional(),
        energyPlusVersion: z.string().optional()
      })
    },
    async ({ modelPath, outputPath, energyPlusCommand, energyPlusVersion }) => toolResult(await exportIdfFromModelFile(resolvePath(modelPath), resolvePath(outputPath), {
      energyPlusCommand,
      energyPlusVersion
    }))
  );

  server.registerTool(
    'bimctl_simulate',
    {
      title: 'Run EnergyPlus simulation',
      description: 'Create an IDF and run EnergyPlus, or perform a dry run that writes reproducible inputs.',
      inputSchema: z.object({
        modelPath: z.string(),
        outputDir: z.string(),
        energyPlusCommand: z.string().optional(),
        energyPlusVersion: z.string().optional(),
        weatherPath: z.string().optional(),
        jobs: z.number().int().positive().optional(),
        dryRun: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional()
      })
    },
    async ({ modelPath, outputDir, energyPlusCommand, energyPlusVersion, weatherPath, jobs, dryRun, timeoutMs }) => toolResult(await simulateModel(resolvePath(modelPath), {
      outputDir: resolvePath(outputDir),
      energyPlusCommand,
      energyPlusVersion,
      weatherPath: weatherPath ? resolvePath(weatherPath) : undefined,
      jobs,
      dryRun,
      timeoutMs
    }))
  );

  server.registerTool(
    'bimctl_freecad_build',
    {
      title: 'Build FreeCAD model',
      description: 'Create a FreeCAD model from BIM JSON, or dry-run and write the generated Python script.',
      inputSchema: z.object({
        modelPath: z.string(),
        outputPath: z.string(),
        freecadCommand: z.string().optional(),
        dryRun: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional()
      })
    },
    async ({ modelPath, outputPath, freecadCommand, dryRun, timeoutMs }) => toolResult(await buildFreeCadModel(resolvePath(modelPath), {
      outputPath: resolvePath(outputPath),
      freecadCommand,
      dryRun,
      timeoutMs
    }))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}