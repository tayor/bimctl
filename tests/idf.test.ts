import { describe, expect, it } from 'vitest';
import { generateEnergyPlusIdf } from '../src/idf.js';
import { createBuildingModel, createShoeboxModel } from '../src/schema.js';

describe('EnergyPlus IDF generation', () => {
  it('emits zones, geometry, windows, and outputs', () => {
    const idf = generateEnergyPlusIdf(createShoeboxModel({ projectName: 'IDF Test' }));
    expect(idf).toContain('Version,\n  25.2;');
    expect(idf).toContain('ScheduleTypeLimits,\n  Any Number;');
    expect(idf).toContain('Zone,');
    expect(idf).toContain('BuildingSurface:Detailed,');
    expect(idf).toContain('FenestrationSurface:Detailed,');
    expect(idf).toContain('Output:SQLite,');
  });

  it('aligns EnergyPlus 25.2 object fields for surfaces, fenestration, design days, zones, and lights', () => {
    const idf = generateEnergyPlusIdf(createShoeboxModel({ projectName: 'IDF Test' }));
    expect(idf).toContain(['Space1 east,', '  Wall,', '  Default Wall,', '  Space1,', '  ,', '  Outdoors,', '  ,', '  SunExposed,', '  WindExposed,'].join('\n'));
    expect(idf).toContain(['WindowSouth1,', '  Window,', '  Default Window,', '  Space1 south,', '  ,', '  autocalculate,', '  ,', '  1,', '  4,'].join('\n'));
    expect(idf).toContain(['Summer Design Day,', '  7,', '  21,', '  SummerDesignDay,', '  35,', '  10,', '  DefaultMultipliers,', '  ,', '  WetBulb,', '  24,'].join('\n'));
    expect(idf).toContain(['Space1,', '  0,', '  0,', '  0,', '  0,', '  1,', '  1,', '  3.2,', '  autocalculate,', '  autocalculate,', '  ,', '  ,', '  Yes;'].join('\n'));
    expect(idf).toMatch(/Lights,\n  Space1 Lights,\n  Space1,\n  Always On,\n  LightingLevel,\n  [^\n]+,\n  ,\n  ,\n  0,\n  0\.7,\n  0\.2,\n  1,\n  GeneralLights,\n  No,/);
    expect(idf).toContain(['HVACTemplate:Zone:IdealLoadsAirSystem,', '  Space1,', '  Space1 Thermostat,', '  ;'].join('\n'));
  });

  it('marks fully shared zone faces as interzone surfaces', () => {
    const idf = generateEnergyPlusIdf(createBuildingModel({ floors: 1, rows: 1, columns: 2 }));
    expect(idf).toContain([
      'F1_R1_C1 east,',
      '  Wall,',
      '  Default Wall,',
      '  F1_R1_C1,',
      '  ,',
      '  Surface,',
      '  F1_R1_C2 west,',
      '  NoSun,',
      '  NoWind,'
    ].join('\n'));
    expect(idf).toContain([
      'F1_R1_C2 west,',
      '  Wall,',
      '  Default Wall,',
      '  F1_R1_C2,',
      '  ,',
      '  Surface,',
      '  F1_R1_C1 east,',
      '  NoSun,',
      '  NoWind,'
    ].join('\n'));
  });
});
