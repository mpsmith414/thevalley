import { describe, it, expect } from 'vitest';
import { LAKE_CALM, REED_CALM, calmWater } from '../../src/world/textures';
import { RIVER_FAST, RIVER_SLOW } from '../../src/valley/generate/carve';

const unit = (b: number) => b / 255;

describe('calmWater', () => {
  it('marks the lake fully calm, and dry land 0', () => {
    expect(calmWater(1, 0)).toBe(255);
    expect(calmWater(0, 0)).toBe(0);
    expect(unit(calmWater(1, 0))).toBeGreaterThan(LAKE_CALM[1]);
  });

  it('puts a slow river in the reed band (but never lake-calm) and a fast one below it', () => {
    const slow = unit(calmWater(2, RIVER_SLOW)), fast = unit(calmWater(2, RIVER_FAST));
    expect(slow).toBeGreaterThan(REED_CALM[1]);
    expect(slow).toBeLessThan(LAKE_CALM[0]);
    expect(fast).toBeLessThan(REED_CALM[0]);
    expect(unit(calmWater(2, RIVER_FAST + 1))).toBe(0);
    expect(calmWater(2, RIVER_SLOW)).toBeGreaterThan(calmWater(2, (RIVER_SLOW + RIVER_FAST) / 2));
  });
});
