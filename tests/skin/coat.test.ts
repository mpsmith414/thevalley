import { describe, expect, it } from 'vitest';
import { hash } from 'three/tsl';
import { COATS, type Region } from '../../src/recipe/schema';
import { COAT_LOOK, FEATHER, drawsFeathers, regionCoat, strandCell } from '../../src/skin/coat';

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

describe('feathers', () => {
  it('smooth feathers draw as feathers; downy ones (and every hair coat) as strands', () => {
    expect(drawsFeathers('smooth')).toBe(true);
    for (const c of COATS.filter((c) => c !== 'smooth')) expect(drawsFeathers(c), c).toBe(false);
    expect(drawsFeathers(null)).toBe(false);
  });

  it('keeps the vane longer than wide', () => {
    expect(FEATHER.span).toBeGreaterThan(2 * FEATHER.width);
  });
});

describe("three's TSL hash", () => {
  // `featherAtCPU` copies r186's `hash` (nodes/math/Hash.js, PCG) as `hashCPU`: an upgrade that changes it would move the
  // CPU twin's feathers off the drawn ones without an error, so its source is checked here (dev builds keep it readable)
  it('is still the PCG hash the CPU twin copies', () => {
    const src = String((hash as unknown as { shaderNode?: { jsFunc?: unknown } }).shaderNode?.jsFunc ?? '').replace(/\s+/g, '');
    for (const s of ['mul(747796405)', 'add(2891336453)', 'shiftRight(28).add(4)', 'mul(277803737)', 'shiftRight(22)', 'mul(1/2**32)'])
      expect(src).toContain(s);
  });
});
