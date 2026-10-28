import { describe, expect, it } from 'vitest';
import { RATES, URGENT_FEAR, choose, tiredTarget, updateNeeds, type ChoiceCtx } from '../../src/sim/needs';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const sim = new Sim(createValley(smallValleyData()), { seed: 1, species: nativeDefs() });
/** A copy of the first animal of `species`, walking about (not eating, drinking, asleep or on watch), with needs `n`. */
function animal(species: string, n: Partial<Agent['needs']> = {}): Agent {
  const a = structuredClone(sim.agents.find((x) => x.species === species)!);
  Object.assign(a, { doing: 'walk', since: 0 });
  Object.assign(a.pose, { headDown: 0, sleep: 0, mouth: 'shut' });
  Object.assign(a.needs, { hunger: 0.2, thirst: 0.2, tired: 0.1, fear: 0, company: 0 }, n);
  return a;
}
/** One valley hour of ticks. */
function hour(a: Agent, hunter: boolean) {
  for (let i = 0; i < ANIMAL_S_PER_HOUR / TICK; i++) updateNeeds(a, sim.traits(a.species), hunter, TICK, a.needs.tired);
}

describe('needs', () => {
  it('hunger and thirst rise by the rates over one valley hour', () => {
    const cases = [['deer', false, RATES.hunger.grazer], ['wolf', true, RATES.hunger.hunter], ['trout', false, RATES.hunger.small]] as const;
    for (const [species, hunter, rate] of cases) {
      const a = animal(species);
      hour(a, hunter);
      expect(a.needs.hunger, species).toBeCloseTo(0.2 + rate, 6);
      expect(a.needs.thirst, species).toBeCloseTo(species === 'trout' ? 0.2 : 0.2 + RATES.thirst, 6);
    }
  });

  it('eating and drinking bring them down, and fear fades', () => {
    const a = animal('deer', { hunger: 0.8, thirst: 0.8, fear: 1 });
    a.doing = 'graze';
    a.pose.mouth = 'chew';
    hour(a, false);
    expect(a.needs.hunger).toBeCloseTo(0.8 + RATES.hunger.grazer - 0.6, 6);
    expect(a.needs.fear).toBe(0);
    a.doing = 'drink';
    a.pose.mouth = 'lap';
    for (let i = 0; i < 200; i++) updateNeeds(a, sim.traits('deer'), false, TICK, 0.1);
    expect(a.needs.thirst).toBeCloseTo(0.8 + RATES.thirst * (1 + 20 / 60) - 1.5 * (20 / 60), 6);
  });

  it('tiredness eases toward its target and falls in sleep', () => {
    const a = animal('deer', { tired: 0.1 });
    for (let i = 0; i < 300; i++) updateNeeds(a, sim.traits('deer'), false, TICK, 0.85);
    expect(a.needs.tired).toBeCloseTo(0.1 + 0.5 * (30 / 60), 6);
    Object.assign(a, { doing: 'sleep' });
    a.pose.sleep = 1;
    for (let i = 0; i < 300; i++) updateNeeds(a, sim.traits('deer'), false, TICK, 0.85);
    expect(a.needs.tired).toBeCloseTo(0.35 - 0.4 * (30 / 60), 6);
  });

  it('company rises while apart from the group and falls while with it', () => {
    const a = animal('deer', { company: 0.2 });
    for (let i = 0; i < ANIMAL_S_PER_HOUR / TICK; i++) updateNeeds(a, sim.traits('deer'), false, TICK, a.needs.tired, true);
    expect(a.needs.company).toBeCloseTo(0.2 + RATES.companyApart, 6);
    for (let i = 0; i < 100; i++) updateNeeds(a, sim.traits('deer'), false, TICK, a.needs.tired, false);
    expect(a.needs.company).toBeCloseTo(0.5 - 10 / 60, 6);
    const trout = animal('trout');
    updateNeeds(trout, sim.traits('trout'), false, ANIMAL_S_PER_HOUR, 0.1, true);
    expect(trout.needs.company).toBe(0);
  });

  it("small food takes the edge off a hunter's hunger, never filling it", () => {
    const fox = animal('fox', { hunger: 0.9 });
    Object.assign(fox, { doing: 'forage' });
    fox.pose.mouth = 'chew';
    hour(fox, true);
    expect(fox.needs.hunger).toBeCloseTo(0.9 + RATES.hunger.hunter - 0.3, 6);
    for (let i = 0; i < 5; i++) hour(fox, true);
    expect(fox.needs.hunger).toBeCloseTo(0.4, 6);
  });

  it('stamina runs down while running, flat out for 20 s per unit of stamina, and comes back three times slower', () => {
    const fox = animal('fox'), t = sim.traits('fox'), full = 20 * t.stamina;
    fox.motion.speed = t.topSpeed;
    for (let i = 0; i < Math.round(full / 2 / TICK); i++) updateNeeds(fox, t, true, TICK, 0.1);
    expect(fox.stamina).toBeCloseTo(0.5, 6);
    fox.motion.speed = 0.3 * t.topSpeed;
    for (let i = 0; i < Math.round((3 * full) / 4 / TICK); i++) updateNeeds(fox, t, true, TICK, 0.1);
    expect(fox.stamina).toBeCloseTo(0.75, 6);
  });

  it('wants rest in its resting hours', () => {
    expect(tiredTarget('day', -10)).toBeGreaterThan(0.7);
    expect(tiredTarget('day', 30)).toBeLessThan(0.3);
    expect(tiredTarget('night', 30)).toBeGreaterThan(0.7);
    expect(tiredTarget('night', -10)).toBeLessThan(0.3);
    expect(tiredTarget('twilight', 2)).toBeLessThan(0.3);
    expect(tiredTarget('twilight', 60)).toBeGreaterThan(0.7);
    expect(tiredTarget('twilight', -18)).toBeGreaterThan(0.7);
  });
});

describe('choose', () => {
  const day: ChoiceCtx = { sun: 20, dusk: false, hunter: false, forages: true, roll: 0.5 };

  it('keeps grazing unless something matters more by a clear margin', () => {
    const a = animal('deer', { hunger: 0.5, thirst: 0.6, tired: 0 });
    a.doing = 'graze';
    expect(choose(a, sim.traits('deer'), day)).toBe('graze');
    a.needs.thirst = 0.7;
    expect(choose(a, sim.traits('deer'), day)).toBe('drink');
  });

  it('takes the best freely once the current thing is done', () => {
    const a = animal('deer', { hunger: 0.5, thirst: 0.6, tired: 0 });
    Object.assign(a, { doing: 'graze', since: -1 });
    expect(choose(a, sim.traits('deer'), day)).toBe('drink');
  });

  it('grazes or watches when calm, and sleeps in its resting hours', () => {
    const deer = sim.traits('deer');
    const a = animal('deer', { hunger: 0.1, thirst: 0.1, tired: 0.1 });
    a.since = -1;
    expect(choose(a, deer, day)).toBe('graze');
    Object.assign(a, { doing: 'graze', since: -1 });
    expect(choose(a, deer, { ...day, roll: 0 })).toBe('graze'); // a herd keeps its own watcher
    const duck = animal('duck', { hunger: 0.1, thirst: 0.1, tired: 0.1 });
    Object.assign(duck, { doing: 'graze', since: -1 });
    expect(choose(duck, sim.traits('duck'), { ...day, roll: 0 })).toBe('watch');
    const midday = { ...day, sun: 60 };
    expect(choose(animal('deer', { hunger: 0.1, thirst: 0.1, tired: 0.1 }), deer, midday)).toBe('rest');
    expect(choose(animal('deer', { hunger: 0.1, thirst: 0.1, tired: 0.8 }), deer, midday)).toBe('sleep');
  });

  it('carries a hunt through, keeps a held rest, lets a hunter forage after a miss, and a caught animal only goes back to the earth', () => {
    const fox = sim.traits('fox'), hunting = { ...day, hunter: true, sun: 5 };
    expect(choose(animal('fox', { hunger: 0.9 }), fox, { ...hunting, cooling: true })).toBe('forage');
    expect(choose(animal('wolf', { hunger: 0.9 }), sim.traits('wolf'), { ...hunting, forages: false, cooling: true })).toBe('search');
    for (const doing of ['stalk', 'chase', 'dive', 'eat'] as const) expect(choose({ ...animal('fox', { thirst: 0.95 }), doing, since: 1 }, fox, hunting)).toBe(doing);
    expect(choose({ ...animal('fox', { hunger: 0.9 }), doing: 'rest', since: 1 }, fox, { ...hunting, hold: true })).toBe('rest');
    expect(choose({ ...animal('rabbit', { fear: 1 }), doing: 'returning', since: 1 }, sim.traits('rabbit'), day)).toBe('returning');
  });

  it('sends a hungry hunter searching and lets a fox forage berries meanwhile', () => {
    const fox = sim.traits('fox'), hunting = { ...day, hunter: true, sun: 5 };
    expect(choose(animal('fox', { hunger: 0.2 }), fox, hunting)).toBe('forage');
    expect(choose(animal('fox', { hunger: 0.9 }), fox, hunting)).toBe('search');
    expect(choose(animal('wolf', { hunger: 0.2 }), sim.traits('wolf'), { ...hunting, forages: false })).toBe('search');
  });

  it('leans a follower on its leader: it drinks, lies down and feeds with it unless a need of its own presses', () => {
    const deer = sim.traits('deer');
    const a = animal('deer', { hunger: 0.4, thirst: 0, tired: 0.1 });
    a.doing = 'graze';
    expect(choose(a, deer, { ...day, lead: 'drink' })).toBe('drink');
    expect(choose(a, deer, { ...day, lead: 'sleep' })).toBe('rest');
    expect(choose(a, deer, { ...day, lead: 'watch' })).toBe('graze');
    a.needs.hunger = 0.9;
    expect(choose(a, deer, { ...day, lead: 'drink' })).toBe('graze'); // too hungry to go along
    const resting = { ...day, sun: 60 }, b = animal('deer', { hunger: 0.4, thirst: 0.1, tired: 0.6 });
    b.doing = 'sleep';
    expect(choose(b, deer, { ...resting, lead: 'graze' })).toBe('graze'); // gets up when its leader does
    const c = animal('deer', { hunger: 0.4, thirst: 0.6, tired: 0.1 });
    c.doing = 'drink';
    expect(choose(c, deer, { ...day, lead: 'graze' })).toBe('drink'); // finishes its drink
  });

  it('does not tip between drinking with its leader and feeding at a hunger on the line (no flicker)', () => {
    // hunger sits at PRESSING (0.9): feeding eats it down a hair, not feeding lets it rise a hair
    const deer = sim.traits('deer'), a = animal('deer', { hunger: 0.9, thirst: 0, tired: 0.1 });
    a.doing = 'graze';
    let flips = 0;
    for (let i = 0; i < 200; i++) {
      const next = choose(a, deer, { ...day, lead: 'drink' });
      if (next !== a.doing) flips++;
      a.doing = next;
      a.needs.hunger += next === 'graze' ? -0.0005 : 0.0005;
    }
    expect(flips).toBeLessThanOrEqual(2); // it settles to one or the other, and goes along once its hunger is well down
  });

  it('flees when afraid, whatever its leader does or its watch', () => {
    const deer = sim.traits('deer');
    const a = animal('deer', { hunger: 0.4, thirst: 0.3, fear: 0.8 });
    a.doing = 'drink';
    expect(choose(a, deer, { ...day, lead: 'drink' })).toBe('flee');
    a.doing = 'watch';
    expect(choose(a, deer, { ...day, lead: 'graze' })).toBe('flee');
    a.needs.fear = URGENT_FEAR - 0.01;
    expect(choose(a, deer, { ...day, lead: 'graze' })).toBe('watch');
  });

  it('sees a fright through until it is done, then stands watch while wary', () => {
    const deer = sim.traits('deer'), a = animal('deer', { hunger: 0.9, fear: 0 });
    for (const d of ['flee', 'freeze', 'hide'] as const) {
      a.doing = d;
      expect(choose(a, deer, day)).toBe(d);
    }
    a.since = -1;
    a.wary = 5;
    expect(choose(a, deer, day)).toBe('watch');
    a.needs.fear = URGENT_FEAR;
    expect(choose(a, deer, day)).toBe('flee');
  });

  it('sees a stint of watch through', () => {
    const a = animal('deer', { hunger: 0.8, thirst: 0.1, tired: 0.1 });
    a.doing = 'watch';
    expect(choose(a, sim.traits('deer'), day)).toBe('watch');
    a.since = -1;
    expect(choose(a, sim.traits('deer'), day)).toBe('graze');
  });

  it('walks back to its group once company presses', () => {
    const a = animal('deer', { hunger: 0.1, thirst: 0.1, tired: 0.1, company: 0.6 });
    a.since = -1;
    expect(choose(a, sim.traits('deer'), day)).toBe('walk');
    const trout = animal('trout', { hunger: 0.1, company: 0.9 });
    trout.since = -1;
    expect(choose(trout, sim.traits('trout'), day)).not.toBe('walk');
  });

  it('never sends a swimmer to drink, and frogs call at dusk', () => {
    expect(choose(animal('trout', { thirst: 1 }), sim.traits('trout'), day)).not.toBe('drink');
    expect(choose(animal('frog', { hunger: 0.1, thirst: 0.1 }), sim.traits('frog'), { ...day, sun: 2, dusk: true })).toBe('call');
  });

  it('gathers a flock of water birds to rest at dusk (a raft), not before', () => {
    const duck = () => animal('duck', { hunger: 0.3, thirst: 0.1 });
    expect(choose(duck(), sim.traits('duck'), { ...day, sun: 2, dusk: true })).toBe('rest');
    expect(choose(duck(), sim.traits('duck'), day)).not.toBe('rest');
  });
});
