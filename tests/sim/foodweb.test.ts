import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { canHunt, isHunter } from '../../src/sim/foodweb';
import { HOMES } from '../../src/sim/homes';
import { traitsFor } from '../../src/sim/traits';
import { quadruped } from '../fixtures/recipes';

const t = Object.fromEntries(CAST.map((c) => [c.recipe.id, traitsFor(c.recipe, HOMES.find((h) => h.species === c.recipe.id)!.medium)]));
const all = Object.values(t);

describe('food web', () => {
  it('makes fox, wolf and hawk hunters, and nobody else', () => {
    for (const id of ['fox', 'wolf', 'hawk']) expect(isHunter(t[id], all), id).toBe(true);
    for (const id of ['deer', 'rabbit', 'duck', 'trout', 'frog']) expect(isHunter(t[id], all), id).toBe(false);
  });
  it('lets hunters take prey of the right size', () => {
    expect(canHunt(t.fox, t.rabbit, false)).toBe(true);
    expect(canHunt(t.fox, t.frog, false)).toBe(true);
    expect(canHunt(t.wolf, t.deer, false)).toBe(true);
    expect(canHunt(t.wolf, t.duck, false)).toBe(true);
    expect(canHunt(t.hawk, t.rabbit, false)).toBe(true);
  });
  it('never has hunters hunt hunters', () => {
    expect(canHunt(t.wolf, t.fox, true)).toBe(false);
  });
  it('keeps land hunters off swimmers', () => {
    expect(canHunt(t.fox, t.trout, false)).toBe(false);
  });
  it('keeps grazers from hunting anything', () => {
    expect(canHunt(t.deer, t.rabbit, false)).toBe(false);
  });
  it('lets a released 8 m creature with a big appetite hunt deer', () => {
    const giant = traitsFor({ ...quadruped, life: { ...quadruped.life, sizeM: 8 }, mind: { ...quadruped.mind, preyMin: 0.5, preyMax: 8 } }, 'land');
    expect(giant.size).toBe(8);
    expect(canHunt(giant, t.deer, false)).toBe(true);
    expect(isHunter(giant, all)).toBe(true);
  });
});
