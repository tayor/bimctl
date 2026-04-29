import { describe, expect, it } from 'vitest';
import { createBuildingModel, createShoeboxModel, validateBimModel } from '../src/schema.js';

describe('BIM model schema', () => {
  it('creates a valid shoebox model', () => {
    const model = createShoeboxModel({ projectName: 'Test Project' });
    const result = validateBimModel(model);
    expect(result.valid).toBe(true);
    expect(result.model?.project.name).toBe('Test Project');
  });

  it('rejects impossible thermostat settings', () => {
    const model = createShoeboxModel();
    model.spaces[0].thermal.heatingSetpointC = 27;
    model.spaces[0].thermal.coolingSetpointC = 24;
    const result = validateBimModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain('invalid_thermostat_deadband');
  });

  it('creates a valid multi-zone building model', () => {
    const model = createBuildingModel({ projectName: 'Grid Project', floors: 2, rows: 2, columns: 2 });
    const result = validateBimModel(model);
    expect(result.valid).toBe(true);
    expect(model.spaces).toHaveLength(8);
    expect(model.spaces[7].origin).toEqual({ x: 6, y: 5, z: 3.2 });
  });

  it('rejects overlapping space volumes', () => {
    const model = createBuildingModel({ floors: 1, rows: 1, columns: 2 });
    model.spaces[1].origin.x = 0;
    const result = validateBimModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain('space_volume_overlap');
  });
});
