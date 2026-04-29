import { z } from 'zod';

export const CardinalDirectionSchema = z.enum(['north', 'east', 'south', 'west']);

export const Point3Schema = z.object({
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  z: z.number().finite().default(0)
});

export const DimensionsSchema = z.object({
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive()
});

export const WindowSchema = z.object({
  id: z.string().min(1),
  wall: CardinalDirectionSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  sillHeight: z.number().nonnegative().default(0.9),
  offset: z.number().nonnegative().default(0.6)
});

export const ThermalLoadsSchema = z.object({
  people: z.number().nonnegative().default(2),
  lightingWPerM2: z.number().nonnegative().default(8),
  equipmentWPerM2: z.number().nonnegative().default(7),
  infiltrationAirChangesPerHour: z.number().nonnegative().default(0.35),
  heatingSetpointC: z.number().default(20),
  coolingSetpointC: z.number().default(26)
});

const DEFAULT_THERMAL_LOADS = {
  people: 2,
  lightingWPerM2: 8,
  equipmentWPerM2: 7,
  infiltrationAirChangesPerHour: 0.35,
  heatingSetpointC: 20,
  coolingSetpointC: 26
};

export const SpaceSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  type: z.enum(['office', 'residential', 'classroom', 'retail', 'storage', 'generic']).default('generic'),
  origin: Point3Schema.default({ x: 0, y: 0, z: 0 }),
  dimensions: DimensionsSchema,
  thermal: ThermalLoadsSchema.default(DEFAULT_THERMAL_LOADS),
  windows: z.array(WindowSchema).default([])
});

export const SiteSchema = z.object({
  name: z.string().min(1).default('Default Site'),
  latitude: z.number().min(-90).max(90).default(0),
  longitude: z.number().min(-180).max(180).default(0),
  timeZone: z.number().min(-12).max(14).default(0),
  elevationM: z.number().default(0)
});

const DEFAULT_SITE = {
  name: 'Default Site',
  latitude: 0,
  longitude: 0,
  timeZone: 0,
  elevationM: 0
};

export const SimulationSchema = z.object({
  timestepsPerHour: z.number().int().min(1).max(60).default(4),
  runDesignDays: z.boolean().default(true),
  runWeatherFile: z.boolean().default(false),
  outputs: z.array(z.enum(['zoneTemperature', 'electricity', 'heating', 'cooling'])).default([
    'zoneTemperature',
    'electricity',
    'heating',
    'cooling'
  ])
});

const DEFAULT_SIMULATION = {
  timestepsPerHour: 4,
  runDesignDays: true,
  runWeatherFile: false,
  outputs: ['zoneTemperature', 'electricity', 'heating', 'cooling'] as Array<'zoneTemperature' | 'electricity' | 'heating' | 'cooling'>
};

export const BimModelSchema = z.object({
  schema: z.literal('https://tayor.github.io/bimctl/schemas/bim-model.schema.json').default(
    'https://tayor.github.io/bimctl/schemas/bim-model.schema.json'
  ),
  bimctlVersion: z.string().default('0.1.0'),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default('')
  }),
  units: z.literal('m').default('m'),
  site: SiteSchema.default(DEFAULT_SITE),
  spaces: z.array(SpaceSchema).min(1),
  simulation: SimulationSchema.default(DEFAULT_SIMULATION)
});

export type BimModel = z.infer<typeof BimModelSchema>;
export type BimSpace = z.infer<typeof SpaceSchema>;
export type BimWindow = z.infer<typeof WindowSchema>;

const COORDINATE_TOLERANCE = 1e-9;

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  model?: BimModel;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface CreateShoeboxModelOptions {
  projectId?: string;
  projectName?: string;
  width?: number;
  depth?: number;
  height?: number;
  people?: number;
}

export interface CreateBuildingModelOptions {
  projectId?: string;
  projectName?: string;
  floors?: number;
  rows?: number;
  columns?: number;
  zoneWidth?: number;
  zoneDepth?: number;
  floorHeight?: number;
  peoplePerSpace?: number;
  windowWidth?: number;
  windowHeight?: number;
}

const BuildingModelOptionsSchema = z.object({
  projectId: z.string().min(1).default('building-demo'),
  projectName: z.string().min(1).default('Building Demo'),
  floors: z.number().int().positive().max(20).default(2),
  rows: z.number().int().positive().max(20).default(2),
  columns: z.number().int().positive().max(20).default(2),
  zoneWidth: z.number().positive().default(6),
  zoneDepth: z.number().positive().default(5),
  floorHeight: z.number().positive().default(3.2),
  peoplePerSpace: z.number().nonnegative().default(3),
  windowWidth: z.number().positive().default(2.2),
  windowHeight: z.number().positive().default(1.2)
});

function centeredWindow(id: string, wall: BimWindow['wall'], wallSpan: number, floorHeight: number, preferredWidth: number, preferredHeight: number): BimWindow {
  const horizontalMargin = Math.min(0.6, wallSpan * 0.2);
  const availableWidth = Math.max(wallSpan - horizontalMargin * 2, wallSpan * 0.5);
  const width = Math.min(preferredWidth, availableWidth);
  const sillHeight = floorHeight >= 1.2 ? 0.9 : floorHeight * 0.25;
  const availableHeight = Math.max(floorHeight - sillHeight, floorHeight * 0.5);
  const height = Math.min(preferredHeight, availableHeight * 0.8);

  return {
    id,
    wall,
    width,
    height,
    sillHeight,
    offset: Math.max(0, (wallSpan - width) / 2)
  };
}

function perimeterWindowsForGridCell(spaceId: string, rowIndex: number, columnIndex: number, options: z.infer<typeof BuildingModelOptionsSchema>): BimWindow[] {
  const windows: BimWindow[] = [];

  if (rowIndex === 0) {
    windows.push(centeredWindow(`${spaceId}_SouthWindow`, 'south', options.zoneWidth, options.floorHeight, options.windowWidth, options.windowHeight));
  }
  if (rowIndex === options.rows - 1) {
    windows.push(centeredWindow(`${spaceId}_NorthWindow`, 'north', options.zoneWidth, options.floorHeight, options.windowWidth, options.windowHeight));
  }
  if (columnIndex === 0) {
    windows.push(centeredWindow(`${spaceId}_WestWindow`, 'west', options.zoneDepth, options.floorHeight, options.windowWidth, options.windowHeight));
  }
  if (columnIndex === options.columns - 1) {
    windows.push(centeredWindow(`${spaceId}_EastWindow`, 'east', options.zoneDepth, options.floorHeight, options.windowWidth, options.windowHeight));
  }

  return windows;
}

export function createShoeboxModel(options: CreateShoeboxModelOptions = {}): BimModel {
  return BimModelSchema.parse({
    project: {
      id: options.projectId ?? 'shoebox-demo',
      name: options.projectName ?? 'Shoebox Demo',
      description: 'A single-zone rectangular building generated by bimctl.'
    },
    site: {
      name: 'Default Site',
      latitude: 25.2048,
      longitude: 55.2708,
      timeZone: 4,
      elevationM: 16
    },
    spaces: [
      {
        id: 'Space1',
        name: 'Main Space',
        type: 'office',
        dimensions: {
          width: options.width ?? 8,
          depth: options.depth ?? 6,
          height: options.height ?? 3.2
        },
        thermal: {
          people: options.people ?? 4,
          lightingWPerM2: 8,
          equipmentWPerM2: 7,
          infiltrationAirChangesPerHour: 0.35,
          heatingSetpointC: 20,
          coolingSetpointC: 26
        },
        windows: [
          {
            id: 'WindowSouth1',
            wall: 'south',
            width: 2.4,
            height: 1.2,
            sillHeight: 0.9,
            offset: 2.8
          }
        ]
      }
    ]
  });
}

export function createBuildingModel(options: CreateBuildingModelOptions = {}): BimModel {
  const parsed = BuildingModelOptionsSchema.parse(options);
  const spaces: Array<Omit<BimSpace, 'thermal'> & { thermal: typeof DEFAULT_THERMAL_LOADS }> = [];

  for (let floorIndex = 0; floorIndex < parsed.floors; floorIndex += 1) {
    for (let rowIndex = 0; rowIndex < parsed.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < parsed.columns; columnIndex += 1) {
        const spaceId = `F${floorIndex + 1}_R${rowIndex + 1}_C${columnIndex + 1}`;
        spaces.push({
          id: spaceId,
          name: `Floor ${floorIndex + 1} Zone ${rowIndex + 1}-${columnIndex + 1}`,
          type: 'office',
          origin: {
            x: columnIndex * parsed.zoneWidth,
            y: rowIndex * parsed.zoneDepth,
            z: floorIndex * parsed.floorHeight
          },
          dimensions: {
            width: parsed.zoneWidth,
            depth: parsed.zoneDepth,
            height: parsed.floorHeight
          },
          thermal: {
            ...DEFAULT_THERMAL_LOADS,
            people: parsed.peoplePerSpace
          },
          windows: perimeterWindowsForGridCell(spaceId, rowIndex, columnIndex, parsed)
        });
      }
    }
  }

  return BimModelSchema.parse({
    project: {
      id: parsed.projectId,
      name: parsed.projectName,
      description: 'A multi-zone rectangular building generated by bimctl.'
    },
    site: {
      name: 'Default Site',
      latitude: 25.2048,
      longitude: 55.2708,
      timeZone: 4,
      elevationM: 16
    },
    spaces
  });
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return firstStart < secondEnd - COORDINATE_TOLERANCE && secondStart < firstEnd - COORDINATE_TOLERANCE;
}

function spacesOverlap(first: BimSpace, second: BimSpace): boolean {
  return rangesOverlap(first.origin.x, first.origin.x + first.dimensions.width, second.origin.x, second.origin.x + second.dimensions.width)
    && rangesOverlap(first.origin.y, first.origin.y + first.dimensions.depth, second.origin.y, second.origin.y + second.dimensions.depth)
    && rangesOverlap(first.origin.z, first.origin.z + first.dimensions.height, second.origin.z, second.origin.z + second.dimensions.height);
}

export function validateBimModel(input: unknown, options: { strict?: boolean } = {}): ValidationResult {
  const parsed = BimModelSchema.safeParse(input);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        severity: 'error',
        code: issue.code,
        path: issue.path.join('.') || '$',
        message: issue.message
      });
    }

    return { valid: false, errors, warnings };
  }

  const model = parsed.data;
  const spaceIds = new Set<string>();
  for (const [spaceIndex, space] of model.spaces.entries()) {
    if (spaceIds.has(space.id)) {
      errors.push({
        severity: 'error',
        code: 'duplicate_space_id',
        path: `spaces.${spaceIndex}.id`,
        message: `Space id "${space.id}" is used more than once.`
      });
    }
    spaceIds.add(space.id);

    const floorArea = space.dimensions.width * space.dimensions.depth;
    if (floorArea < 4) {
      warnings.push({
        severity: 'warning',
        code: 'small_space_area',
        path: `spaces.${spaceIndex}.dimensions`,
        message: `Space "${space.id}" has a floor area below 4 m2.`
      });
    }

    for (const [windowIndex, window] of space.windows.entries()) {
      const wallWidth = window.wall === 'north' || window.wall === 'south'
        ? space.dimensions.width
        : space.dimensions.depth;
      const exceedsWidth = window.offset + window.width > wallWidth;
      const exceedsHeight = window.sillHeight + window.height > space.dimensions.height;
      if (exceedsWidth || exceedsHeight) {
        errors.push({
          severity: 'error',
          code: 'window_outside_wall_bounds',
          path: `spaces.${spaceIndex}.windows.${windowIndex}`,
          message: `Window "${window.id}" does not fit on the ${window.wall} wall of space "${space.id}".`
        });
      }
    }

    if (space.thermal.heatingSetpointC >= space.thermal.coolingSetpointC) {
      errors.push({
        severity: 'error',
        code: 'invalid_thermostat_deadband',
        path: `spaces.${spaceIndex}.thermal`,
        message: `Heating setpoint must be below cooling setpoint for space "${space.id}".`
      });
    }
  }

  for (let firstIndex = 0; firstIndex < model.spaces.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < model.spaces.length; secondIndex += 1) {
      const first = model.spaces[firstIndex];
      const second = model.spaces[secondIndex];
      if (spacesOverlap(first, second)) {
        errors.push({
          severity: 'error',
          code: 'space_volume_overlap',
          path: `spaces.${secondIndex}.origin`,
          message: `Space "${second.id}" overlaps space "${first.id}".`
        });
      }
    }
  }

  const strictWarnings = options.strict ? warnings.map((warning) => ({ ...warning, severity: 'error' as const })) : [];
  return {
    valid: errors.length === 0 && strictWarnings.length === 0,
    model,
    errors: [...errors, ...strictWarnings],
    warnings
  };
}