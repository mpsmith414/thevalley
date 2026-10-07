import { describe, expect, it } from 'vitest';
import { normalizeRecipe, RecipeError } from '../../src/recipe/normalize';
import { MAX_BONES, MAX_PARTS } from '../../src/recipe/schema';
import { P, makeRecipe, quadruped } from '../fixtures/recipes';

const clone = <T>(v: T): T => structuredClone(v);

describe('normalizeRecipe', () => {
  it('passes a clean recipe through unchanged', () => {
    const { recipe, fixes } = normalizeRecipe(clone(quadruped));
    expect(fixes).toEqual([]);
    expect(recipe).toEqual(quadruped);
  });

  it('clamps numbers with a fix', () => {
    const r = clone(quadruped);
    r.parts[1].length = 99;
    const { recipe, fixes } = normalizeRecipe(r);
    expect(recipe.parts[1].length).toBe(6);
    expect(fixes.some((f) => f.includes('length'))).toBe(true);
  });

  it('turns a zero direction forward', () => {
    const r = clone(quadruped);
    r.parts[2].dir = { x: 0, y: 0, z: 0 };
    expect(normalizeRecipe(r).recipe.parts[2].dir).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('keeps one root and re-attaches unknown parents', () => {
    const r = makeRecipe('t', [
      P('a', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      P('b', null, 'head', 1, [0, 0, 1], 0.1, 0.05, 0.05),
      P('c', 'nope', 'tail', 0, [0, 0, -1], 0.1, 0.03, 0.01),
    ]);
    const { recipe } = normalizeRecipe(r);
    expect(recipe.parts.filter((p) => p.parent === null).map((p) => p.id)).toEqual(['a']);
    expect(recipe.parts.find((p) => p.id === 'b')!.parent).toBe('a');
    expect(recipe.parts.find((p) => p.id === 'c')!.parent).toBe('a');
  });

  it('breaks cycles', () => {
    const r = makeRecipe('t', [
      P('root', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      P('a', 'b', 'leg', 1, [0, -1, 0], 0.1, 0.03, 0.03),
      P('b', 'a', 'leg', 1, [0, -1, 0], 0.1, 0.03, 0.03),
    ]);
    const { recipe, fixes } = normalizeRecipe(r);
    expect(fixes.some((f) => f.startsWith('cycle'))).toBe(true);
    // every part reaches the root, parents come first
    const seen = new Set<string>();
    for (const p of recipe.parts) {
      if (p.parent !== null) expect(seen.has(p.parent)).toBe(true);
      seen.add(p.id);
    }
  });

  it('renames duplicate ids', () => {
    const r = makeRecipe('t', [
      P('a', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      P('x', 'a', 'leg', 1, [0, -1, 0], 0.1, 0.03, 0.03),
      P('x', 'a', 'leg', 0, [0, -1, 0], 0.1, 0.03, 0.03),
    ]);
    expect(normalizeRecipe(r).recipe.parts.map((p) => p.id)).toEqual(['a', 'x', 'x_2']);
  });

  it('caps the part count', () => {
    const parts = [P('root', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      ...Array.from({ length: 59 }, (_, i) => P(`p${i}`, 'root', 'other', 0.5, [0, 1, 0], 0.05, 0.01, 0.01))];
    expect(normalizeRecipe(makeRecipe('t', parts)).recipe.parts).toHaveLength(MAX_PARTS);
  });

  it('caps bones after mirroring', () => {
    const parts = [P('root', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      ...Array.from({ length: 40 }, (_, i) => P(`p${i}`, 'root', 'leg', 0.5, [1, -1, 0], 0.05, 0.01, 0.01, { mirror: true }))];
    const { recipe } = normalizeRecipe(makeRecipe('t', parts));
    const bones = recipe.parts.reduce((n, p) => n + (p.mirror ? 2 : 1), 0);
    expect(bones).toBeLessThanOrEqual(MAX_BONES);
    expect(recipe.parts.length).toBeGreaterThan(40); // nothing cut: 1 + 2×40 = 81 bones fit
  });

  it('cuts bones when mirrors overflow', () => {
    const parts = [P('root', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1),
      ...Array.from({ length: 47 }, (_, i) => P(`p${i}`, 'root', 'leg', 0.5, [1, -1, 0], 0.05, 0.01, 0.01, { mirror: true }))];
    const { recipe } = normalizeRecipe(makeRecipe('t', parts));
    expect(recipe.parts.reduce((n, p) => n + (p.mirror ? 2 : 1), 0)).toBeLessThanOrEqual(MAX_BONES);
  });

  it('fixes region references and bad colours', () => {
    const r = clone(quadruped);
    r.parts[0].region = 'missing';
    r.skin.regions[0].color = 'orange';
    const { recipe } = normalizeRecipe(r);
    expect(recipe.parts[0].region).toBe('body');
    expect(recipe.skin.regions[0].color).toBe('#8a7a66');
  });

  it('fills missing sections from defaults', () => {
    const { recipe, fixes } = normalizeRecipe({ parts: [{ id: 'blob', role: 'torso', length: 0.1, r0: 0.2, r1: 0.2 }] });
    expect(recipe.parts[0].parent).toBeNull();
    expect(recipe.skin.regions[0].id).toBe('body');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('rejects no input and no parts', () => {
    expect(() => normalizeRecipe(null)).toThrow(RecipeError);
    expect(() => normalizeRecipe({ parts: [] })).toThrow(RecipeError);
  });
});
