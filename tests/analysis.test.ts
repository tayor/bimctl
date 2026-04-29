import { describe, expect, it } from 'vitest';
import { analyzeBimModel, spaceMetricsCsv } from '../src/analysis.js';
import { createBuildingModel } from '../src/schema.js';

describe('BIM engineering analysis', () => {
  it('computes model-level takeoff metrics for adjacent zones', () => {
    const metrics = analyzeBimModel(createBuildingModel({ floors: 1, rows: 1, columns: 2 }));

    expect(metrics.summary.spaceCount).toBe(2);
    expect(metrics.summary.floorCount).toBe(1);
    expect(metrics.summary.floorAreaM2).toBe(60);
    expect(metrics.summary.volumeM3).toBe(192);
    expect(metrics.summary.exteriorWallAreaM2).toBeCloseTo(108.8, 6);
    expect(metrics.summary.windowAreaM2).toBeCloseTo(15.84, 6);
    expect(metrics.summary.windowToWallRatio).toBeCloseTo(0.145588, 6);
    expect(metrics.summary.roofAreaM2).toBe(60);
    expect(metrics.summary.groundContactAreaM2).toBe(60);
    expect(metrics.summary.people).toBe(6);
    expect(metrics.summary.internalLoadW).toBe(900);
    expect(metrics.summary.internalLoadWPerM2).toBe(15);
    expect(metrics.summary.infiltrationM3S).toBe(0.018666);
  });

  it('exports per-space metrics as CSV', () => {
    const metrics = analyzeBimModel(createBuildingModel({ floors: 1, rows: 1, columns: 2 }));
    const csv = spaceMetricsCsv(metrics);

    expect(csv).toContain('id,name,type,floorAreaM2,volumeM3');
    expect(csv).toContain('F1_R1_C1,Floor 1 Zone 1-1,office,30,96,54.4');
    expect(csv.endsWith('\n')).toBe(true);
  });
});
