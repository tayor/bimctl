import { readJsonFile } from './fs.js';
import { BimModel, BimSpace, validateBimModel } from './schema.js';
import { BimctlError } from './types.js';

type SpaceSurface = 'floor' | 'roof' | 'south' | 'north' | 'east' | 'west';

interface Bounds {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  z1: number;
  z2: number;
}

export interface SpaceEngineeringMetrics {
  id: string;
  name: string;
  type: BimSpace['type'];
  floorAreaM2: number;
  volumeM3: number;
  exteriorWallAreaM2: number;
  windowAreaM2: number;
  windowToWallRatio: number;
  roofAreaM2: number;
  groundContactAreaM2: number;
  people: number;
  peopleDensityPerM2: number;
  lightingW: number;
  equipmentW: number;
  internalLoadW: number;
  infiltrationM3S: number;
  heatingSetpointC: number;
  coolingSetpointC: number;
}

export interface ModelEngineeringMetrics {
  modelPath?: string;
  project: {
    id: string;
    name: string;
  };
  site: {
    name: string;
    latitude: number;
    longitude: number;
    timeZone: number;
    elevationM: number;
  };
  summary: {
    spaceCount: number;
    floorCount: number;
    floorAreaM2: number;
    volumeM3: number;
    exteriorWallAreaM2: number;
    windowAreaM2: number;
    windowToWallRatio: number;
    roofAreaM2: number;
    groundContactAreaM2: number;
    envelopeAreaM2: number;
    people: number;
    peopleDensityPerM2: number;
    lightingW: number;
    equipmentW: number;
    internalLoadW: number;
    internalLoadWPerM2: number;
    infiltrationM3S: number;
  };
  bounds: Bounds;
  spaces: SpaceEngineeringMetrics[];
}

const COORDINATE_TOLERANCE = 1e-9;
const SURFACES: SpaceSurface[] = ['floor', 'roof', 'south', 'north', 'east', 'west'];

function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function boundsForSpace(space: BimSpace): Bounds {
  return {
    x1: space.origin.x,
    x2: space.origin.x + space.dimensions.width,
    y1: space.origin.y,
    y2: space.origin.y + space.dimensions.depth,
    z1: space.origin.z,
    z2: space.origin.z + space.dimensions.height
  };
}

function coordinatesEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= COORDINATE_TOLERANCE;
}

function spansEqual(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return coordinatesEqual(firstStart, secondStart) && coordinatesEqual(firstEnd, secondEnd);
}

function hasAdjacentSpace(space: BimSpace, surface: SpaceSurface, spaces: BimSpace[]): boolean {
  const current = boundsForSpace(space);

  for (const other of spaces) {
    if (other === space) continue;

    const candidate = boundsForSpace(other);
    let adjacent = false;
    if (surface === 'floor') {
      adjacent = coordinatesEqual(current.z1, candidate.z2)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2);
    } else if (surface === 'roof') {
      adjacent = coordinatesEqual(current.z2, candidate.z1)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2);
    } else if (surface === 'south') {
      adjacent = coordinatesEqual(current.y1, candidate.y2)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else if (surface === 'north') {
      adjacent = coordinatesEqual(current.y2, candidate.y1)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else if (surface === 'east') {
      adjacent = coordinatesEqual(current.x2, candidate.x1)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else {
      adjacent = coordinatesEqual(current.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    }

    if (adjacent) {
      return true;
    }
  }

  return false;
}

function surfaceArea(space: BimSpace, surface: SpaceSurface): number {
  if (surface === 'floor' || surface === 'roof') return space.dimensions.width * space.dimensions.depth;
  if (surface === 'south' || surface === 'north') return space.dimensions.width * space.dimensions.height;
  return space.dimensions.depth * space.dimensions.height;
}

function windowArea(space: BimSpace): number {
  return space.windows.reduce((total, window) => total + window.width * window.height, 0);
}

function spaceMetrics(space: BimSpace, spaces: BimSpace[]): SpaceEngineeringMetrics {
  const floorAreaM2 = space.dimensions.width * space.dimensions.depth;
  const volumeM3 = floorAreaM2 * space.dimensions.height;
  const exteriorWallAreaM2 = SURFACES
    .filter((surface) => surface !== 'floor' && surface !== 'roof')
    .filter((surface) => !hasAdjacentSpace(space, surface, spaces))
    .reduce((total, surface) => total + surfaceArea(space, surface), 0);
  const roofAreaM2 = hasAdjacentSpace(space, 'roof', spaces) ? 0 : surfaceArea(space, 'roof');
  const groundContactAreaM2 = hasAdjacentSpace(space, 'floor', spaces) ? 0 : surfaceArea(space, 'floor');
  const glazingAreaM2 = windowArea(space);
  const lightingW = space.thermal.lightingWPerM2 * floorAreaM2;
  const equipmentW = space.thermal.equipmentWPerM2 * floorAreaM2;
  const internalLoadW = lightingW + equipmentW;

  return {
    id: space.id,
    name: space.name,
    type: space.type,
    floorAreaM2: roundMetric(floorAreaM2),
    volumeM3: roundMetric(volumeM3),
    exteriorWallAreaM2: roundMetric(exteriorWallAreaM2),
    windowAreaM2: roundMetric(glazingAreaM2),
    windowToWallRatio: roundMetric(exteriorWallAreaM2 > 0 ? glazingAreaM2 / exteriorWallAreaM2 : 0),
    roofAreaM2: roundMetric(roofAreaM2),
    groundContactAreaM2: roundMetric(groundContactAreaM2),
    people: roundMetric(space.thermal.people),
    peopleDensityPerM2: roundMetric(floorAreaM2 > 0 ? space.thermal.people / floorAreaM2 : 0),
    lightingW: roundMetric(lightingW),
    equipmentW: roundMetric(equipmentW),
    internalLoadW: roundMetric(internalLoadW),
    infiltrationM3S: roundMetric(space.thermal.infiltrationAirChangesPerHour * volumeM3 / 3600),
    heatingSetpointC: roundMetric(space.thermal.heatingSetpointC),
    coolingSetpointC: roundMetric(space.thermal.coolingSetpointC)
  };
}

function modelBounds(spaces: BimSpace[]): Bounds {
  const bounds = spaces.map(boundsForSpace);
  return {
    x1: roundMetric(Math.min(...bounds.map((bound) => bound.x1))),
    x2: roundMetric(Math.max(...bounds.map((bound) => bound.x2))),
    y1: roundMetric(Math.min(...bounds.map((bound) => bound.y1))),
    y2: roundMetric(Math.max(...bounds.map((bound) => bound.y2))),
    z1: roundMetric(Math.min(...bounds.map((bound) => bound.z1))),
    z2: roundMetric(Math.max(...bounds.map((bound) => bound.z2)))
  };
}

function sumMetrics(spaces: SpaceEngineeringMetrics[], key: keyof SpaceEngineeringMetrics): number {
  return spaces.reduce((total, space) => total + Number(space[key]), 0);
}

export function analyzeBimModel(model: BimModel, options: { modelPath?: string } = {}): ModelEngineeringMetrics {
  const spaces = model.spaces.map((space) => spaceMetrics(space, model.spaces));
  const floorAreaM2 = sumMetrics(spaces, 'floorAreaM2');
  const exteriorWallAreaM2 = sumMetrics(spaces, 'exteriorWallAreaM2');
  const windowAreaM2 = sumMetrics(spaces, 'windowAreaM2');
  const internalLoadW = sumMetrics(spaces, 'internalLoadW');
  const floorLevels = new Set(model.spaces.map((space) => roundMetric(space.origin.z)));

  return {
    modelPath: options.modelPath,
    project: {
      id: model.project.id,
      name: model.project.name
    },
    site: model.site,
    summary: {
      spaceCount: model.spaces.length,
      floorCount: floorLevels.size,
      floorAreaM2: roundMetric(floorAreaM2),
      volumeM3: roundMetric(sumMetrics(spaces, 'volumeM3')),
      exteriorWallAreaM2: roundMetric(exteriorWallAreaM2),
      windowAreaM2: roundMetric(windowAreaM2),
      windowToWallRatio: roundMetric(exteriorWallAreaM2 > 0 ? windowAreaM2 / exteriorWallAreaM2 : 0),
      roofAreaM2: roundMetric(sumMetrics(spaces, 'roofAreaM2')),
      groundContactAreaM2: roundMetric(sumMetrics(spaces, 'groundContactAreaM2')),
      envelopeAreaM2: roundMetric(exteriorWallAreaM2 + sumMetrics(spaces, 'roofAreaM2') + sumMetrics(spaces, 'groundContactAreaM2')),
      people: roundMetric(sumMetrics(spaces, 'people')),
      peopleDensityPerM2: roundMetric(floorAreaM2 > 0 ? sumMetrics(spaces, 'people') / floorAreaM2 : 0),
      lightingW: roundMetric(sumMetrics(spaces, 'lightingW')),
      equipmentW: roundMetric(sumMetrics(spaces, 'equipmentW')),
      internalLoadW: roundMetric(internalLoadW),
      internalLoadWPerM2: roundMetric(floorAreaM2 > 0 ? internalLoadW / floorAreaM2 : 0),
      infiltrationM3S: roundMetric(sumMetrics(spaces, 'infiltrationM3S'))
    },
    bounds: modelBounds(model.spaces),
    spaces
  };
}

export async function analyzeBimModelFile(modelPath: string): Promise<ModelEngineeringMetrics> {
  const input = await readJsonFile(modelPath);
  const validation = validateBimModel(input);
  if (!validation.valid || !validation.model) {
    throw new BimctlError('model_invalid', `Model failed validation: ${validation.errors.map((issue) => issue.message).join('; ')}`);
  }

  return analyzeBimModel(validation.model, { modelPath });
}

function csvValue(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function spaceMetricsCsv(metrics: ModelEngineeringMetrics): string {
  const headers: Array<keyof SpaceEngineeringMetrics> = [
    'id',
    'name',
    'type',
    'floorAreaM2',
    'volumeM3',
    'exteriorWallAreaM2',
    'windowAreaM2',
    'windowToWallRatio',
    'roofAreaM2',
    'groundContactAreaM2',
    'people',
    'peopleDensityPerM2',
    'lightingW',
    'equipmentW',
    'internalLoadW',
    'infiltrationM3S',
    'heatingSetpointC',
    'coolingSetpointC'
  ];
  const rows = metrics.spaces.map((space) => headers.map((header) => csvValue(space[header])).join(','));
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}
