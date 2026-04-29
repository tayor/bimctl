import { BimModel, BimSpace, BimWindow } from './schema.js';

const DEFAULT_ENERGYPLUS_VERSION = '25.2';

export interface GenerateEnergyPlusIdfOptions {
  energyPlusVersion?: string;
}

interface Vertex {
  x: number;
  y: number;
  z: number;
}

type SpaceSurface = 'floor' | 'roof' | 'south' | 'north' | 'east' | 'west';

interface SpaceBounds {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  z1: number;
  z2: number;
}

interface SurfaceAdjacency {
  boundarySurfaceName: string;
}

const SURFACES: SpaceSurface[] = ['floor', 'roof', 'south', 'north', 'east', 'west'];

const OPPOSITE_SURFACE: Record<SpaceSurface, SpaceSurface> = {
  floor: 'roof',
  roof: 'floor',
  south: 'north',
  north: 'south',
  east: 'west',
  west: 'east'
};

const COORDINATE_TOLERANCE = 1e-9;

function sanitizeName(value: string): string {
  return value.replace(/[,;\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
}

function idfObject(type: string, fields: Array<string | number | boolean | null | undefined>): string {
  const cleanFields = fields.map((field) => {
    if (field === null || field === undefined) return '';
    if (typeof field === 'boolean') return field ? 'Yes' : 'No';
    return String(field);
  });

  const lines = cleanFields.map((field, index) => {
    const terminator = index === cleanFields.length - 1 ? ';' : ',';
    return `  ${field}${terminator}`;
  });

  return `${type},\n${lines.join('\n')}`;
}

function surfaceName(space: BimSpace, surface: SpaceSurface): string {
  return `${sanitizeName(space.id)} ${surface}`;
}

function spaceBounds(space: BimSpace): SpaceBounds {
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

function adjacentSurface(space: BimSpace, surface: SpaceSurface, spaces: BimSpace[]): SurfaceAdjacency | undefined {
  const current = spaceBounds(space);

  for (const other of spaces) {
    if (other === space) continue;

    const candidate = spaceBounds(other);
    let touches = false;
    if (surface === 'floor') {
      touches = coordinatesEqual(current.z1, candidate.z2)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2);
    } else if (surface === 'roof') {
      touches = coordinatesEqual(current.z2, candidate.z1)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2);
    } else if (surface === 'south') {
      touches = coordinatesEqual(current.y1, candidate.y2)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else if (surface === 'north') {
      touches = coordinatesEqual(current.y2, candidate.y1)
        && spansEqual(current.x1, current.x2, candidate.x1, candidate.x2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else if (surface === 'east') {
      touches = coordinatesEqual(current.x2, candidate.x1)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    } else {
      touches = coordinatesEqual(current.x1, candidate.x2)
        && spansEqual(current.y1, current.y2, candidate.y1, candidate.y2)
        && spansEqual(current.z1, current.z2, candidate.z1, candidate.z2);
    }

    if (touches) {
      return { boundarySurfaceName: surfaceName(other, OPPOSITE_SURFACE[surface]) };
    }
  }

  return undefined;
}

function verticesForSurface(space: BimSpace, surface: SpaceSurface): Vertex[] {
  const { x, y, z } = space.origin;
  const { width, depth, height } = space.dimensions;
  const x2 = x + width;
  const y2 = y + depth;
  const z2 = z + height;

  switch (surface) {
    case 'floor':
      return [
        { x, y: y2, z },
        { x: x2, y: y2, z },
        { x: x2, y, z },
        { x, y, z }
      ];
    case 'roof':
      return [
        { x, y, z: z2 },
        { x: x2, y, z: z2 },
        { x: x2, y: y2, z: z2 },
        { x, y: y2, z: z2 }
      ];
    case 'south':
      return [
        { x, y, z },
        { x: x2, y, z },
        { x: x2, y, z: z2 },
        { x, y, z: z2 }
      ];
    case 'north':
      return [
        { x: x2, y: y2, z },
        { x, y: y2, z },
        { x, y: y2, z: z2 },
        { x: x2, y: y2, z: z2 }
      ];
    case 'east':
      return [
        { x: x2, y, z },
        { x: x2, y: y2, z },
        { x: x2, y: y2, z: z2 },
        { x: x2, y, z: z2 }
      ];
    case 'west':
      return [
        { x, y: y2, z },
        { x, y, z },
        { x, y, z: z2 },
        { x, y: y2, z: z2 }
      ];
  }
}

function vertexFields(vertices: Vertex[]): string[] {
  return vertices.flatMap((vertex) => [
    vertex.x.toFixed(3),
    vertex.y.toFixed(3),
    vertex.z.toFixed(3)
  ]);
}

function buildingSurface(space: BimSpace, surface: SpaceSurface, adjacency?: SurfaceAdjacency): string {
  const zoneName = sanitizeName(space.id);
  const surfaceType = surface === 'floor' ? 'Floor' : surface === 'roof' ? 'Roof' : 'Wall';
  const construction = surface === 'floor' ? 'Default Floor' : surface === 'roof' ? 'Default Roof' : 'Default Wall';
  const outsideBoundary = adjacency ? 'Surface' : surface === 'floor' ? 'Ground' : 'Outdoors';
  const outsideBoundaryObject = adjacency?.boundarySurfaceName ?? '';
  const sunExposure = adjacency || surface === 'floor' ? 'NoSun' : 'SunExposed';
  const windExposure = adjacency || surface === 'floor' ? 'NoWind' : 'WindExposed';
  const vertices = verticesForSurface(space, surface);

  return idfObject('BuildingSurface:Detailed', [
    surfaceName(space, surface),
    surfaceType,
    construction,
    zoneName,
    '',
    outsideBoundary,
    outsideBoundaryObject,
    sunExposure,
    windExposure,
    'autocalculate',
    vertices.length,
    ...vertexFields(vertices)
  ]);
}

function windowVertices(space: BimSpace, window: BimWindow): Vertex[] {
  const { x, y, z } = space.origin;
  const { width, depth } = space.dimensions;
  const bottom = z + window.sillHeight;
  const top = bottom + window.height;

  if (window.wall === 'south') {
    const left = x + window.offset;
    const right = left + window.width;
    return [
      { x: left, y, z: bottom },
      { x: right, y, z: bottom },
      { x: right, y, z: top },
      { x: left, y, z: top }
    ];
  }

  if (window.wall === 'north') {
    const right = x + width - window.offset;
    const left = right - window.width;
    return [
      { x: right, y: y + depth, z: bottom },
      { x: left, y: y + depth, z: bottom },
      { x: left, y: y + depth, z: top },
      { x: right, y: y + depth, z: top }
    ];
  }

  if (window.wall === 'east') {
    const front = y + window.offset;
    const back = front + window.width;
    return [
      { x: x + width, y: front, z: bottom },
      { x: x + width, y: back, z: bottom },
      { x: x + width, y: back, z: top },
      { x: x + width, y: front, z: top }
    ];
  }

  const back = y + depth - window.offset;
  const front = back - window.width;
  return [
    { x, y: back, z: bottom },
    { x, y: front, z: bottom },
    { x, y: front, z: top },
    { x, y: back, z: top }
  ];
}

function fenestrationSurface(space: BimSpace, window: BimWindow): string {
  const zoneName = sanitizeName(space.id);
  const baseSurfaceName = surfaceName(space, window.wall);
  const vertices = windowVertices(space, window);
  return idfObject('FenestrationSurface:Detailed', [
    sanitizeName(window.id),
    'Window',
    'Default Window',
    baseSurfaceName,
    '',
    'autocalculate',
    '',
    1,
    vertices.length,
    ...vertexFields(vertices)
  ]);
}

function normalizeEnergyPlusVersion(value?: string): string {
  if (!value) return DEFAULT_ENERGYPLUS_VERSION;
  const match = value.match(/(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : DEFAULT_ENERGYPLUS_VERSION;
}

function scheduleCompact(name: string, value: number): string {
  return idfObject('Schedule:Compact', [
    name,
    'Any Number',
    'Through: 12/31',
    'For: AllDays',
    'Until: 24:00',
    value
  ]);
}

function designDay(name: string, month: number, dayOfMonth: number, dayType: 'SummerDesignDay' | 'WinterDesignDay', dryBulbC: number, dryBulbRangeC: number, wetBulbOrDewPointC: number, skyClearness: number): string {
  return idfObject('SizingPeriod:DesignDay', [
    name,
    month,
    dayOfMonth,
    dayType,
    dryBulbC,
    dryBulbRangeC,
    'DefaultMultipliers',
    '',
    'WetBulb',
    wetBulbOrDewPointC,
    '',
    '',
    '',
    '',
    101325,
    3.8,
    270,
    'No',
    'No',
    'No',
    'ASHRAEClearSky',
    '',
    '',
    '',
    '',
    skyClearness,
    '',
  ]);
}

function zoneLoads(space: BimSpace): string[] {
  const zoneName = sanitizeName(space.id);
  const floorArea = space.dimensions.width * space.dimensions.depth;
  const lightingWatts = (space.thermal.lightingWPerM2 * floorArea).toFixed(2);
  const equipmentWatts = (space.thermal.equipmentWPerM2 * floorArea).toFixed(2);

  return [
    idfObject('People', [
      `${zoneName} People`,
      zoneName,
      'Always On',
      'People',
      space.thermal.people,
      '',
      '',
      0.3,
      '',
      'Activity Level'
    ]),
    idfObject('Lights', [
      `${zoneName} Lights`,
      zoneName,
      'Always On',
      'LightingLevel',
      lightingWatts,
      '',
      '',
      0,
      0.7,
      0.2,
      1,
      'GeneralLights',
      'No',
      '',
      '',
      '',
      ''
    ]),
    idfObject('ElectricEquipment', [
      `${zoneName} Equipment`,
      zoneName,
      'Always On',
      'EquipmentLevel',
      equipmentWatts,
      '',
      '',
      0,
      0.5,
      0,
      0
    ]),
    idfObject('ZoneInfiltration:DesignFlowRate', [
      `${zoneName} Infiltration`,
      zoneName,
      'Always On',
      'AirChanges/Hour',
      '',
      '',
      '',
      space.thermal.infiltrationAirChangesPerHour
    ]),
    scheduleCompact(`${zoneName} Heating Setpoint`, space.thermal.heatingSetpointC),
    scheduleCompact(`${zoneName} Cooling Setpoint`, space.thermal.coolingSetpointC),
    idfObject('HVACTemplate:Thermostat', [
      `${zoneName} Thermostat`,
      `${zoneName} Heating Setpoint`,
      '',
      `${zoneName} Cooling Setpoint`,
      ''
    ]),
    idfObject('HVACTemplate:Zone:IdealLoadsAirSystem', [
      zoneName,
      `${zoneName} Thermostat`,
      ''
    ])
  ];
}

export function generateEnergyPlusIdf(model: BimModel, options: GenerateEnergyPlusIdfOptions = {}): string {
  const version = normalizeEnergyPlusVersion(options.energyPlusVersion);
  const objects: string[] = [
    `! Generated by bimctl ${model.bimctlVersion}`,
    idfObject('Version', [version]),
    idfObject('SimulationControl', ['No', 'No', 'No', model.simulation.runDesignDays, model.simulation.runWeatherFile]),
    idfObject('Building', [sanitizeName(model.project.name), 0, 'Suburbs', 0.04, 0.4, 'FullExterior', 25, 6]),
    idfObject('Site:Location', [
      sanitizeName(model.site.name),
      model.site.latitude,
      model.site.longitude,
      model.site.timeZone,
      model.site.elevationM
    ]),
    idfObject('Timestep', [model.simulation.timestepsPerHour]),
    idfObject('GlobalGeometryRules', ['UpperLeftCorner', 'CounterClockWise', 'World']),
    designDay('Summer Design Day', 7, 21, 'SummerDesignDay', 35, 10, 24, 1),
    designDay('Winter Design Day', 1, 21, 'WinterDesignDay', 5, 0, 0, 0),
    idfObject('ScheduleTypeLimits', ['Any Number']),
    scheduleCompact('Always On', 1),
    scheduleCompact('Activity Level', 120),
    idfObject('Material:NoMass', ['Wall R-13', 'MediumRough', 2.29, 0.9, 0.7, 0.7]),
    idfObject('Material:NoMass', ['Roof R-30', 'MediumRough', 5.28, 0.9, 0.7, 0.7]),
    idfObject('Material:NoMass', ['Floor R-10', 'MediumRough', 1.76, 0.9, 0.7, 0.7]),
    idfObject('WindowMaterial:SimpleGlazingSystem', ['Default Simple Glazing', 2.7, 0.45, 0.6]),
    idfObject('Construction', ['Default Wall', 'Wall R-13']),
    idfObject('Construction', ['Default Roof', 'Roof R-30']),
    idfObject('Construction', ['Default Floor', 'Floor R-10']),
    idfObject('Construction', ['Default Window', 'Default Simple Glazing'])
  ];

  for (const space of model.spaces) {
    const zoneName = sanitizeName(space.id);
    objects.push(
      idfObject('Zone', [
        zoneName,
        0,
        space.origin.x,
        space.origin.y,
        space.origin.z,
        1,
        1,
        space.dimensions.height,
        'autocalculate',
        'autocalculate',
        '',
        '',
        'Yes'
      ])
    );

    for (const surface of SURFACES) {
      objects.push(buildingSurface(space, surface, adjacentSurface(space, surface, model.spaces)));
    }

    for (const window of space.windows) {
      objects.push(fenestrationSurface(space, window));
    }

    objects.push(...zoneLoads(space));
  }

  if (model.simulation.outputs.includes('zoneTemperature')) {
    objects.push(idfObject('Output:Variable', ['*', 'Zone Mean Air Temperature', 'Hourly']));
  }
  if (model.simulation.outputs.includes('electricity')) {
    objects.push(idfObject('Output:Meter', ['Electricity:Facility', 'Hourly']));
  }
  if (model.simulation.outputs.includes('heating')) {
    objects.push(idfObject('Output:Meter', ['Heating:EnergyTransfer', 'Hourly']));
  }
  if (model.simulation.outputs.includes('cooling')) {
    objects.push(idfObject('Output:Meter', ['Cooling:EnergyTransfer', 'Hourly']));
  }
  objects.push(idfObject('Output:SQLite', ['SimpleAndTabular']));
  objects.push(idfObject('Output:Table:SummaryReports', ['AllSummary']));

  return `${objects.join('\n\n')}\n`;
}