import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { HOMES } from '../../src/sim/homes';
import { Places } from '../../src/sim/places';
import { Rng } from '../../src/sim/rng';
import { traitsFor } from '../../src/sim/traits';
import type { Pt } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const home = (species: string) => HOMES.find((h) => h.species === species)!;
const traits = (species: string) => traitsFor(CAST.find((c) => c.recipe.id === species)!.recipe, home(species).medium);
const forest = (p: Pt) => world.biomeAt(p.x, p.z).forest;
/** Points spread round a home, to ask from. */
const around = (species: string, n = 12) => {
  const h = home(species);
  return Array.from({ length: n }, (_, k) => ({ x: h.center.x + Math.cos(k * 2.4) * h.radius * 0.6, z: h.center.z + Math.sin(k * 2.4) * h.radius * 0.6 }));
};
const wetWithin = (p: Pt, r: number) => {
  for (let k = 0; k < 32; k++) if (world.isWater(p.x + Math.cos((k * Math.PI) / 16) * r, p.z + Math.sin((k * Math.PI) / 16) * r)) return true;
  return world.isWater(p.x, p.z);
};

describe('Places', () => {
  it('beds deer down at the forest edge', () => {
    const places = new Places(world, new Rng(1));
    for (const near of around('deer')) {
      const p = places.restSpot(home('deer'), traits('deer'), near);
      expect(forest(p)).toBeGreaterThanOrEqual(0.3);
      expect(forest(p)).toBeLessThanOrEqual(0.7);
    }
  });

  it('grazes deer in the meadow or at the forest edge', () => {
    const places = new Places(world, new Rng(2));
    for (const near of around('deer')) {
      const p = places.grazeSpot(home('deer'), traits('deer'), near), b = world.biomeAt(p.x, p.z);
      expect(b.meadow >= 0.4 || (b.forest >= 0.3 && b.forest <= 0.7)).toBe(true);
    }
  });

  it('finds a dry bank within a metre of the water', () => {
    const places = new Places(world, new Rng(3));
    for (const species of ['deer', 'rabbit', 'fox', 'wolf', 'frog']) {
      const p = places.bank(home(species).center)!;
      expect(p, species).not.toBeNull();
      expect(world.isWater(p.x, p.z)).toBe(false);
      expect(wetWithin(p, 1)).toBe(true);
    }
  });

  it('keeps walkers dry and rafts ducks on deep water', () => {
    const places = new Places(world, new Rng(4));
    for (const species of ['deer', 'rabbit', 'fox', 'wolf', 'hawk', 'frog'])
      for (const near of around(species, 6)) {
        const h = home(species), t = traits(species);
        for (const p of [places.restSpot(h, t, near), places.grazeSpot(h, t, near), places.roamSpot(h, t, near)])
          expect(world.isWater(p.x, p.z), species).toBe(false);
      }
    for (const near of around('duck', 6)) {
      const p = places.restSpot(home('duck'), traits('duck'), near);
      expect(world.waterDepthAt(p.x, p.z)).toBeGreaterThanOrEqual(0.6);
    }
    for (const near of around('trout', 6)) expect(world.isWater(...xz(places.roamSpot(home('trout'), traits('trout'), near)))).toBe(true);
  });

  it('picks the same spots whatever order it is asked in', () => {
    const rngB = new Rng(5), a = new Places(world, new Rng(5)), b = new Places(world, rngB);
    const deer = home('deer'), t = traits('deer'), near = deer.center;
    const fromA = [a.grazeSpot(deer, t, near), a.restSpot(deer, t, near)];
    b.restSpot(home('wolf'), traits('wolf'), near); // other homes' spots first
    b.restSpot(deer, t, near);
    rngB.s = 5; // the same shared numbers from here: only the order the spots were sampled in differs
    expect([b.grazeSpot(deer, t, near), b.restSpot(deer, t, near)]).toEqual(fromA);
  });

  it('grazes rabbits out in the open meadow, not at the forest edge (they do not eat leaves)', () => {
    const places = new Places(world, new Rng(5));
    for (const near of around('rabbit')) {
      const p = places.grazeSpot(home('rabbit'), traits('rabbit'), near), b = world.biomeAt(p.x, p.z);
      expect(b.meadow).toBeGreaterThanOrEqual(0.4);
      expect(b.forest).toBeLessThan(0.3);
    }
  });

  it('finds a bank outside a keep-off when the nearest lies inside it', () => {
    const places = new Places(world, new Rng(6)), from = home('frog').center, near = places.bank(from)!;
    const keep = (p: Pt) => Math.hypot(p.x - near.x, p.z - near.z) - 40; // the nearest bank and 40 m round it kept off
    const kept = places.bank(from, keep)!;
    expect(keep(kept)).toBeGreaterThanOrEqual(0);
    expect(world.isWater(kept.x, kept.z)).toBe(false);
    expect(wetWithin(kept, 1.5)).toBe(true);
  });

  it('finds cover on the far side from a danger', () => {
    const places = new Places(world, new Rng(6));
    const from = home('deer').center, away = { x: from.x + 20, z: from.z };
    const p = places.cover(from, away, 300)!;
    expect(p).not.toBeNull();
    expect(forest(p)).toBeGreaterThanOrEqual(0.6);
    expect(p.x).toBeLessThanOrEqual(from.x);
  });
});

function xz(p: Pt): [number, number] {
  return [p.x, p.z];
}
