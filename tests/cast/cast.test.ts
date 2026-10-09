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
