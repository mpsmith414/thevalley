import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { HOMES } from '../../src/sim/homes';
import { traitsFor } from '../../src/sim/traits';
import { bird, blob } from '../fixtures/recipes';

const mediumOf = (id: string) => HOMES.find((h) => h.species === id)!.medium;
const cast = Object.fromEntries(CAST.map((c) => [c.recipe.id, traitsFor(c.recipe, mediumOf(c.recipe.id))]));

describe('traitsFor', () => {
  it('caps the ground speed at the valley cap and the flying speed at 1.6 times it', () => {
    for (const { recipe } of CAST) {
      const t = cast[recipe.id];
      expect(t.topSpeed).toBe(Math.min(recipe.life.topSpeed, 8));
      expect(t.flySpeed).toBe(Math.min(recipe.life.topSpeed, 8 * 1.6));
      expect(t.medium).toBe(mediumOf(recipe.id));
    }
    expect(cast.hawk.flySpeed).toBeCloseTo(12.8);
  });
  it('takes the speed cap as a parameter', () => {
    const t = traitsFor(CAST[0].recipe, 'land', 3);
    expect(t.topSpeed).toBe(3);
    expect(t.flySpeed).toBeCloseTo(4.8);
  });
  it('knows who flies, swims, floats and hovers', () => {
    expect(cast.hawk.canFly).toBe(true);
    expect(cast.duck.canFly).toBe(true);
    expect(cast.duck.floater).toBe(true);
    expect(cast.trout.swimmer).toBe(true);
    expect(cast.deer.canFly).toBe(false);
    expect(cast.hawk.hover).toBe(false);
    expect(traitsFor({ ...bird, motion: { ...bird.motion, gait: 'hover' } }, 'air').hover).toBe(true);
  });
  it('makes deer and rabbit grazers but not the fox, which eats berries', () => {
    expect(cast.deer.grazer).toBe(true);
    expect(cast.rabbit.grazer).toBe(true);
    expect(cast.fox.grazer).toBe(false);
    expect(cast.wolf.grazer).toBe(false);
  });
  it('makes leaf-eaters browsers, which feed at the forest edge too', () => {
    expect(cast.deer.browser).toBe(true); // leaves and acorns
    expect(cast.rabbit.browser).toBe(false); // grass, clover, flowers
  });
  it('treats "any plant" as grazing only for animals that do not hunt', () => {
    const eats = (preyMax: number) => traitsFor({ ...blob, mind: { ...blob.mind, plants: ['any plant'], preyMax } }, 'land').grazer;
    expect(eats(0)).toBe(true);
    expect(eats(0.5)).toBe(false);
  });
  it('marks the duck, trout and frog as small-food eaters', () => {
    for (const id of ['duck', 'trout', 'frog']) expect(cast[id].smallFood).toBe(true);
    for (const id of ['deer', 'rabbit', 'fox', 'wolf', 'hawk']) expect(cast[id].smallFood).toBe(false);
  });
  it('makes only the rabbit freeze', () => {
    expect(Object.keys(cast).filter((id) => cast[id].freezes)).toEqual(['rabbit']);
    expect(cast.rabbit.burrower).toBe(true);
    expect(cast.fox.burrower).toBe(true);
    expect(cast.deer.burrower).toBe(false);
  });
  it('keeps size, speed and body length in range for a tiny slow blob', () => {
    const t = traitsFor({ ...blob, life: { ...blob.life, topSpeed: 0.05, sizeM: 0.001 } }, 'land');
    expect(t.topSpeed).toBeGreaterThanOrEqual(0.3);
    expect(t.size).toBe(0.05);
    expect(t.bodyLength).toBeGreaterThan(0);
    expect(traitsFor({ ...blob, life: { ...blob.life, sizeM: 50 } }, 'land').size).toBe(8);
  });
  it('measures body length along the body', () => {
    expect(cast.deer.bodyLength).toBeGreaterThan(cast.rabbit.bodyLength);
  });
});
