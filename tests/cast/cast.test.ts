import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { findLimbs } from '../../src/motion/limbs';
import { normalizeRecipe } from '../../src/recipe/normalize';

const FOUR_LEGS = ['deer', 'rabbit', 'fox', 'wolf', 'frog'];

describe('the native cast', () => {
  it('has unique names', () => {
    const names = CAST.map((c) => c.recipe.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { recipe } of CAST) {
    describe(recipe.name, () => {
      it('is already clean (nothing for normalise to fix)', () => {
        expect(normalizeRecipe(structuredClone(recipe)).fixes).toEqual([]);
      });

      it('builds within budget', () => {
        const body = buildBody(recipe, [0]);
        expect(body.lods[0].positions.length / 3).toBeLessThanOrEqual(120_000);
        if (FOUR_LEGS.includes(recipe.id)) expect(findLimbs(body.skeleton).filter((l) => l.kind === 'leg')).toHaveLength(4);
      });
    });
  }
});
