import { describe, expect, it } from 'vitest';
import { arrivalHome, arrivalShot, arrivalView, entryPoints, mediumOf, onwardPoints, pushView, shotSize } from '../../src/bring/arrival';
import { surfaceAt } from '../../src/camera/freefly';
import { viewpointPose } from '../../src/camera/viewpoints';
import type { Viewpoint } from '../../src/valley/types';
import { CAST } from '../../src/cast';
import { VALLEY } from '../../src/valley/layout';
import { createValley } from '../../src/valley/valley';
import { bird, quadruped, snake } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

const valley = createValley(smallValleyData(513));
const trout = CAST.find((c) => c.recipe.id === 'trout')!.recipe;
const mean = (ps: { x: number; z: number }[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length });
const meadow = mean(VALLEY.areas.find((a) => a.kind === 'meadow')!.points);
const lake = mean(VALLEY.lake.outline);
const eyeAt = (p: { x: number; z: number }) => ({ x: p.x, y: valley.heightAt(p.x, p.z) + 1.6, z: p.z });
const slopeDeg = (x: number, z: number) => (Math.acos(valley.normalAt(x, z).y) * 180) / Math.PI;

describe('mediumOf', () => {
  it('reads the medium the way native homes are written', () => {
    expect(mediumOf(quadruped)).toBe('land');
    expect(mediumOf(trout)).toBe('water');
    expect(mediumOf(bird)).toBe('air');
    expect(mediumOf(CAST.find((c) => c.recipe.id === 'hawk')!.recipe)).toBe('air');
    expect(mediumOf(CAST.find((c) => c.recipe.id === 'deer')!.recipe)).toBe('land');
    expect(mediumOf(snake)).toBe('land'); // no aquatic hint
    // a creature that swims lives in the water even if it can fly, as the native duck's home is written
    expect(mediumOf(CAST.find((c) => c.recipe.id === 'duck')!.recipe)).toBe('water');
    expect(mediumOf(CAST.find((c) => c.recipe.id === 'frog')!.recipe)).toBe('land');
  });
});

describe('arrivalHome', () => {
  it('puts a quadruped on gentle dry land in front of the camera', () => {
    expect(valley.isWater(meadow.x, meadow.z)).toBe(false);
    const eye = eyeAt(meadow), forward = { x: 0, z: 1 };
    const h = arrivalHome(valley, quadruped, 'q1', eye, forward);
    expect(h).toMatchObject({ species: 'q1', count: 3, radius: 40, medium: 'land', prefer: [] });
    expect(valley.isWater(h.center.x, h.center.z)).toBe(false);
    expect(slopeDeg(h.center.x, h.center.z)).toBeLessThan(25);
    expect(valley.trunksNear(h.center.x, h.center.z, 2)).toHaveLength(0);
    expect(valley.inside(h.center.x, h.center.z, 30)).toBe(true);
    const d = Math.hypot(h.center.x - eye.x, h.center.z - eye.z);
    expect(d).toBeGreaterThanOrEqual(25 - 1e-6);
    expect(d).toBeLessThanOrEqual(60 + 1e-6);
    expect((h.center.x - eye.x) * forward.x + (h.center.z - eye.z) * forward.z).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const eye = eyeAt(meadow);
    expect(arrivalHome(valley, quadruped, 'q', eye, { x: 1, z: 0 })).toEqual(arrivalHome(valley, quadruped, 'q', eye, { x: 1, z: 0 }));
  });

  it('puts a fish in deep water, the nearest it can find', () => {
    const eye = eyeAt(meadow);
    const h = arrivalHome(valley, trout, 'f1', eye, { x: 1, z: 0 });
    expect(h).toMatchObject({ species: 'f1', count: 3, radius: 25, medium: 'water', prefer: [] });
    expect(valley.waterDepthAt(h.center.x, h.center.z)).toBeGreaterThanOrEqual(2);
    // a fish asked for from the middle of the lake stays right there
    const mid = arrivalHome(valley, trout, 'f2', eyeAt(lake), { x: 1, z: 0 });
    expect(Math.hypot(mid.center.x - lake.x, mid.center.z - lake.z)).toBeLessThan(5);
  });

  it('puts a bird in the air over dry land, over a meadow when there is one', () => {
    const h = arrivalHome(valley, bird, 'b1', eyeAt(meadow), { x: 0, z: -1 });
    expect(h.medium).toBe('air');
    expect(h.radius).toBe(40);
    expect(valley.isWater(h.center.x, h.center.z)).toBe(false);
    expect(valley.biomeAt(h.center.x, h.center.z).meadow).toBeGreaterThanOrEqual(0.4);
  });

  it('puts a bird over plain land rules when no meadow is to be found', () => {
    const bare = { ...valley, biomeAt: (x: number, z: number) => ({ ...valley.biomeAt(x, z), meadow: 0 }) };
    const h = arrivalHome(bare, bird, 'b2', eyeAt(meadow), { x: 0, z: -1 });
    expect(h.medium).toBe('air');
    expect(valley.isWater(h.center.x, h.center.z)).toBe(false);
    expect(slopeDeg(h.center.x, h.center.z)).toBeLessThan(25);
  });

  it('still finds a valid land home when the camera stands in the lake looking at water', () => {
    expect(valley.waterDepthAt(lake.x, lake.z)).toBeGreaterThan(2);
    for (const forward of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
      const h = arrivalHome(valley, quadruped, 'q', eyeAt(lake), forward);
      expect(h.medium).toBe('land');
      expect(valley.isWater(h.center.x, h.center.z)).toBe(false);
      expect(slopeDeg(h.center.x, h.center.z)).toBeLessThan(25);
      expect(valley.inside(h.center.x, h.center.z, 30)).toBe(true);
    }
  });

  it('falls back to a swimmer on land when there is no deep water', () => {
    const dry = { ...valley, waterDepthAt: () => 0 };
    const h = arrivalHome(dry, trout, 'f', eyeAt(meadow), { x: 1, z: 0 });
    expect(h.medium).toBe('land');
    expect(valley.isWater(h.center.x, h.center.z)).toBe(false);
  });
});

describe('arrivalView', () => {
  it('stands 12 m back towards the eye, 4 m up, looking at the centre', () => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, quadruped, 'q', eye, { x: 0, z: 1 });
    const v = arrivalView(home, eye);
    expect(Math.hypot(v.pos.x - home.center.x, v.pos.z - home.center.z)).toBeCloseTo(12, 6);
    expect(v.pos.h).toBe(4);
    expect(v.look).toMatchObject({ x: home.center.x, z: home.center.z });
    expect(v.look.h).toBeGreaterThan(0);
    // on the camera's side of the spot
    const toEye = { x: eye.x - home.center.x, z: eye.z - home.center.z };
    expect((v.pos.x - home.center.x) * toEye.x + (v.pos.z - home.center.z) * toEye.z).toBeGreaterThan(0);
  });

  it('copes with an eye right on the centre', () => {
    const home = { species: 's', count: 3, center: { x: 5, z: 5 }, radius: 40, medium: 'land' as const, prefer: [] };
    const v = arrivalView(home, { x: 5, z: 5 });
    expect(Math.hypot(v.pos.x - 5, v.pos.z - 5)).toBeCloseTo(12, 6);
  });
});

describe('entryPoints', () => {
  /** In view of a 55 degree vertical, 16:9 camera at the viewpoint (ground points, in 3D). */
  const seen = (v: ReturnType<typeof arrivalView>, p: { x: number; z: number }) => {
    const cam = { x: v.pos.x, y: valley.heightAt(v.pos.x, v.pos.z) + v.pos.h, z: v.pos.z };
    const tgt = { x: v.look.x, y: valley.heightAt(v.look.x, v.look.z) + v.look.h, z: v.look.z };
    const f = { x: tgt.x - cam.x, y: tgt.y - cam.y, z: tgt.z - cam.z };
    const fl = Math.hypot(f.x, f.y, f.z);
    const fwd = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
    const rl = Math.hypot(fwd.x, fwd.z);
    const right = { x: -fwd.z / rl, y: 0, z: fwd.x / rl };
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    const w = { x: p.x - cam.x, y: valley.heightAt(p.x, p.z) - cam.y, z: p.z - cam.z };
    const depth = w.x * fwd.x + w.y * fwd.y + w.z * fwd.z;
    if (depth <= 0) return false;
    const sx = (w.x * right.x + w.z * right.z) / depth;
    const sy = (w.x * up.x + w.y * up.y + w.z * up.z) / depth;
    const ty = Math.tan((55 / 2) * (Math.PI / 180));
    return Math.abs(sy) < ty && Math.abs(sx) < ty * (16 / 9);
  };

  it.each([
    ['land', quadruped],
    ['water', trout],
    ['air', bird],
  ])('starts a %s family outside the view, valid for the medium', (_n, recipe) => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, recipe, 'x', eye, { x: 1, z: 0 });
    const view = arrivalView(home, eye);
    const pts = entryPoints(valley, home, view, 3);
    expect(pts).toHaveLength(3);
    for (const p of pts) {
      expect(seen(view, p), `${home.medium} ${p.x},${p.z}`).toBe(false);
      expect(valley.inside(p.x, p.z, 0)).toBe(true);
      expect(valley.isWater(p.x, p.z)).toBe(home.medium === 'water');
      expect(Math.hypot(p.x - home.center.x, p.z - home.center.z)).toBeGreaterThanOrEqual(10); // 12 m to the side of a 12 m framing, or further
    }
  });

  it('starts the family together, 18 m to the side (Ruling R6) of an 18 m framing (in proportion for a nearer one), when the ground allows', () => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, quadruped, 'x', eye, { x: 1, z: 0 });
    const m18 = mean(entryPoints(valley, home, arrivalShot(valley, home, eye).wide, 3));
    const d18 = Math.hypot(m18.x - home.center.x, m18.z - home.center.z);
    expect(d18).toBeGreaterThan(17.5); // 18 m, or the next anchor out (23 m) where 18 m is still in the wider picture
    expect(d18).toBeLessThan(23.5);
    const pts = entryPoints(valley, home, arrivalView(home, eye), 3); // 12 m back: 12 m to the side
    const m = mean(pts);
    const d12 = Math.hypot(m.x - home.center.x, m.z - home.center.z);
    expect(d12).toBeGreaterThan(11.5);
    expect(d12).toBeLessThan(16);
    expect(Math.hypot(pts[0].x - pts[2].x, pts[0].z - pts[2].z)).toBeCloseTo(6, 5);
  });

  it('walks the family in from the left of the picture, away from the join card in the bottom right corner', () => {
    // found in the live run: from the right, the family came in behind the card (it stays up while phones are connected)
    for (const facing of [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -0.6, z: -0.8 }]) {
      const eye = eyeAt(meadow);
      const home = arrivalHome(valley, quadruped, 'x', eye, facing);
      const view = arrivalView(home, eye);
      const fx = view.look.x - view.pos.x, fz = view.look.z - view.pos.z, fl = Math.hypot(fx, fz);
      const right = { x: -fz / fl, z: fx / fl }; // screen right for a camera looking along (fx, fz), y up
      const m = mean(entryPoints(valley, home, view, 3));
      expect((m.x - home.center.x) * right.x + (m.z - home.center.z) * right.z, `facing ${facing.x},${facing.z}`).toBeLessThan(-10);
    }
  });
});

describe('arrival v2: open ground, a clear camera, a push-in and a walk on', () => {
  const forest = VALLEY.viewpoints.filter((v) => v.name === 'Forest Floor' || v.name === 'River Bend');
  const from = (v: (typeof forest)[number]) => {
    const p = viewpointPose(v, valley);
    return { eye: p.pos, forward: { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) } };
  };
  /** Points along the sight line from a view's eye to its look point that a trunk (within 1.5 m) or the ground blocks. */
  const blocked = (v: Viewpoint, lookH = v.look.h) => {
    const a = { x: v.pos.x, y: surfaceAt(valley, v.pos.x, v.pos.z) + v.pos.h, z: v.pos.z };
    const b = { x: v.look.x, y: surfaceAt(valley, v.look.x, v.look.z) + lookH, z: v.look.z };
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5), out: string[] = [];
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
      if (valley.trunksNear(x, z, 1.5).length) out.push(`trunk at ${x.toFixed(1)},${z.toFixed(1)}`);
      if (surfaceAt(valley, x, z) > y) out.push(`ground at ${x.toFixed(1)},${z.toFixed(1)}`);
    }
    return out;
  };

  it.each(forest.map((v) => [v.name, v] as const))('from %s: a home on open ground (no trunk within 12 m), seen along a clear line', (_n, v) => {
    const { eye, forward } = from(v);
    for (const recipe of [quadruped, bird]) {
      const home = arrivalHome(valley, recipe, 'q', eye, forward);
      const c = home.center;
      expect(valley.trunksNear(c.x, c.z, 12), `${recipe.id}: open ground`).toHaveLength(0);
      expect(valley.isWater(c.x, c.z)).toBe(false);
      expect(slopeDeg(c.x, c.z)).toBeLessThan(25);
      const shot = arrivalShot(valley, home, eye);
      // wider and higher at the glide's end, today's 12 m / 4 m once pushed in, on the same bearing, both looking at the home
      expect(Math.hypot(shot.wide.pos.x - c.x, shot.wide.pos.z - c.z)).toBeCloseTo(18, 5);
      expect(shot.wide.pos.h).toBeGreaterThanOrEqual(6);
      expect(shot.wide.pos.h).toBeLessThanOrEqual(7);
      expect(Math.hypot(shot.close.pos.x - c.x, shot.close.pos.z - c.z)).toBeCloseTo(12, 5);
      expect(shot.close.pos.h).toBe(4);
      expect(shot.wide.look).toEqual(shot.close.look);
      expect(shot.close.look).toMatchObject({ x: c.x, z: c.z });
      const bearing = (p: { x: number; z: number }) => Math.atan2(p.z - c.z, p.x - c.x);
      expect(bearing(shot.wide.pos)).toBeCloseTo(bearing(shot.close.pos), 6);
      const lookH = recipe === bird ? 3 : 0.5; // a flier comes in 3 m up
      expect(blocked(shot.wide, lookH), `${v.name} ${recipe.id} wide`).toEqual([]);
      expect(blocked(shot.close, lookH), `${v.name} ${recipe.id} close`).toEqual([]);
    }
  });

  it('sizes the framings to the creature: a fox fills a good part of the picture, a deer gets about 12 m / 4 m', () => {
    expect(shotSize(1)).toMatchObject({ back: 7, wideBack: 10.5 });
    expect(shotSize(1).up).toBeCloseTo(7 / 3, 6);
    expect(shotSize(0.18)).toMatchObject({ back: 5, up: 2 }); // a frog: no nearer than 5 m, 2 m up
    expect(shotSize(1.6).back).toBeCloseTo(11.2, 6);
    expect(shotSize(3)).toMatchObject({ back: 12, up: 4, wideBack: 18 });
    expect(shotSize(3).wideUp).toBeCloseTo(6.4, 6);
    const eye = eyeAt(meadow), home = arrivalHome(valley, quadruped, 'q', eye, { x: 0, z: 1 });
    const fox = arrivalShot(valley, home, eye, 1), c = home.center;
    expect(Math.hypot(fox.close.pos.x - c.x, fox.close.pos.z - c.z)).toBeCloseTo(7, 5);
    expect(Math.hypot(fox.wide.pos.x - c.x, fox.wide.pos.z - c.z)).toBeCloseTo(10.5, 5);
    expect(blocked(fox.close)).toEqual([]);
  });

  it.each(forest.map((v) => [v.name, v] as const))('from %s: the family walks on to open ground (no trunk within 12 m)', (_n, v) => {
    const { eye, forward } = from(v);
    const home = arrivalHome(valley, quadruped, 'q', eye, forward);
    const shot = arrivalShot(valley, home, eye, quadruped.life.sizeM);
    const lead = onwardPoints(valley, home, shot.close, 3)![0];
    expect(valley.trunksNear(lead.x, lead.z, 12), `${v.name} lead at ${lead.x.toFixed(0)},${lead.z.toFixed(0)}`).toHaveLength(0);
  });

  it('walks on to open ground rather than into a wood with a clear path through it, when there is open ground round about', () => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, quadruped, 'q', eye, { x: 0, z: 1 });
    const shot = arrivalShot(valley, home, eye, quadruped.life.sizeM), c = home.center;
    // a grove straight on (away from the camera), with a 10 m wide path through it: the old pick walked into it
    const fl = Math.hypot(c.x - shot.close.pos.x, c.z - shot.close.pos.z);
    const ux = (c.x - shot.close.pos.x) / fl, uz = (c.z - shot.close.pos.z) / fl;
    const grove: { x: number; z: number; r: number }[] = [];
    for (let d = 16; d <= 44; d += 4) for (const side of [-5, 5, -9, 9]) grove.push({ x: c.x + ux * d - uz * side, z: c.z + uz * d + ux * side, r: 0.3 });
    const wood = { ...valley, trunksNear: (x: number, z: number, r: number) => [...valley.trunksNear(x, z, r), ...grove.filter((t) => Math.hypot(t.x - x, t.z - z) <= r + t.r)] };
    const lead = onwardPoints(wood, home, shot.close, 3)![0];
    expect(wood.trunksNear(lead.x, lead.z, 12)).toHaveLength(0);
    const d = Math.hypot(lead.x - c.x, lead.z - c.z);
    expect(d).toBeGreaterThanOrEqual(20 - 1e-6);
    expect((lead.x - c.x) * ux + (lead.z - c.z) * uz, 'still away from the camera').toBeGreaterThan(0);
  });

  it('prefers the side the camera came from when it is clear', () => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, quadruped, 'q', eye, { x: 0, z: 1 });
    const shot = arrivalShot(valley, home, eye);
    if (blocked(shot.close).length === 0 && blocked(arrivalView(home, eye)).length === 0) {
      const old = arrivalView(home, eye);
      expect(Math.atan2(shot.close.pos.z - home.center.z, shot.close.pos.x - home.center.x)).toBeCloseTo(Math.atan2(old.pos.z - home.center.z, old.pos.x - home.center.x), 6);
    }
  });

  it('still finds a valid home and a camera when no ground is open and every angle is blocked', () => {
    // a trunk 3 m from everywhere: nothing is open for 12 m, and every sight line passes trunks
    const crowded = { ...valley, trunksNear: (x: number, z: number, r: number) => (r >= 2.5 ? [{ x: x + 2.5, z, r: 0.3 }] : []) };
    const eye = eyeAt(meadow);
    const home = arrivalHome(crowded, quadruped, 'q', eye, { x: 0, z: 1 });
    expect(home.medium).toBe('land');
    expect(valley.isWater(home.center.x, home.center.z)).toBe(false);
    expect(slopeDeg(home.center.x, home.center.z)).toBeLessThan(25);
    expect(valley.inside(home.center.x, home.center.z, 30)).toBe(true);
    const shot = arrivalShot(crowded, home, eye);
    expect(Math.hypot(shot.close.pos.x - home.center.x, shot.close.pos.z - home.center.z)).toBeCloseTo(12, 5);
    expect(Number.isFinite(shot.wide.pos.x + shot.wide.pos.z)).toBe(true);
  });

  it('pushes in from the wide framing to the close one, eased, always looking at the home', () => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, quadruped, 'q', eye, { x: 0, z: 1 });
    const shot = arrivalShot(valley, home, eye);
    expect(pushView(shot, 0)).toEqual({ ...shot.wide, name: 'arrival' });
    expect(pushView(shot, 1)).toEqual({ ...shot.close, name: 'arrival' });
    const back = (s: number) => Math.hypot(pushView(shot, s).pos.x - home.center.x, pushView(shot, s).pos.z - home.center.z);
    let last = back(0);
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      expect(back(s)).toBeLessThanOrEqual(last + 1e-9);
      expect(pushView(shot, s).look).toEqual(shot.close.look);
      last = back(s);
    }
    expect(back(0.05) - back(0)).toBeGreaterThan(-0.1); // eased: it starts gently
    expect(pushView(shot, 2)).toEqual(pushView(shot, 1));
  });

  it.each([
    ['land', quadruped],
    ['water', trout],
    ['air', bird],
  ])('walks a %s family on together, 20–40 m away from the camera, valid for the medium', (_n, recipe) => {
    const eye = eyeAt(meadow);
    const home = arrivalHome(valley, recipe, 'x', eye, { x: 1, z: 0 });
    const shot = arrivalShot(valley, home, eye);
    const on = onwardPoints(valley, home, shot.close, 3)!;
    expect(on).toHaveLength(3);
    const c = home.center, ux = c.x - shot.close.pos.x, uz = c.z - shot.close.pos.z;
    const lead = on[0], d = Math.hypot(lead.x - c.x, lead.z - c.z);
    expect(d).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(d).toBeLessThanOrEqual(40 + 1e-6);
    expect((lead.x - c.x) * ux + (lead.z - c.z) * uz, 'away from the camera').toBeGreaterThan(0);
    for (const p of on) {
      expect(Math.hypot(p.x - lead.x, p.z - lead.z), 'together').toBeLessThan(5);
      expect(valley.inside(p.x, p.z, 10)).toBe(true);
      if (home.medium === 'water') expect(valley.waterDepthAt(p.x, p.z)).toBeGreaterThanOrEqual(0.5);
      else if (home.medium === 'land') expect(valley.isWater(p.x, p.z)).toBe(false);
    }
    // a walker's way there is dry
    if (home.medium === 'land') for (let s = 0; s <= 1; s += 0.05) expect(valley.isWater(c.x + (lead.x - c.x) * s, c.z + (lead.z - c.z) * s)).toBe(false);
  });
});
