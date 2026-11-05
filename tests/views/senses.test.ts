import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import type { Recipe } from '../../src/recipe/schema';
import { Sim } from '../../src/sim/sim';
import { createValley } from '../../src/valley/valley';
import { SENSE_LABEL, firstLine, nextSense, sensesOf } from '../../src/views/senses';
import { Views, type ViewAnimal } from '../../src/views/views';
import type { FlyWorld } from '../../src/camera/freefly';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const sim = new Sim(createValley(smallValleyData()), { seed: 7, species: nativeDefs() });
const senses = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe.mind.senses;
/** The cast member `id`'s senses, as the valley's food web has it, calm or `afraid`. */
const of = (id: string, afraid = false) => sensesOf(senses(id), sim.isPrey(id), afraid);
const recipe = (over: Partial<Recipe['mind']['senses']>): Recipe['mind']['senses'] => ({ ...senses('deer'), ...over });

describe('the food web for the senses', () => {
  it('knows who is prey in the valley (the dangers), and that fish always are', () => {
    for (const id of ['deer', 'rabbit', 'duck', 'frog', 'trout']) expect(sim.isPrey(id), id).toBe(true);
    for (const id of ['fox', 'wolf', 'hawk']) expect(sim.isPrey(id), id).toBe(false);
    expect(sim.preyOf('fox')).toContain('rabbit');
  });
});

describe('sensesOf', () => {
  it('gives the cast their senses, keenest first', () => {
    expect(of('fox')).toEqual(['hearing', 'smell']);
    expect(of('wolf')).toEqual(['smell', 'hearing']);
    expect(of('hawk')).toEqual(['sharp']);
    expect(of('duck')).toEqual(['fear']);
    expect(of('frog')).toEqual(['fear']);
    expect(of('trout')).toEqual(['fear']);
    expect(new Set(of('rabbit'))).toEqual(new Set(['hearing', 'smell', 'fear']));
  });

  it('puts Fear last for calm prey and first for afraid prey', () => {
    expect(of('deer')).toEqual(['hearing', 'smell', 'fear']); // hearing 0.9, smell 0.8
    expect(of('deer', true)).toEqual(['fear', 'hearing', 'smell']);
    expect(of('rabbit', true)[0]).toBe('fear');
  });

  it('gives an animal with none of them the keener of smell or hearing', () => {
    expect(sensesOf(recipe({ smell: 0.4, hearing: 0.5, acuity: 0.5 }), false, false)).toEqual(['hearing']);
    expect(sensesOf(recipe({ smell: 0.6, hearing: 0.5, acuity: 0.5 }), false, false)).toEqual(['smell']);
  });

  it('uses the thresholds: smell from 0.7, hearing and sharp eyes from 0.85', () => {
    expect(sensesOf(recipe({ smell: 0.7, hearing: 0.85, acuity: 0.85 }), false, false)).toEqual(expect.arrayContaining(['smell', 'hearing', 'sharp']));
    expect(sensesOf(recipe({ smell: 0.69, hearing: 0.84, acuity: 0.84 }), true, false)).toEqual(['fear']);
  });
});

describe('the Sense button', () => {
  it('cycles off, then each sense in turn, then off', () => {
    const list = of('deer');
    let s = nextSense(list, null);
    const seen = [s];
    while (s !== null) seen.push((s = nextSense(list, s)));
    expect(seen).toEqual(['hearing', 'smell', 'fear', null]);
    expect(nextSense([], null)).toBeNull();
    expect(nextSense(['smell'], 'fear')).toBeNull(); // a sense it no longer has: off
  });

  it('steps the views through the locked animal’s list', () => {
    const world: FlyWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
    const a: ViewAnimal = {
      pose: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, size: 1.6, bodyLength: 1.4, backHeight: 1.1, flying: false, turnRate: 0 },
      eye: { pos: { x: 0, y: 1.3, z: -0.7 }, yaw: 0, pitch: 0 }, name: 'Fox', native: true, doing: 'walk', swimmer: false, chasing: false, gone: null,
    };
    const views = new Views({ world, animal: () => a, say: () => {}, now: () => 0 });
    views.nextSense(['hearing', 'smell']);
    expect(views.state.sense).toBeNull(); // free flight: no senses
    views.lock('fox#0');
    const seen = [1, 2, 3].map(() => (views.nextSense(['hearing', 'smell']), views.state.sense));
    expect(seen).toEqual(['hearing', 'smell', null]);
  });
});

describe('the words', () => {
  it('names each sense', () => {
    expect(SENSE_LABEL).toEqual({ smell: 'Smell', hearing: 'Hearing', sharp: 'Sharp eyes', fear: 'Fear' });
  });

  it('explains a sense in one line the first time', () => {
    expect(firstLine('smell', 'the fox', 'the rabbits')).toBe('The fox can smell where the rabbits have been.');
    expect(firstLine('smell', 'the deer')).toBe('The deer can smell where other animals have been.');
    expect(firstLine('smell', 'the hawk', 'Bramble and family')).toBe('The hawk can smell where Bramble and family have been.');
    for (const s of ['hearing', 'sharp', 'fear'] as const) {
      const line = firstLine(s, 'Bramble', 'the mice');
      expect(line).toMatch(/^Bramble.*\.$/);
      expect(line.length).toBeLessThan(70);
    }
  });
});
