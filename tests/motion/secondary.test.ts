import { Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { findChains } from '../../src/motion/limbs';
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
  }, 30_000);

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
  }, 30_000);
});

describe('ear poses on real ears', () => {
  /**
   * Each ear's tip (the end of its chain's last bone) in the head bone's frame (+z forward, +y up) after two seconds with
   * the ears held in a pose (asleep or not). Fresh rigs, same frames: the random twitches match, only the pose differs.
   */
  const tips = (id: string) => {
    const recipe = CAST.find((c) => c.recipe.id === id)!.recipe, body = buildBody(recipe, [2]);
    const head = body.skeleton.bones.findIndex((b) => b.role === 'head');
    const ears = findChains(body.skeleton).filter((c) => c.kind === 'ear').map((c) => c.chain[c.chain.length - 1]);
    return (pose: 'rest' | 'alert' | 'back', sleep = 0) => {
      const obj = createCreatureObject(body, recipe, 'low'), rig = new CreatureRig(obj, body, recipe, flat);
      rig.ears = pose;
      rig.sleep = rig.sleepNow = sleep; // already asleep: the pose, not the easing into it, is measured
      for (let i = 0; i < 60; i++) rig.update(1 / 30);
      return ears.map((k) => {
        const d = body.skeleton.bones[k], tip = new Vector3(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z);
        return obj.bones[head].worldToLocal(obj.bones[k].localToWorld(tip));
      });
    };
  };

  // measured (head frame, metres; rest → back → alert → asleep) fox z 0.018 → −0.031 → 0.044 → −0.014, rabbit −0.013 →
  // −0.067 → 0.018 → −0.050, wolf 0.032 → −0.036 → 0.066 → −0.012 (before the fix: back +0.073, alert −0.006 for the fox)
  for (const id of ['fox', 'rabbit', 'wolf'])
    it(`${id}: laid back, the ear tips go back; pricked up, forward; asleep, they droop back and down`, () => {
      const at = tips(id), rest = at('rest'), back = at('back'), alert = at('alert'), asleep = at('rest', 1);
      expect(rest).toHaveLength(2);
      rest.forEach((r, e) => {
        expect(back[e].z - r.z, `back, ear ${e}`).toBeLessThan(-0.02);
        expect(alert[e].z - r.z, `alert, ear ${e}`).toBeGreaterThan(0.01);
        expect(asleep[e].z - r.z, `asleep, ear ${e}`).toBeLessThan(-0.01);
        expect(asleep[e].y, `asleep, ear ${e}`).toBeLessThan(r.y);
      });
    }, 30_000);
});
