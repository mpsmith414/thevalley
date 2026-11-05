import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { TICK } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { layWisps } from '../../src/views/trail-mesh';
import { TrailStore, meaningOf, trailColour, type Scent } from '../../src/views/trails';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

/** Record `id` (a rabbit) every `dt` animal s from 0 to `until`, walking along x at 1 m/s. */
function walk(s: TrailStore, id: string, dt: number, until: number, species = 'rabbit') {
  for (let t = 0; t <= until + 1e-9; t += dt) s.record(id, species, t, 0, t);
}

describe('TrailStore', () => {
  it('keeps a point every 2 animal seconds only, however often it is told', () => {
    const s = new TrailStore();
    walk(s, 'rabbit#0', 0.1, 10);
    const pts = s.near(0, 0, 100, 10);
    expect(pts.map((p) => Math.round(p.x * 10) / 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(pts.map((p) => Math.round(p.age * 10) / 10)).toEqual([10, 8, 6, 4, 2, 0]);
    expect(pts.every((p) => p.id === 'rabbit#0' && p.species === 'rabbit')).toBe(true);
  });

  it('drops points older than 2 valley hours (120 animal s), and holds 60 at most', () => {
    const s = new TrailStore();
    walk(s, 'rabbit#0', 0.5, 300);
    const pts = s.near(0, 0, 1000, 300);
    expect(pts.length).toBeLessThanOrEqual(60);
    expect(Math.max(...pts.map((p) => p.age))).toBeLessThanOrEqual(120);
    expect(Math.min(...pts.map((p) => p.age))).toBe(0);
    // later, with nothing new recorded, the old ones age out
    expect(s.near(0, 0, 1000, 400).map((p) => p.age)).toEqual([...Array(11).keys()].map((i) => 120 - 2 * i));
    expect(s.near(0, 0, 1000, 421)).toEqual([]);
  });

  it('gives only the points within the radius', () => {
    const s = new TrailStore();
    walk(s, 'rabbit#0', 2, 20);
    s.record('fox#0', 'fox', 50, 50, 20);
    expect(s.near(10, 0, 3, 20).map((p) => p.x)).toEqual([8, 10, 12]);
    expect(s.near(50, 49, 2, 20).map((p) => p.id)).toEqual(['fox#0']);
  });

  it('forgets an animal that has left', () => {
    const s = new TrailStore();
    walk(s, 'rabbit#0', 2, 10);
    walk(s, 'rabbit#1', 2, 10);
    s.forget('rabbit#0');
    expect(new Set(s.near(0, 0, 100, 10).map((p) => p.id))).toEqual(new Set(['rabbit#1']));
    // a newcomer with the same id starts afresh
    s.record('rabbit#0', 'rabbit', 0, 0, 11);
    expect(s.near(0, 0, 100, 11).filter((p) => p.id === 'rabbit#0')).toHaveLength(1);
  });

  it('gives each trail oldest first', () => {
    const s = new TrailStore();
    walk(s, 'rabbit#0', 2, 200); // wrapped round its ring
    const ages = s.near(0, 0, 1000, 200).map((p) => p.age);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
  });
});

describe('scent colours', () => {
  /** A fox that hunts rabbits, and a wolf that hunts deer and foxes. */
  const web = { hunts: (a: string, b: string) => (a === 'fox' && b === 'rabbit') || (a === 'wolf' && (b === 'deer' || b === 'fox')) };

  it('reads what another animal means to the one smelling it', () => {
    expect(meaningOf('fox', 'rabbit', web)).toBe('prey');
    expect(meaningOf('fox', 'wolf', web)).toBe('danger');
    expect(meaningOf('fox', 'fox', web)).toBe('kin');
    expect(meaningOf('fox', 'deer', web)).toBe('other');
    expect(meaningOf('rabbit', 'fox', web)).toBe('danger');
  });

  it("reads the valley's own food web, and its clock in animal seconds", () => {
    const sim = new Sim(createValley(smallValleyData()), { seed: 7, species: nativeDefs() });
    expect(meaningOf('fox', 'rabbit', sim)).toBe('prey');
    expect(meaningOf('deer', 'wolf', sim)).toBe('danger');
    expect(meaningOf('wolf', 'wolf', sim)).toBe('kin');
    expect(meaningOf('deer', 'rabbit', sim)).toBe('other');
    expect(sim.time).toBe(0);
    sim.step(10 * TICK, 7);
    expect(sim.time).toBeCloseTo(10 * TICK, 6);
  });

  it('colours prey warm gold, dangers red, its own kind pale and others faint white', () => {
    const [gr, gg, gb] = trailColour('prey'), [rr, rg, rb] = trailColour('danger');
    const [kr, kg, kb] = trailColour('kin'), [or, og, ob] = trailColour('other');
    expect(gr > gg && gg > gb && gb < 0.5 * gr).toBe(true); // gold: warm, little blue
    expect(rr > 2 * rg && rr > 2 * rb).toBe(true); // red
    expect(Math.min(kr, kg, kb)).toBeGreaterThan(0.6); // pale: light all round
    expect(or).toBe(og);
    expect(og).toBe(ob); // white
    expect(or).toBeLessThan(0.5 * Math.min(kr, kg, kb)); // and faint
  });
});

describe('layWisps', () => {
  /** A trail of `n` points 3 m apart along x at z, a point every 2 animal s, oldest first. */
  const trail = (id: string, z: number, n: number): Scent[] =>
    Array.from({ length: n }, (_, k) => ({ id, species: 'rabbit', x: 3 * k, z, age: 2 * (n - 1 - k), meaning: 'prey' as const }));
  const laid = (pts: Scent[], max: number) => {
    const out: { x: number; z: number; j: number; p: Scent }[] = [];
    const n = layWisps(pts, max, (_n, x, z, j, _age, p) => out.push({ x, z, j, p }));
    return { n, out };
  };

  it('fills the gaps between the points of a trail, not between trails', () => {
    const { n, out } = laid([...trail('a', 0, 3), ...trail('b', 50, 3)], 100);
    expect(n).toBe(out.length);
    expect(out.filter((w) => w.j === 0)).toHaveLength(6);
    expect(out.filter((w) => w.j > 0)).toHaveLength(8); // 3 m gaps, a wisp about every 0.9 m: two between each pair
    expect(out.every((w) => w.z === w.p.z)).toBe(true);
  });

  it('at the cap the fill thins first: every point of every trail is laid', () => {
    const pts = [...trail('a', 0, 10), ...trail('b', 50, 10)]; // 'b' last in the store: the one an old cap cut
    const { n, out } = laid(pts, 30);
    expect(n).toBe(30);
    const points = out.filter((w) => w.j === 0);
    expect(points).toHaveLength(20);
    expect(points.filter((w) => w.p.id === 'b')).toHaveLength(10);
  });
});
