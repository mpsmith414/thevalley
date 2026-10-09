import { Quaternion } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CreatureRig } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import { quadruped } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };

describe('secondary motion and the jaw', () => {
  it('keeps the jaw shut at rest while calling (actions open it), and the muzzle still', () => {
    const body = buildBody(quadruped, [2]), obj = createCreatureObject(body, quadruped, 'low');
    expect(obj.jaw).not.toBeNull();
    const rig = new CreatureRig(obj, body, quadruped, flat);
    rig.calling = 1;
    for (let i = 0; i < 30; i++) rig.update(1 / 30);
    expect(rig.callNow).toBeGreaterThan(0.9);
    expect(obj.jaw!.bone.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
    expect(obj.jaw!.bone.position.distanceTo(obj.jaw!.shut)).toBe(0);
  });
});
