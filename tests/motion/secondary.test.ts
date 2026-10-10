import { Quaternion } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CreatureRig } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import { quadruped } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };

describe('secondary motion and the jaw', () => {
  const setup = () => {
    const body = buildBody(quadruped, [2]), obj = createCreatureObject(body, quadruped, 'low');
    return { obj, rig: new CreatureRig(obj, body, quadruped, flat) };
  };
  const run = (rig: CreatureRig, frames: number) => {
    for (let i = 0; i < frames; i++) rig.update(1 / 30);
  };

  it('opens the jaw to call, eased, and shuts it again; the jaw bone never leaves its raised rest position', () => {
    const { obj, rig } = setup();
    expect(obj.jaw).not.toBeNull();
    const angle = () => obj.jaw!.bone.quaternion.angleTo(new Quaternion());
    run(rig, 4);
    expect(angle()).toBeLessThan(1e-9);
    rig.calling = 1;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 30);
      seen.push(angle());
    }
    expect(rig.callNow).toBeGreaterThan(0.9);
    expect(seen[0]).toBeLessThan(0.2); // eased in, not snapped
    expect(Math.max(...seen.slice(1).map((a, i) => a - seen[i]))).toBeLessThan(0.1);
    expect(angle()).toBeGreaterThan(0.24);
    expect(angle()).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(obj.jaw!.bone.position.distanceTo(obj.jaw!.shut)).toBe(0);
    rig.calling = 0;
    run(rig, 40);
    expect(angle()).toBeLessThan(0.01);
  });

  it('chews, yawns and blinks on command', () => {
    const { obj, rig } = setup();
    const angle = () => obj.jaw!.bone.quaternion.angleTo(new Quaternion());
    rig.secondary.trigger('yawn');
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 30);
      peak = Math.max(peak, angle());
    }
    expect(peak).toBeGreaterThan(0.25);
    rig.secondary.trigger('chew');
    run(rig, 60);
    expect(rig.mouth).toBe('chew');
    expect(rig.headDown).toBe(1);
    run(rig, 120);
    expect(rig.mouth).toBe('shut');
    expect(rig.headDown).toBe(0);
    rig.secondary.trigger('back');
    run(rig, 3);
    expect(rig.ears).toBe('back');
    run(rig, 100);
    expect(rig.ears).toBe('rest');
    // a new command lets go of the one before
    rig.secondary.trigger('chew');
    run(rig, 3);
    rig.secondary.trigger('alert');
    run(rig, 3);
    expect(rig.mouth).toBe('shut');
    expect(rig.headDown).toBe(0);
    expect(rig.ears).toBe('alert');
  });
});
