import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { bankAngle, foldDirection, restTilt } from '../../src/motion/body';
import { findLimbs } from '../../src/motion/limbs';
import { CreatureRig } from '../../src/motion/rig';
import type { Recipe } from '../../src/recipe/schema';
import { createCreatureObject } from '../../src/render/creature';
import { bird } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const DT = 1 / 60;
const hawk = CAST.find((c) => c.recipe.id === 'hawk')!.recipe;

const make = (recipe: Recipe) => {
  const body = buildBody(recipe, [2]), obj = createCreatureObject(body, recipe, 'low');
  return { body, obj, rig: new CreatureRig(obj, body, recipe, flat) };
};
const run = (rig: CreatureRig, frames: number, each?: (i: number) => void) => {
  for (let i = 0; i < frames; i++) {
    rig.update(DT);
    each?.(i);
  }
};
/** A bone's point (creature-space offset from its start, rest frame) in the world. */
const worldOf = (rig: CreatureRig, k: number, p: { x: number; y: number; z: number }) => rig.obj.bones[k].localToWorld(new Vector3(p.x, p.y, p.z));
const along = (rig: CreatureRig, k: number) => {
  const b = rig.body.skeleton.bones[k];
  return worldOf(rig, k, { x: b.end.x - b.start.x, y: b.end.y - b.start.y, z: b.end.z - b.start.z }).sub(worldOf(rig, k, { x: 0, y: 0, z: 0 }));
};
/** Bone 0's world elevation (radians, + = nose up). */
const elevation = (rig: CreatureRig) => {
  const d = along(rig, 0);
  return Math.atan2(d.y, Math.hypot(d.x, d.z));
};
/** Fly (taking off first if on the ground) towards a target 100 m ahead, 3 m up, for `seconds`. */
const cruise = (rig: CreatureRig, seconds: number, each?: (i: number) => void) => {
  rig.cruise = 3;
  rig.wantFly = true;
  rig.moveTo({ x: 0, y: 0, z: 100 });
  rig.setSpeed(0.6);
  run(rig, seconds * 60, each);
};

describe('the flight helpers', () => {
  it('folds a wing along the back, a little out to its side and up off the back', () => {
    const level = foldDirection({ x: 0, y: 0, z: 1 }, 1);
    expect(level.z).toBeLessThan(-0.95);
    expect(level.x).toBeGreaterThan(0);
    expect(level.y).toBeGreaterThan(0);
    expect(Math.hypot(level.x, level.y, level.z)).toBeCloseTo(1, 12);
    expect(foldDirection({ x: 0, y: 0, z: 1 }, -1).x).toBeCloseTo(-level.x, 12);
    // a nose-up body: the fold runs down its back (up⊥ is the part of +y across the body)
    const d = { x: 0, y: Math.sin(0.5), z: Math.cos(0.5) }, f = foldDirection(d, 1);
    expect(f.x * d.x + f.y * d.y + f.z * d.z).toBeLessThan(-0.97);
    expect(f.y).toBeLessThan(0);
  });

  it('measures the rest tilt of the body and banks a coordinated turn, capped', () => {
    expect(restTilt(buildBody(hawk, [2]).skeleton)).toBeCloseTo(Math.atan2(0.5, 1), 2);
    expect(bankAngle(3, 1)).toBeCloseTo(-0.36, 12);
    expect(bankAngle(3, -1)).toBeCloseTo(0.36, 12);
    expect(bankAngle(10, 5)).toBe(-0.7);
    expect(bankAngle(10, -5)).toBe(0.7);
  });
});

describe('fliers', () => {
  for (const [name, recipe] of [['hawk', hawk], ['bird', bird]] as const)
    it(`folds a perched ${name}'s wings along its back`, () => {
      const { body, rig } = make(recipe);
      run(rig, 120);
      const back = along(rig, 0).negate().normalize();
      const wings = findLimbs(body.skeleton).filter((l) => l.kind === 'wing');
      expect(wings).toHaveLength(2);
      for (const w of wings) {
        const last = w.chain[w.chain.length - 1], b = body.skeleton.bones[last];
        const tip = worldOf(rig, last, { x: b.end.x - b.start.x, y: b.end.y - b.start.y, z: b.end.z - b.start.z });
        const dir = tip.sub(worldOf(rig, w.chain[0], { x: 0, y: 0, z: 0 })).normalize();
        expect(dir.angleTo(back), `wing ${w.side}`).toBeLessThan((25 * Math.PI) / 180);
      }
    }, 30_000);

  it('flies level: the body holds within 8° of level while cruising, and the head keeps the attitude it has perched', () => {
    const { body, rig } = make(hawk);
    const head = body.skeleton.bones.findIndex((b) => b.role === 'head');
    const headEl = () => {
      const d = along(rig, head);
      return Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    run(rig, 30);
    const perched = headEl(), els: number[] = [], heads: number[] = [];
    cruise(rig, 6, (i) => i >= 4 * 60 && (els.push(elevation(rig)), heads.push(headEl())));
    expect(rig.flying).toBe(true);
    expect(rig.phaseOfFlight).toBe('air');
    for (const e of els) expect(Math.abs(e)).toBeLessThan((8 * Math.PI) / 180);
    for (const h of heads) expect(Math.abs(h - perched)).toBeLessThan((6 * Math.PI) / 180);
  }, 30_000);

  it('banks into a turn: a left turn rolls the left side down', () => {
    const { rig } = make(hawk);
    cruise(rig, 4);
    rig.moveTo({ x: rig.position.x + 30, y: 0, z: rig.position.z });
    let low = 0;
    run(rig, 30, () => {
      expect(rig.turnRate).toBeGreaterThan(0);
      low = Math.min(low, rig.obj.root.rotation.z);
    });
    expect(low).toBeLessThan(-0.1);
    expect(low).toBeGreaterThanOrEqual(-0.7);
  }, 30_000);

  it('takes off with a crouch, then rises', () => {
    const { rig } = make(hawk);
    run(rig, 60);
    const rest = rig.obj.root.position.y;
    rig.cruise = 2;
    rig.wantFly = true;
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.6);
    let low = Infinity;
    const phases = new Set<string>();
    run(rig, 12, () => ((low = Math.min(low, rig.obj.root.position.y)), phases.add(rig.phaseOfFlight)));
    expect(phases).toContain('crouch');
    expect(rig.flying).toBe(false); // still crouched (0.2 s)
    expect(low).toBeLessThan(rest - 0.1 * rig.legLength);
    const alts: number[] = [];
    run(rig, 30, () => alts.push(rig.altitude));
    expect(rig.flying).toBe(true);
    expect(alts[alts.length - 1]).toBeGreaterThan(0.3 * rig.legLength);
    for (let i = 1; i < alts.length; i++) expect(alts[i]).toBeGreaterThanOrEqual(alts[i - 1]);
  }, 30_000);

  it('flares to land, nose up, and ends on its feet', () => {
    const { rig } = make(hawk);
    cruise(rig, 5);
    rig.wantFly = false;
    let flared = false, phases = new Set<string>(), frames = 0;
    while (rig.flying && frames < 6 * 60) {
      rig.update(DT);
      frames++;
      phases.add(rig.phaseOfFlight);
      if (rig.altitude < 0.5 * rig.bodyLength && rig.obj.root.rotation.x < -0.2) flared = true;
    }
    expect(phases).toContain('flare');
    expect(flared).toBe(true);
    expect(rig.flying).toBe(false);
    expect(rig.phaseOfFlight).toBe('ground');
    // the settle kicks on touchdown
    rig.update(DT);
    expect(rig.settle.pitch).toBeGreaterThan(0);
  }, 30_000);

  it('a driven hawk flares on the simulation’s descent, legs forward and talons near level, and goes exactly where it is told', () => {
    const { body, rig } = make(hawk);
    const leg = findLimbs(body.skeleton).find((l) => l.kind === 'leg')!, thigh = leg.chain[0], foot = leg.chain[leg.chain.length - 1];
    expect(body.skeleton.bones[foot].role).toBe('foot');
    /** A bone's world direction: how far forward of straight down it reaches (radians, + = forward), and its elevation. */
    const reachOf = (k: number) => {
      const d = along(rig, k);
      return Math.atan2(d.z, -d.y);
    };
    const talonTilt = () => {
      const d = along(rig, foot);
      return Math.atan2(d.y, Math.hypot(d.x, d.z)); // + = toes up
    };
    // the simulation's landing: down at 1.2 × the height (at most 1.2 m/s), on the ground below 3 cm
    let alt = 3, x = 0, z = 0, flying = true, flared = false, reach = -Infinity, talons = NaN;
    const speed = 2.5;
    for (let i = 0; i < 8 * 60 && flying; i++) {
      alt += Math.max(-1.2, -1.2 * alt) * DT;
      if (alt < 0.03) (alt = 0), (flying = false);
      z += speed * DT;
      const p = { x, z, yaw: 0, speed, turnRate: 0, altitude: alt, flying };
      rig.drive(p);
      rig.update(DT);
      expect(rig.position.x).toBe(x);
      expect(rig.position.z).toBe(z);
      expect(rig.altitude).toBe(alt);
      expect(rig.flying).toBe(flying);
      if (flying && alt < 0.5 * rig.bodyLength && rig.obj.root.rotation.x < -0.2) flared = true;
      if (rig.phaseOfFlight === 'flare') (reach = Math.max(reach, reachOf(thigh))), (talons = talonTilt());
    }
    expect(flying).toBe(false);
    expect(flared).toBe(true);
    // the thigh reaches forward of straight down in the world, and at the last moment of the flare the toes are near level
    expect(reach).toBeGreaterThan(0.25);
    expect(Math.abs(talons)).toBeLessThan((20 * Math.PI) / 180);
    expect(rig.phaseOfFlight).toBe('ground');
  }, 30_000);

  it('a driven hawk taking off: never crouches or jumps, but beats hard', () => {
    const { rig } = make(hawk);
    const pose = (x: number, z: number, alt: number, flying: boolean) => ({ x, z, yaw: 0.3, speed: 1, turnRate: 0, altitude: alt, flying });
    rig.drive(pose(0, 0, 0, false));
    run(rig, 30);
    let alt = 0, x = 0, z = 0;
    const phases = new Set<string>();
    for (let i = 0; i < 60; i++) {
      alt += 1.5 * DT;
      x += Math.sin(0.3) * DT;
      z += Math.cos(0.3) * DT;
      rig.drive(pose(x, z, alt, true));
      rig.update(DT);
      phases.add(rig.phaseOfFlight);
      expect(rig.altitude).toBe(alt);
      expect(rig.position.x).toBe(x);
      expect(rig.position.z).toBe(z);
      expect(rig.flying).toBe(true);
      if (i === 0) expect(rig.strokes).toBeGreaterThan(0.4);
    }
    expect(phases).not.toContain('crouch');
    expect(rig.strokes).toBe(0);
  }, 30_000);

  describe('pause holds a take-off and a landing bit for bit (R17)', () => {
    const snap = (rig: CreatureRig) => [
      ...rig.obj.root.position.toArray(), ...rig.obj.root.quaternion.toArray(), rig.altitude, rig.settle.pitch, rig.settle.height,
      ...rig.obj.bones.flatMap((b) => [...b.quaternion.toArray(), ...b.position.toArray(), ...b.scale.toArray()]),
    ];
    it('a self-steering hawk', () => {
      const go = (pauseAt: number[]) => {
        const { rig } = make(hawk), shots: number[][] = [], seen: string[] = [];
        for (let i = 0; i < 9 * 60; i++) {
          if (i === 30) {
            rig.cruise = 2;
            rig.wantFly = true;
            rig.moveTo({ x: 0, y: 0, z: 100 });
            rig.setSpeed(0.6);
          }
          if (i === 4 * 60) rig.wantFly = false;
          rig.update(DT);
          shots.push(snap(rig));
          seen[i] = rig.phaseOfFlight;
          if (pauseAt.includes(i)) {
            for (let k = 0; k < 100; k++) rig.update(0);
            expect(snap(rig)).toStrictEqual(shots[i]);
          }
        }
        return { shots, seen };
      };
      const plain = go([]);
      const crouch = plain.seen.indexOf('crouch'), air = plain.seen.indexOf('air'), flare = plain.seen.indexOf('flare');
      const down = plain.seen.indexOf('ground', flare);
      expect(crouch).toBeGreaterThan(0);
      expect(flare).toBeGreaterThan(air);
      expect(down).toBeGreaterThan(flare);
      // mid-crouch, in the strong strokes, mid-flare and in the touchdown's settle
      expect(go([crouch + 5, air + 10, flare + 15, down + 4]).shots).toStrictEqual(plain.shots);
    }, 60_000);

    it('a driven hawk', () => {
      const go = (pauseAt: number[]) => {
        const { rig } = make(hawk), shots: number[][] = [], seen: string[] = [];
        let alt = 0, z = 0, flying = false, speed = 0;
        for (let i = 0; i < 9 * 60; i++) {
          // the simulation's flight: up to 2.5 m, then down to land
          if (i === 30) flying = true;
          if (flying) {
            const cruise = i < 4 * 60 ? 2.5 : 0;
            alt += Math.max(-1.2, Math.min(1.5, (cruise - alt) * 1.2)) * DT;
            if (cruise === 0 && alt < 0.03) (alt = 0), (flying = false);
            speed = Math.min(2.5, speed + 3 * DT);
          } else speed = Math.max(0, speed - 3 * DT);
          z += speed * DT;
          rig.drive({ x: 0, z, yaw: 0, speed, turnRate: 0.2, altitude: alt, flying });
          rig.update(DT);
          shots.push(snap(rig));
          seen[i] = rig.phaseOfFlight;
          if (pauseAt.includes(i)) {
            for (let k = 0; k < 100; k++) rig.update(0);
            expect(snap(rig)).toStrictEqual(shots[i]);
          }
        }
        return { shots, seen };
      };
      const plain = go([]);
      const air = plain.seen.indexOf('air'), flare = plain.seen.indexOf('flare'), down = plain.seen.indexOf('ground', flare);
      expect(flare).toBeGreaterThan(air);
      expect(down).toBeGreaterThan(flare);
      expect(go([air + 10, flare + 15, down + 4]).shots).toStrictEqual(plain.shots);
    }, 60_000);
  });
});
