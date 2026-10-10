import { describe, expect, it } from 'vitest';
import { inferBuild, inferFace } from '../../src/recipe/hints';
import { CAST } from '../../src/cast';
import { normalizeRecipe } from '../../src/recipe/normalize';
import { MAX_BONES, MAX_PARTS } from '../../src/recipe/schema';
import { quadruped, snake } from '../fixtures/recipes';

const byId = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe;

describe('hint inference', () => {
  it('gives fur animals paws and a pad nose, heavy fur plant-eaters hooves', () => {
    expect(inferBuild(byId('fox')).feet).toBe('paws');
    expect(inferFace(byId('fox')).nose).toBe('pad');
    expect(inferBuild(byId('deer')).feet).toBe('hooves');
  });
  it('gives a heavy fur hunter paws, not hooves', () => {
    const wolf = byId('wolf');
    expect(wolf.life.massKg).toBeGreaterThan(30);
    expect(inferBuild(wolf).feet).toBe('paws');
    // a designer-made big cat: heavy, furred, eats meat
    expect(inferBuild({ ...wolf, life: { ...wolf.life, massKg: 120 } }).feet).toBe('paws');
  });
  it('gives a big fur herbivore hooves and a small one paws', () => {
    const wolf = byId('wolf');
    const grazer = { ...wolf, mind: { ...wolf.mind, plants: ['grass'], preyMin: 0, preyMax: 0 } };
    expect(inferBuild(grazer).feet).toBe('hooves');
    expect(inferBuild({ ...grazer, life: { ...grazer.life, massKg: 20 } }).feet).toBe('paws');
  });
  it('gives water birds a bill and webbed feet, other birds a beak and talons', () => {
    expect(inferFace(byId('duck')).nose).toBe('bill');
    expect(inferBuild(byId('duck')).feet).toBe('webbed');
    expect(inferFace(byId('hawk')).nose).toBe('beak');
    expect(inferBuild(byId('hawk')).feet).toBe('talons');
  });
  it('gives fish no lids', () => {
    expect(inferFace(byId('trout')).lids).toBe(false);
  });
  it('gives a legless body plain feet', () => {
    expect(inferBuild(snake).feet).toBe('plain');
  });
});

describe('v1 → v2 upgrade', () => {
  it('fills build and face from the body and reports it', () => {
    const v1 = structuredClone(byId('fox')) as Record<string, unknown>;
    delete v1.build; delete v1.face; v1.schemaVersion = 1;
    const { recipe, fixes } = normalizeRecipe(v1);
    expect(recipe.schemaVersion).toBe(2);
    expect(recipe.build.feet).toBe('paws');
    expect(fixes).toContain('build missing → inferred');
    expect(fixes).toContain('face missing → inferred');
  });
  it('keeps given hints and clamps numbers', () => {
    const raw = { ...structuredClone(quadruped), build: { muscle: 3, feet: 'hooves' }, face: { ...inferFace(quadruped), brow: -1 } };
    const { recipe } = normalizeRecipe(raw);
    expect(recipe.build).toEqual({ muscle: 1, feet: 'hooves' });
    expect(recipe.face.brow).toBe(0);
  });
  it('is idempotent on every native', () => {
    for (const { recipe } of CAST) expect(normalizeRecipe(recipe).recipe).toEqual(recipe);
  });
  it('leaves room for the jaw: the most bones a recipe can make is MAX_BONES - 1', () => {
    expect(1 + (MAX_PARTS - 1) * 2).toBeLessThanOrEqual(MAX_BONES - 1);
  });
});
