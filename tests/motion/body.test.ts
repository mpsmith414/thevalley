import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { birdHeadBob, boundFlex, gaitBob, girdleRoll, headNod, isBirdWalker, spineBend, stabiliseShare, weightShift } from '../../src/motion/body';
import { findChains } from '../../src/motion/limbs';
import { CreatureRig } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import { biped, bird, blob, quadruped, snake, makeRecipe, P } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const cast = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe;
const deer = cast('deer');

describe('body mechanics helpers', () => {
  it('bends the spine into the turn, capped', () => {
    expect(spineBend(1, 1)).toBeGreaterThan(0);
    expect(spineBend(-1, 1)).toBeLessThan(0);
    expect(Math.abs(spineBend(50, 5))).toBeLessThanOrEqual(0.35);
    expect(spineBend(0, 2)).toBe(0);
  });
  it('drops the swinging side and is level in stance', () => {
    expect(girdleRoll(1, true, 0.5, 0.05)).toBeCloseTo(-0.05);
    expect(girdleRoll(-1, true, 0.5, 0.05)).toBeCloseTo(0.05);
    expect(girdleRoll(1, false, 0.5, 0.05)).toBe(0);
  });
  it('shifts weight towards the stance side, less when fast', () => {
    const st = [{ side: 1, down: true }, { side: -1, down: false }];
    expect(weightShift(st, 0.2, 0.45, 0)).toBeGreaterThan(0);
    expect(weightShift(st, 0.2, 0.45, 0.5)).toBe(0);
    expect(weightShift([], 0, 0.45, 0)).toBe(0);
  });
  it('bobs within its amplitude and flexes both ways', () => {
    for (let s = 0; s <= 1; s += 0.1) expect(Math.abs(gaitBob([{ swing: false, s }, { swing: true, s }], 0.01))).toBeLessThanOrEqual(0.01 + 1e-9);
    const f = Array.from({ length: 20 }, (_, i) => boundFlex(i / 20, 0.1));
    expect(Math.max(...f)).toBeGreaterThan(0.05);
    expect(Math.min(...f)).toBeLessThan(-0.05);
  });
  it("holds a bird's head still for most of a step, then thrusts it forward", () => {
    const a = 0.02;
    expect(birdHeadBob(0, a)).toBeCloseTo(a, 12);
    const hold = Array.from({ length: 80 }, (_, i) => birdHeadBob(i / 100, a));
    hold.slice(1).forEach((v, i) => expect(v).toBeLessThan(hold[i]));
    const thrust = Array.from({ length: 20 }, (_, i) => birdHeadBob(0.8 + i / 100, a));
    thrust.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(thrust[i]));
    // continuous where the hold ends and where the next step begins
    expect(Math.abs(birdHeadBob(0.8 - 1e-9, a) - birdHeadBob(0.8, a))).toBeLessThan(1e-6);
    expect(Math.abs(birdHeadBob(1 - 1e-9, a) - birdHeadBob(0, a))).toBeLessThan(1e-6);
    expect(birdHeadBob(0.8, a)).toBeCloseTo(-a, 12);
  });
  it('nods just after a front foot lands, less when faster, never up', () => {
    expect(headNod([], 0.1, 0)).toBe(0);
    // a walk's front pair (duty 0.7), touching down at cycle phases 0.25 and 0.75
    const duty = 0.7, offsets = [0.25, 0.75];
    const legAt = (q: number) => (q < duty ? { swing: false, s: q / duty } : { swing: true, s: (q - duty) / (1 - duty) });
    const qs = Array.from({ length: 400 }, (_, i) => i / 400);
    const nods = qs.map((q) => headNod(offsets.map((o) => legAt((q - o + 1) % 1)), 0.1, 0));
    nods.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    const peak = Math.max(...nods), at = qs[nods.indexOf(peak)];
    expect(peak).toBeGreaterThan(0.05);
    // the peak comes just after a touchdown (within 0.15 of the cycle)
    const after = Math.min(...offsets.map((o) => (at - o + 1) % 1));
    expect(after).toBeLessThanOrEqual(0.15);
    expect(after).toBeGreaterThan(0);
    const slow = headNod([{ swing: false, s: 0.15 }], 0.1, 0), fast = headNod([{ swing: false, s: 0.15 }], 0.1, 0.5);
    expect(fast).toBeLessThan(slow);
    expect(headNod([{ swing: false, s: 0.15 }], 0.1, 0.9)).toBe(0);
  });
  it('steadies the head more the faster it goes', () => {
    expect(stabiliseShare(0)).toBeCloseTo(0.7, 12);
    expect(stabiliseShare(1)).toBeCloseTo(0.85, 12);
    expect(stabiliseShare(0.5)).toBeGreaterThan(0.7);
    expect(stabiliseShare(0.5)).toBeLessThan(0.85);
  });
  it('knows a feathered two-legged walker from the rest', () => {
    expect(isBirdWalker(2, cast('duck'))).toBe(true);
    expect(isBirdWalker(2, cast('hawk'))).toBe(true);
    expect(isBirdWalker(4, cast('deer'))).toBe(false);
    expect(isBirdWalker(2, biped)).toBe(false); // no feathers, no wings
    expect(isBirdWalker(2, bird)).toBe(false); // wings, but bare skin
  });
});

describe('chains of legged bodies', () => {
  it("turns the rabbit's head as a neck, with no snake spine", () => {
    const sk = buildBody(cast('rabbit'), [2]).skeleton, head = sk.bones.findIndex((b) => b.role === 'head');
    const chains = findChains(sk, true);
    expect(chains.filter((c) => c.kind === 'spine')).toHaveLength(0);
    expect(chains.some((c) => c.kind === 'neck' && c.chain.includes(head))).toBe(true);
  }, 30_000);
});

describe('body mechanics in the rig', () => {
  const make = (r: typeof deer) => {
    const body = buildBody(r, [2]), obj = createCreatureObject(body, r, 'low');
    return new CreatureRig(obj, body, r, flat);
  };
  it("rolls the deer's hips a few degrees while walking, both ways", () => {
    const rig = make(deer);
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    const rolls: number[] = [];
    for (let i = 0; i < 240; i++) { rig.update(1 / 60); rolls.push(rig.mech.pose.hipsRoll); }
    const tail = rolls.slice(120);
    expect(Math.max(...tail)).toBeGreaterThan(0.015);
    expect(Math.min(...tail)).toBeLessThan(-0.015);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.1);
  }, 30_000);
  it('no longer slithers a legged torso', () => {
    const rig = make(deer);
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    for (let i = 0; i < 120; i++) rig.update(1 / 60);
    // walking straight: the torso bones' yaw stays small (no snake wave)
    for (const k of rig.mech.torso.slice(1)) expect(Math.abs(rig.obj.bones[k].rotation.y)).toBeLessThan(0.05);
  }, 30_000);
  it('stays finite for a blob, a snake and a one-legged body', () => {
    const oneLeg = makeRecipe('oneleg', [P('torso', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1), P('leg', 'torso', 'leg', 0.5, [0, -1, 0], 0.2, 0.03, 0.02)]);
    for (const r of [blob, snake, oneLeg, quadruped]) {
      const rig = make(r);
      rig.moveTo({ x: 3, y: 0, z: 5 });
      rig.setSpeed(0.6);
      for (let i = 0; i < 120; i++) rig.update(1 / 60);
      expect(Number.isFinite(rig.obj.root.position.x + rig.obj.root.position.y + rig.obj.root.rotation.x + rig.obj.root.rotation.z)).toBe(true);
      rig.obj.bones.forEach((b, i) => {
        expect([...b.quaternion.toArray(), ...b.position.toArray()].every(Number.isFinite), `${r.id} bone ${i}`).toBe(true);
      });
    }
  }, 30_000);
  it('holds every pose bit for bit while paused (R17)', () => {
    // driven, as the valley pauses it (a self-steering rig pauses too: swim.test.ts pins one turning)
    const rig = make(deer), speed = 0.5, turnRate = 0.8, dt = 1 / 60;
    let x = 0, z = 0, yaw = 0;
    for (let i = 0; i < 90; i++) {
      // a curving walk, so the spine is bent too
      yaw += turnRate * dt;
      x += Math.sin(yaw) * speed * dt;
      z += Math.cos(yaw) * speed * dt;
      rig.drive({ x, z, yaw, speed, turnRate, altitude: 0, flying: false });
      rig.update(dt);
    }
    const snap = () => ({
      root: [...rig.obj.root.position.toArray(), ...rig.obj.root.quaternion.toArray()],
      pose: { ...rig.mech.pose },
      bones: rig.obj.bones.map((b) => [...b.quaternion.toArray(), ...b.position.toArray(), ...b.scale.toArray()]),
    });
    const before = snap();
    expect(Math.abs(before.pose.hipsRoll) + Math.abs(before.pose.bend)).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) rig.update(0);
    expect(snap()).toStrictEqual(before);
  }, 30_000);
  it('back in view while paused, shows the gait it has now, not the one it had when it went out of view', () => {
    // last seen galloping; out of view it stops (only driven, as a stowed body is); back in view with the valley paused,
    // as the residents bring it back: feet unplanted, a fresh drive, one update with no time. It stands as a deer that
    // stood all along does, with nothing of the gallop held in the gait's blend.
    const back = (gallop: boolean) => {
      const rig = make(deer), dt = 1 / 60, speed = gallop ? 0.95 * rig.traits.topSpeed : 0;
      let z = 0;
      for (let i = 0; i < 120; i++) {
        z += speed * dt;
        rig.drive({ x: 0, z, yaw: 0, speed, turnRate: 0, altitude: 0, flying: false });
        rig.update(dt);
      }
      if (gallop) expect(rig.gait).toBe('gallop');
      const still = { x: 0, z: z + 3, yaw: 0, speed: 0, turnRate: 0, altitude: 0, flying: false };
      rig.drive(still);
      rig.legs.forEach((l) => (l.planted = null));
      rig.drive(still, true);
      rig.update(0);
      return rig.mech.pose;
    };
    const shown = back(true), stood = back(false);
    for (const k of ['pitch', 'flex', 'bob', 'roll', 'bend', 'hipsRoll', 'shouldersRoll', 'hipsYaw'] as const) {
      expect(Math.abs(shown[k] - stood[k]), k).toBeLessThan(1e-3);
    }
  }, 30_000);
});
