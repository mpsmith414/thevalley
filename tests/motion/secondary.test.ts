import { Euler, Quaternion, Vector3, type Bone } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { birdHeadBob } from '../../src/motion/body';
import { STRIDE } from '../../src/motion/gait';
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

describe('steady heads, bird head bobs and follow-through', () => {
  const make = (id: string) => {
    const recipe = CAST.find((c) => c.recipe.id === id)!.recipe, body = buildBody(recipe, [2]);
    const obj = createCreatureObject(body, recipe, 'low');
    return { recipe, body, obj, rig: new CreatureRig(obj, body, recipe, flat) };
  };
  const role = (body: ReturnType<typeof buildBody>, r: string) => body.skeleton.bones.findIndex((b) => b.role === r);
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const q = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ');
  const worldEuler = (b: Bone) => e.setFromQuaternion(b.getWorldQuaternion(q), 'YXZ');

  it('holds the head steadier than the body at a trot', () => {
    const { body, obj, rig } = make('deer');
    const head = role(body, 'head'), shoulders = body.skeleton.bones[role(body, 'neck')].parent;
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.55);
    const S = { head: [] as number[], headRoll: [] as number[], pitch: [] as number[], roll: [] as number[], chest: [] as number[], chestRoll: [] as number[] };
    for (let i = 0; i < 180; i++) {
      rig.update(1 / 60);
      if (i < 90) continue;
      expect(rig.gait).toBe('trot');
      const h = worldEuler(obj.bones[head]);
      S.head.push(h.x);
      S.headRoll.push(h.z);
      // the body's sway lives in the skeleton's root bone (the root itself stays where the rig puts it)
      const b = worldEuler(obj.bones[0]);
      S.pitch.push(b.x);
      S.roll.push(b.z);
      // and what the neck hangs from: the chest, which the head rode on fully before it was steadied
      const c = worldEuler(obj.bones[shoulders]);
      S.chest.push(c.x);
      S.chestRoll.push(c.z);
    }
    expect(spread(S.pitch) + spread(S.roll)).toBeGreaterThan(0.02);
    expect(spread(S.head)).toBeLessThanOrEqual(0.5 * (spread(S.pitch) + spread(S.roll)));
    expect(spread(S.head) + spread(S.headRoll)).toBeLessThanOrEqual(0.5 * (spread(S.chest) + spread(S.chestRoll)));
  }, 30_000);

  it("bobs a duck's head on land: held back, then thrust forward", () => {
    const { body, obj, rig } = make('duck');
    const head = role(body, 'head');
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.3);
    const offsets: number[] = [], saw: number[] = [], p = new Vector3();
    for (let i = 0; i < 180; i++) {
      rig.update(1 / 60);
      if (i < 90) continue;
      expect(rig.gait).toBe('biped');
      obj.bones[head].getWorldPosition(p).sub(obj.root.position);
      offsets.push(p.x * Math.sin(rig.yaw) + p.z * Math.cos(rig.yaw));
      saw.push(birdHeadBob((rig.phase * 2) % 1, 1));
    }
    const a = 0.25 * (STRIDE.biped * rig.legLength) / 2 * 0.4; // a duck's bob is damped
    // how much hold-and-thrust sawtooth the head's offset carries (least squares on the unit sawtooth): about a, plus a
    // little in step from the neck's bob cancel (measured 5.9 mm with the bob, 2.2 mm without; a = 3.8 mm)
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length, mo = mean(offsets), ms = mean(saw);
    let sxy = 0, syy = 0;
    saw.forEach((y, i) => ((sxy += (offsets[i] - mo) * (y - ms)), (syy += (y - ms) ** 2)));
    expect(sxy / syy).toBeGreaterThanOrEqual(1.2 * a);
    expect(spread(offsets)).toBeGreaterThanOrEqual(1.5 * a); // 9.8 mm with the bob, 4.2 mm without
  }, 30_000);

  it("slides a hawk's head (it has no neck bone) only while it walks", () => {
    const { body, obj, rig } = make('hawk');
    const head = role(body, 'head'), d = body.skeleton.bones[head], parent = body.skeleton.bones[d.parent];
    const restZ = d.start.z - parent.start.z, a = 0.25 * (STRIDE.biped * rig.legLength) / 2;
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.3);
    const zs: number[] = [];
    for (let i = 0; i < 150; i++) {
      rig.update(1 / 60);
      if (i >= 60) zs.push(obj.bones[head].position.z - restZ);
    }
    expect(Math.max(...zs.map(Math.abs))).toBeLessThanOrEqual(a + 1e-9);
    expect(spread(zs)).toBeGreaterThan(a);
    rig.cruise = 2;
    rig.wantFly = true;
    rig.setSpeed(0.6);
    for (let i = 0; i < 240; i++) rig.update(1 / 60);
    expect(rig.flying).toBe(true);
    expect(obj.bones[head].position.z).toBe(restZ);
  }, 30_000);

  it('swings the tail alike at any frame rate', () => {
    // the deer's gallop and the rabbit's hop, 60 and 240 updates a second: the tail's pitch over the same seconds
    for (const id of ['deer', 'rabbit']) {
      const at = (hz: number) => {
        const { body, obj, rig } = make(id), tail = role(body, 'tail');
        rig.moveTo({ x: 0, y: 0, z: 400 });
        rig.setSpeed(1);
        const pitch: number[] = [];
        for (let i = 0; i < 4 * hz; i++) {
          rig.update(1 / hz);
          if (i >= 1.5 * hz) pitch.push(e.setFromQuaternion(obj.bones[tail].quaternion, 'YXZ').x);
        }
        return { mean: pitch.reduce((s, v) => s + v, 0) / pitch.length, lo: Math.min(...pitch), hi: Math.max(...pitch) };
      };
      const slow = at(60), fast = at(240);
      expect(slow.hi - slow.lo, `${id} swings`).toBeGreaterThan(0.02);
      expect(Math.abs(fast.mean - slow.mean), `${id} mean`).toBeLessThan(0.01);
      expect(Math.abs(fast.lo - slow.lo), `${id} low`).toBeLessThan(0.15 * (slow.hi - slow.lo));
      expect(Math.abs(fast.hi - slow.hi), `${id} high`).toBeLessThan(0.15 * (slow.hi - slow.lo));
    }
  }, 60_000);

  it('keeps the tail on the inside of a steady turn, even at a chase', () => {
    // a fox driven round a steady circle at 8 m/s (the valley's top speed), each way: once the turn has settled, the tail's
    // tip sits on the inside of the turn (the creature's left, +x, turning left), averaged over a whole sway (2 s)
    const tip = new Vector3(), base = new Vector3();
    for (const turnRate of [1.2, -1.2]) {
      const { body, obj, rig } = make('fox'), dt = 1 / 60, speed = 8;
      const tail = findChains(body.skeleton, true).find((c) => c.kind === 'tail')!.chain;
      let x = 0, z = 0, yaw = 0, side = 0;
      for (let i = 0; i < 360; i++) {
        yaw += turnRate * dt;
        x += Math.sin(yaw) * speed * dt;
        z += Math.cos(yaw) * speed * dt;
        rig.drive({ x, z, yaw, speed, turnRate, altitude: 0, flying: false });
        rig.update(dt);
        if (i < 240) continue;
        obj.root.worldToLocal(obj.bones[tail[tail.length - 1]].getWorldPosition(tip));
        obj.root.worldToLocal(obj.bones[tail[0]].getWorldPosition(base));
        side += (tip.x - base.x) / 120;
      }
      expect(side * Math.sign(turnRate), `turn ${turnRate}`).toBeGreaterThan(0.01);
    }
  }, 30_000);

  it('back in view after creeping a little unseen, flicks neither the tail nor the ears', () => {
    // a fox stands; out of view (only driven, as a stowed body is) it creeps 0.25 m to its left; back in view as the
    // residents bring it back (feet unplanted, a fresh drive, then updates). Its tail and ears move exactly as those of a
    // fox that stayed put: the move unseen is no motion to swing them after.
    const run = (moved: number) => {
      const { body, obj, rig } = make('fox'), dt = 1 / 60;
      const at = (x: number) => ({ x, z: 0, yaw: 0, speed: 0, turnRate: 0, altitude: 0, flying: false });
      for (let i = 0; i < 60; i++) rig.drive(at(0)), rig.update(dt);
      for (let i = 0; i < 10; i++) rig.drive(at((moved * (i + 1)) / 10));
      rig.legs.forEach((l) => (l.planted = null));
      const watched = [...findChains(body.skeleton, true).filter((c) => c.kind === 'tail' || c.kind === 'ear').flatMap((c) => c.chain)];
      const shots: number[][] = [];
      for (let i = 0; i < 20; i++) {
        rig.drive(at(moved), i === 0);
        rig.update(dt);
        shots.push(watched.flatMap((k) => obj.bones[k].quaternion.toArray()));
      }
      return { shots, watched };
    };
    const crept = run(0.25), stayed = run(0);
    expect(crept.watched.length).toBeGreaterThan(2);
    let worst = 0;
    crept.shots.forEach((s, i) => s.forEach((v, j) => (worst = Math.max(worst, Math.abs(v - stayed.shots[i][j])))));
    expect(worst).toBeLessThan(1e-6);
  }, 30_000);

  it('holds the head, tail and ears bit for bit while paused (R17)', () => {
    // a driven trot on a curve, the tail and ear springs swinging when the pause comes; a paused rig then steps on
    // exactly as one that never paused (so the follow-through's memory of the body's motion holds too)
    const run = (pause: boolean) => {
      const { body, obj, rig } = make('deer');
      const speed = 0.55 * rig.traits.topSpeed, turnRate = 0.6, dt = 1 / 60;
      let x = 0, z = 0, yaw = 0;
      const snap = () => obj.bones.map((b) => [...b.quaternion.toArray(), ...b.position.toArray(), ...b.scale.toArray()]);
      const shots: number[][][] = [];
      for (let i = 0; i < 125; i++) {
        yaw += turnRate * dt;
        x += Math.sin(yaw) * speed * dt;
        z += Math.cos(yaw) * speed * dt;
        rig.drive({ x, z, yaw, speed, turnRate, altitude: 0, flying: false });
        rig.update(dt);
        shots.push(snap());
        if (pause && i === 119) {
          expect(rig.gait).toBe('trot');
          for (let k = 0; k < 100; k++) rig.update(0);
          expect(snap()).toStrictEqual(shots[i]);
        }
      }
      return { body, shots };
    };
    const { body, shots } = run(true), plain = run(false).shots;
    const watched = [role(body, 'head'), role(body, 'tail'), ...findChains(body.skeleton, true).filter((c) => c.kind === 'ear').map((c) => c.chain[0])];
    for (const k of watched) expect(shots[119][k], `bone ${k} is moving`).not.toStrictEqual(shots[118][k]);
    expect(shots).toStrictEqual(plain);
  }, 30_000);
});
