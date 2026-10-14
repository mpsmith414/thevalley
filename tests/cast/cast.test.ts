import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { findLimbs } from '../../src/motion/limbs';
import { normalizeRecipe } from '../../src/recipe/normalize';
import { minValence, unitNormals } from '../fixtures/mesh';

const FOUR_LEGS = ['deer', 'rabbit', 'fox', 'wolf', 'frog'];

describe('the native cast', () => {
  it('has all eight animals with unique names', () => {
    expect(CAST).toHaveLength(8);
    const names = CAST.map((c) => c.recipe.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every fur and feather region its coat', () => {
    // every hair or feather region of every native, by id; frog and trout have none
    const COATS: Record<string, Record<string, string>> = {
      deer: { body: 'sleek', muzzle: 'sleek', tail: 'soft' },
      fox: { body: 'soft', snout: 'sleek', ears: 'sleek', socks: 'soft', brush: 'shaggy', tip: 'shaggy' },
      rabbit: { body: 'soft', tail: 'soft' },
      wolf: { body: 'shaggy', legs: 'soft' },
      duck: { body: 'smooth', head: 'smooth', wing: 'smooth' },
      hawk: { body: 'smooth', wing: 'smooth', tail: 'smooth' },
      frog: {},
      trout: {},
    };
    for (const { recipe } of CAST) {
      const haired = recipe.skin.regions.filter((r) => r.covering === 'fur' || r.covering === 'feathers');
      expect(Object.fromEntries(haired.map((r) => [r.id, r.coat])), recipe.id).toEqual(COATS[recipe.id]);
      // feathers are drawn only where the region has a length (the feather cell is set by it)
      for (const r of haired) expect(r.furLength, `${recipe.id} ${r.id}`).toBeGreaterThan(0);
    }
  });

  for (const { recipe } of CAST) {
    describe(recipe.name, () => {
      it('is already clean (nothing for normalise to fix)', () => {
        expect(normalizeRecipe(structuredClone(recipe)).fixes).toEqual([]);
      });

      it('builds within budget', () => {
        const body = buildBody(recipe);
        expect(body.lods[0].positions.length / 3).toBeLessThanOrEqual(120_000);
        for (const l of body.lods) {
          expect(unitNormals(l.normals)).toBe(true);
          expect(minValence(l)).toBeGreaterThanOrEqual(3);
        }
        const limbs = findLimbs(body.skeleton);
        const count = (k: string) => limbs.filter((l) => l.kind === k).length;
        if (FOUR_LEGS.includes(recipe.id)) expect(count('leg')).toBe(4);
        if (recipe.id === 'duck' || recipe.id === 'hawk') {
          expect(count('leg')).toBe(2);
          expect(count('wing')).toBe(2);
        }
        if (recipe.id === 'trout') {
          expect(count('leg')).toBe(0);
          expect(count('fin')).toBeGreaterThanOrEqual(3);
        }
      }, 20_000); // a fine build takes up to ~2.5 s alone, more while every test file runs at once
    });
  }
});
