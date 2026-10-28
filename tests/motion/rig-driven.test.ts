import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CreatureRig, type DrivenPose } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import type { Vec3 } from '../../src/util/vec';
import { quadruped } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const DT = 1 / 60;

describe('a driven rig', () => {
  const setup = () => {
    const body = buildBody(quadruped, [2]);
    return new CreatureRig(createCreatureObject(body, quadruped, 'low'), body, quadruped, flat);
  };
  const pose = (x: number, z: number, yaw: number, speed = 0): DrivenPose => ({ x, z, yaw, speed, turnRate: 0, altitude: 0, flying: false });

  it('goes exactly where it is told and ignores its own target', () => {
    const rig = setup();
    rig.moveTo({ x: 20, y: 0, z: 20 });
    rig.setSpeed(1);
    const p = pose(1.5, -2.25, 0.7, 1);
    rig.drive(p);
    expect(rig.driven).toBe(true);
    rig.update(DT);
    expect(rig.position.x).toBe(p.x);
    expect(rig.position.z).toBe(p.z);
    expect(rig.yaw).toBe(p.yaw);
    expect(rig.speed).toBe(p.speed);
    rig.update(DT); // no new pose: it stays put
    expect(rig.position.x).toBe(p.x);
    expect(rig.position.z).toBe(p.z);
    expect(rig.obj.root.position.x).toBe(p.x);
  }, 30_000);

  it('walks on planted feet that never slide while in stance', () => {
    const rig = setup(), speed = 1.2, yaw = 0.4;
    let x = 0, z = 0;
    const frame = () => {
      x += Math.sin(yaw) * speed * DT;
      z += Math.cos(yaw) * speed * DT;
      rig.drive(pose(x, z, yaw, speed));
      rig.update(DT);
    };
    for (let i = 0; i < 30; i++) frame(); // get into its stride
    expect(rig.stepping).toBeGreaterThan(0.8);
    let before: (Vec3 | null)[] = rig.legs.map((l) => (l.planted ? { ...l.planted } : null));
    let held = 0, swung = 0;
    for (let i = 0; i < 60; i++) {
      frame();
      rig.legs.forEach((l, k) => {
        if (l.swinging) swung++;
        const was = before[k];
        if (!was || !l.planted) return;
        expect(l.planted.x).toBe(was.x);
        expect(l.planted.y).toBe(was.y);
        expect(l.planted.z).toBe(was.z);
        held++;
      });
      before = rig.legs.map((l) => (l.planted ? { ...l.planted } : null));
    }
    expect(held).toBeGreaterThan(100); // most leg-frames are stance
    expect(swung).toBeGreaterThan(20); // and it really is stepping
    expect(Math.hypot(rig.position.x - x, rig.position.z - z)).toBe(0);
  }, 30_000);

  it('lands from a driven flight with its feet ready to plant', () => {
    const rig = setup();
    rig.drive({ ...pose(0, 0, 0, 2), altitude: 1, flying: true });
    rig.update(DT);
    expect(rig.flying).toBe(true);
    rig.drive(pose(0.03, 0, 0, 1));
    rig.update(DT);
    expect(rig.flying).toBe(false);
    expect(rig.altitude).toBe(0);
  }, 30_000);
});
