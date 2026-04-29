export { createCli } from './cli.js';
export { analyzeBimModel, analyzeBimModelFile, spaceMetricsCsv, type ModelEngineeringMetrics, type SpaceEngineeringMetrics } from './analysis.js';
export { detectEngines } from './engines/detect.js';
export { exportIdfFromModelFile, simulateModel } from './engines/energyplus.js';
export { buildFreeCadModel, buildFreeCadPythonScript } from './engines/freecad.js';
export { generateEnergyPlusIdf } from './idf.js';
export { initializeProject } from './project.js';
export {
  BimModelSchema,
  createBuildingModel,
  createShoeboxModel,
  validateBimModel,
  type BimModel,
  type BimSpace,
  type ValidationResult
} from './schema.js';
export { startMcpServer } from './mcp.js';