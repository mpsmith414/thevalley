import { describe, expect, it } from 'vitest';
import { ActionController, type Place, type RigIntents } from '../../src/motion/actions';
import { mulberry32 } from '../../src/util/rng';
import type { Vec3 } from '../../src/util/vec';

const place: Place = {
  radius: 6,
  heightAt: () => 0,
  isWater: (x, z) => Math.hypot(x + 2.6, z - 2.2) < 1.4,
  pond: { x: -2.6, z: 2.2, r: 1.4 },
};

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
    const ctl = new ActionController(rig, place, mulberry32(1));
    ctl.set('sleep');
    tick(ctl, 3);
    expect(rig.sleep).toBe(1);
    expect(rig.target).toBeNull();
    expect(ctl.current).toBe('sleep');
  });

  it('wanders only to dry land inside the stage', () => {
    const { rig, tick } = fakeRig();
    const ctl = new ActionController(rig, place, mulberry32(2));
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
    const ctl = new ActionController(rig, place, mulberry32(3));
    ctl.set('wander');
    tick(ctl, 60);
    expect(rig.targets.length).toBeGreaterThan(3);
    for (const t of rig.targets) expect(place.isWater(t.x, t.z)).toBe(true);
  });

  it('takes fliers up for a few laps and back down', () => {
    const { rig, tick } = fakeRig({ canFly: true });
    const ctl = new ActionController(rig, place, mulberry32(4));
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
    const ctl = new ActionController(rig, place, mulberry32(5));
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
    const ctl = new ActionController(rig, place, mulberry32(6));
    ctl.set('drink');
    const bank = rig.target!;
    expect(Math.hypot(bank.x + 2.6, bank.z - 2.2)).toBeCloseTo(1.75, 5);
    tick(ctl, 4); // ~2 s to walk there, then 5 s of drinking
    expect(rig.headDown).toBe(1);
    tick(ctl, 6);
    expect(ctl.current).toBe('idle');
  });
});
