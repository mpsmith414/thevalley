import { describe, expect, it } from 'vitest';
import { ActionController, type Habitat, type RigIntents } from '../../src/motion/actions';
import { stageHabitat } from '../../src/render/stage';
import { mulberry32 } from '../../src/util/rng';
import type { Vec3 } from '../../src/util/vec';

const place = {
  radius: 6,
  heightAt: () => 0,
  isWater: (x: number, z: number) => Math.hypot(x + 2.6, z - 2.2) < 1.4,
  pond: { x: -2.6, z: 2.2, r: 1.4 },
};

/** A controller on the lab stage; the habitat and the controller share one seeded rng, as in the lab. */
function make(rig: RigIntents, seed: number, opts: { shore?: boolean } = {}) {
  const rng = mulberry32(seed);
  return new ActionController(rig, stageHabitat(place, rng), rng, opts);
}

/** A rig that teleports to its target a little each frame. */
function fakeRig(kind: { swimmer?: boolean; canFly?: boolean } = {}) {
  const targets: Vec3[] = [];
  const rig: RigIntents & { target: Vec3 | null; targets: Vec3[] } = {
    position: { x: 0, z: 0 },
    target: null,
    targets,
    moveTo(t) {
      this.target = t;
      if (t) targets.push(t);
    },
    setSpeed() {},
    arrived() {
      return !this.target || Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z) < 0.3;
    },
    look: null, headDown: 0, sleep: 0, calling: 0, wantFly: false,
    canFly: !!kind.canFly, swimmer: !!kind.swimmer, floater: false,
  };
  const tick = (ctl: ActionController, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) {
      if (rig.target) {
        const dx = rig.target.x - rig.position.x, dz = rig.target.z - rig.position.z;
        const d = Math.hypot(dx, dz);
        const s = Math.min(1, 0.3 / Math.max(d, 1e-6));
        rig.position = { x: rig.position.x + dx * s, z: rig.position.z + dz * s };
      }
      ctl.update(0.1);
    }
  };
  return { rig, tick };
}

describe('ActionController', () => {
  it('lies down to sleep and stays asleep', () => {
    const { rig, tick } = fakeRig();
    const ctl = make(rig, 1);
    ctl.set('sleep');
    tick(ctl, 3);
    expect(rig.sleep).toBe(1);
    expect(rig.target).toBeNull();
    expect(ctl.current).toBe('sleep');
  });

  it('wanders only to dry land inside the stage', () => {
    const { rig, tick } = fakeRig();
    const ctl = make(rig, 2);
    ctl.set('wander');
    tick(ctl, 120);
    expect(rig.targets.length).toBeGreaterThan(5);
    for (const t of rig.targets) {
      expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(place.radius);
      expect(place.isWater(t.x, t.z)).toBe(false);
    }
  });

  it('keeps swimmers in the pond', () => {
    const { rig, tick } = fakeRig({ swimmer: true });
    rig.position = { x: -2.6, z: 2.2 };
    const ctl = make(rig, 3);
    ctl.set('wander');
    tick(ctl, 60);
    expect(rig.targets.length).toBeGreaterThan(3);
    for (const t of rig.targets) expect(place.isWater(t.x, t.z)).toBe(true);
  });

  it('takes fliers up for a few laps and back down', () => {
    const { rig, tick } = fakeRig({ canFly: true });
    const ctl = make(rig, 4);
    ctl.set('wander');
    let flew = false;
    for (let i = 0; i < 600; i++) {
      tick(ctl, 0.1);
      flew ||= rig.wantFly;
    }
    expect(flew).toBe(true);
  });

  it('grazes with its head down, then goes back to idle', () => {
    const { rig, tick } = fakeRig();
    const ctl = make(rig, 5);
    ctl.set('eat');
    tick(ctl, 1);
    expect(rig.headDown).toBe(1);
    tick(ctl, 6);
    expect(ctl.current).toBe('idle');
    expect(rig.headDown).toBe(0);
  });

  it('drinks at the edge of the pond', () => {
    const { rig, tick } = fakeRig();
    rig.position = { x: 2, z: 0 };
    const ctl = make(rig, 6);
    ctl.set('drink');
    const bank = rig.target!;
    expect(Math.hypot(bank.x + 2.6, bank.z - 2.2)).toBeCloseTo(1.75, 5);
    tick(ctl, 4); // ~2 s to walk there, then 5 s of drinking
    expect(rig.headDown).toBe(1);
    tick(ctl, 6);
    expect(ctl.current).toBe('idle');
  });

  it('wanders along the pond edge when it is a shore animal', () => {
    const { rig, tick } = fakeRig();
    const ctl = make(rig, 7, { shore: true });
    ctl.set('wander');
    tick(ctl, 120);
    expect(rig.targets.length).toBeGreaterThan(5);
    for (const t of rig.targets) {
      const d = Math.hypot(t.x + 2.6, t.z - 2.2);
      expect(d).toBeGreaterThan(1.4);
      expect(d).toBeLessThanOrEqual(1.4 + 1);
    }
  });

  it('stays put when there is no bank to drink at', () => {
    const { rig } = fakeRig();
    const habitat: Habitat = {
      heightAt: () => 0, isWater: () => false, randomSpot: () => ({ x: 0, y: 0, z: 0 }), nearestBank: () => null, clamp: (p) => p,
    };
    const ctl = new ActionController(rig, habitat, mulberry32(8));
    ctl.set('drink');
    expect(ctl.current).toBe('idle');
    expect(rig.target).toBeNull();
  });
});
