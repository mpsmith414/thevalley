import { describe, expect, it } from 'vitest';
import { COATS, type Region } from '../../src/recipe/schema';
import { COAT_LOOK, regionCoat, strandCell } from '../../src/skin/coat';

const region = (r: Partial<Region>): Region => ({ id: 'r', covering: 'fur', color: '#806040', belly: null, furLength: 0.02, fluff: 0.3, coat: null, pattern: null, ...r });

describe('strandCell', () => {
  it('scales with the fur length, about 0.12 × length at density 1', () => {
    expect(strandCell(0.012, 1.3)).toBeCloseTo(0.00111, 4); // a deer's sleek coat: ~1.1 mm
    expect(Math.abs(strandCell(0.012, 1.3) - 0.00111)).toBeLessThan(0.00005);
    expect(strandCell(0.01, 1)).toBeCloseTo(0.0012, 4);
  });

  it('clamps to 0.4 mm … 2.5 mm (0.4 mm without fur)', () => {
    expect(strandCell(0, 1)).toBe(0.0004);
    expect(strandCell(-1, 1)).toBe(0.0004);
    expect(strandCell(1, 1)).toBe(0.0025);
    expect(strandCell(0.001, 1)).toBe(0.0004);
  });
});

describe('regionCoat', () => {
  it('a region its own coat, or the inferred one when it has none', () => {
    expect(regionCoat(region({ coat: 'woolly' }))).toBe('woolly');
    expect(regionCoat(region({ coat: null, furLength: 0.02, fluff: 0.3 }))).toBe('soft');
    expect(regionCoat(region({ coat: null, furLength: 0.006, fluff: 0.1 }))).toBe('sleek');
    expect(regionCoat(region({ coat: null, covering: 'feathers', fluff: 0.7 }))).toBe('downy');
  });

  it('none for scales, skin and the other bare coverings', () => {
    expect(regionCoat(region({ covering: 'scales', furLength: 0, coat: null }))).toBeNull();
    expect(regionCoat(region({ covering: 'skin', furLength: 0, coat: null }))).toBeNull();
  });
});

describe('COAT_LOOK', () => {
  it('has a row per coat, each in range', () => {
    for (const c of COATS) {
      const l = COAT_LOOK[c];
      expect(l, c).toBeDefined();
      expect(l.lean).toBeGreaterThanOrEqual(0);
      expect(l.lean).toBeLessThanOrEqual(1);
      expect(l.radius).toBeGreaterThan(0);
      expect(l.radius).toBeLessThanOrEqual(0.5);
      expect(l.density).toBeGreaterThan(0);
      expect(l.guardLen).toBeGreaterThanOrEqual(1);
    }
  });
});
