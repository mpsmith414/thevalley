import { describe, expect, it } from 'vitest';
import { autoQuality } from '../../src/render/quality';
import { POND, STAGE_RADIUS, WATER_LEVEL, heightAt, isWater, normalAt } from '../../src/render/terrain';

describe('stage ground', () => {
  it('is finite everywhere on the disc', () => {
    for (let x = -STAGE_RADIUS; x <= STAGE_RADIUS; x += 0.25)
      for (let z = -STAGE_RADIUS; z <= STAGE_RADIUS; z += 0.25) expect(Number.isFinite(heightAt(x, z))).toBe(true);
  });

  it('rises on the slope side', () => {
    expect(heightAt(5, -1)).toBeGreaterThan(heightAt(-5, -1) + 0.2);
  });

  it('has a pond below the water line, dry land at the centre', () => {
    expect(isWater(POND.x, POND.z)).toBe(true);
    expect(heightAt(POND.x, POND.z)).toBeLessThan(WATER_LEVEL - 0.4);
    expect(isWater(0, 0)).toBe(false);
    expect(heightAt(0, 0)).toBeGreaterThan(WATER_LEVEL);
  });

  it('points normals up', () => {
    expect(normalAt(0, 0).y).toBeGreaterThan(0.9);
  });
});

describe('autoQuality', () => {
  it('chooses by median frame rate', () => {
    expect(autoQuality([60, 61, 59])).toBe('high');
    expect(autoQuality([40, 45, 42])).toBe('medium');
    expect(autoQuality([20, 25, 22])).toBe('low');
    expect(autoQuality([])).toBe('high');
  });
});
