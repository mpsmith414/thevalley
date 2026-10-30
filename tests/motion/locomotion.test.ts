import { Euler, Quaternion, type Bone } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { anticipationTime, Settle } from '../../src/motion/body';
import { STRIDE } from '../../src/motion/gait';
import { CreatureRig } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import type { Vec3 } from '../../src/util/vec';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const DT = 1 / 60;
const deer = CAST.find((c) => c.recipe.id === 'deer')!.recipe;
const deerBody = buildBody(deer, [2]);
const make = () => new CreatureRig(createCreatureObject(deerBody, deer, 'low'), deerBody, deer, flat);
const run = (rig: CreatureRig, frames: number) => {
  for (let i = 0; i < frames; i++) rig.update(DT);
};
const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

describe('starts and stops: helpers', () => {
  it('gathers longer before setting off the bigger the body, within 0.12…0.25 s', () => {
    expect(anticipationTime(0.3)).toBeCloseTo(0.135, 12);
    expect(anticipationTime(10)).toBe(0.25);
    expect(anticipationTime(0)).toBe(0.12);
  });
  it('settles with one overshoot and is still within a second', () => {
    const s = new Settle();
    s.kick(4, 1);
    const pitch: number[] = [], height: number[] = [];
    for (let i = 0; i < 120; i++) {
      s.step(DT);
      pitch.push(s.pitch);
      height.push(s.height);
    }
    expect(Math.max(...pitch)).toBeGreaterThan(0.03); // nose down first
    expect(Math.min(...height)).toBeLessThan(-0.002); // and down
    expect(Math.min(...pitch)).toBeLessThan(0); // one overshoot back
    expect(Math.abs(pitch[59])).toBeLessThan(0.005);
    const before = [s.pitch, s.height];
    s.step(0);
    expect([s.pitch, s.height]).toStrictEqual(before);
  });
});

describe('starts, stops and turns in the rig', () => {
  it('gathers itself before setting off: holds still, dips and pitches nose down, then goes', () => {
    const rig = make(), T = anticipationTime(deer.life.sizeM), legLen = rig.legLength;
    run(rig, 30); // standing
    const restY = rig.obj.root.position.y;
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.5);
    const held = Math.floor(T / DT - 1e-9) - 1; // anticipationTime less a frame
    let lowest = Infinity, pitch = -Infinity;
    for (let i = 0; i < held; i++) {
      rig.update(DT);
      expect(rig.speed, `frame ${i}`).toBeLessThan(0.01);
      lowest = Math.min(lowest, rig.obj.root.position.y);
      pitch = Math.max(pitch, rig.obj.root.rotation.x);
    }
    expect(restY - lowest).toBeGreaterThanOrEqual(0.02 * legLen);
    expect(pitch).toBeGreaterThan(0.05);
    run(rig, 10);
    expect(rig.speed).toBeGreaterThan(0.1);
  }, 30_000);

  it('a driven rig dips as it sets off, as pose only: it stands exactly where it is fed', () => {
    const rig = make(), legLen = rig.legLength, top = rig.traits.topSpeed;
    rig.drive({ x: 0, z: 0, yaw: 0, speed: 0, turnRate: 0, altitude: 0, flying: false });
    run(rig, 30);
    const restY = rig.obj.root.position.y;
    let z = 0, speed = 0, lowest = Infinity, pitch = -Infinity;
    for (let i = 0; i < 30; i++) {
      speed = Math.min(0.5 * top, speed + 1.5 * top * DT);
      z += speed * DT;
      rig.drive({ x: 0, z, yaw: 0, speed, turnRate: 0, altitude: 0, flying: false });
      rig.update(DT);
      expect(rig.position.x).toBe(0);
      expect(rig.position.z).toBe(z);
      expect(rig.speed).toBe(speed);
      expect(rig.obj.root.position.z).toBe(z);
      if (i < 12) {
        lowest = Math.min(lowest, rig.obj.root.position.y);
        pitch = Math.max(pitch, rig.obj.root.rotation.x);
      }
    }
    expect(restY - lowest).toBeGreaterThanOrEqual(0.02 * legLen);
    expect(pitch).toBeGreaterThan(0.05);
    expect(rig.headingError).toBe(0);
  }, 30_000);

  it('leans back as it brakes, then settles with a visible overshoot: forward, then back, still by 0.8 s (R28)', () => {
    const rig = make(), legLen = rig.legLength;
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.5);
    run(rig, 120);
    rig.moveTo(null);
    let braking = Infinity, stop = -1;
    const pitch: number[] = [], y: number[] = [];
    for (let i = 0; i < 180; i++) {
      rig.update(DT);
      pitch.push(rig.obj.root.rotation.x);
      y.push(rig.obj.root.position.y);
      if (stop < 0 && rig.speed < 0.05) stop = i;
      if (stop < 0) braking = Math.min(braking, rig.obj.root.rotation.x);
      if (stop >= 0 && i === stop + 48) expect(Math.abs(rig.settle.pitch)).toBeLessThan(0.005);
    }
    expect(stop).toBeGreaterThan(0);
    expect(braking).toBeLessThan(-0.03); // nose up while braking
    const early = pitch.slice(stop, stop + 19), peak = Math.max(...early), at = stop + early.indexOf(peak);
    expect(peak).toBeGreaterThanOrEqual(0.025); // forward within 0.3 s of the stop
    expect(Math.min(...pitch.slice(at, stop + 48))).toBeLessThan(peak - 0.025); // and back
    const sink = y[y.length - 1] - Math.min(...y.slice(stop, stop + 30)); // below where it ends up standing
    expect(sink).toBeGreaterThanOrEqual(0.01 * legLen); // it sinks onto its legs
    expect(Math.abs(rig.settle.pitch)).toBeLessThan(0.005);
  }, 30_000);

  it('eases from one gait into the next: the body never jumps as it changes gait (Task 15)', () => {
    const rig = make(), hips = rig.obj.bones[rig.mech.torso[0]], e = new Euler();
    rig.moveTo({ x: 0, y: 0, z: 100 });
    let y = NaN, yaw = NaN, gait = rig.gait;
    const changes: { to: string; dy: number; dyaw: number }[] = [];
    for (let i = 0; i < 600; i++) {
      // walk, gallop, then slow back down through the trot and the walk to a stop
      rig.setSpeed(i < 150 ? 0.2 : i < 300 ? 1 : i < 450 ? 0.5 : 0);
      if (i === 450) rig.moveTo(null);
      rig.update(DT);
      const ny = rig.obj.root.position.y, nyaw = e.setFromQuaternion(hips.quaternion, 'YXZ').y;
      if (rig.gait !== gait) changes.push({ to: rig.gait, dy: Math.abs(ny - y), dyaw: Math.abs(nyaw - yaw) });
      (y = ny), (yaw = nyaw), (gait = rig.gait);
    }
    expect(changes.map((c) => c.to)).toEqual(['trot', 'gallop', 'trot', 'walk']);
    for (const c of changes) {
      expect(c.dy, `into ${c.to}`).toBeLessThan(0.004); // m: the bob carries on from where it was
      expect(c.dyaw, `into ${c.to}`).toBeLessThan(0.01); // radians: the hips swing on without a flip
    }
  }, 30_000);

  it('squares up a foot left far from home, one step, and leaves a near one alone', () => {
    const rig = make(), stride = STRIDE[rig.gait] * rig.legLength;
    run(rig, 60);
    const stance = rig.legs.filter((l) => l.planted);
    expect(stance.length).toBeGreaterThanOrEqual(2);
    const [far, near] = stance, home = { ...far.planted! }, nearHome = { ...near.planted! };
    far.planted = { x: home.x + 0.5 * stride, y: home.y, z: home.z };
    near.planted = { x: nearHome.x, y: nearHome.y, z: nearHome.z + 0.1 * stride };
    const nearSet = { ...near.planted };
    let lifted = 0;
    for (let i = 0; i < 60; i++) {
      rig.update(DT);
      lifted = Math.max(lifted, far.lift);
    }
    expect(lifted).toBeGreaterThan(0.04 * rig.legLength); // it stepped, it did not slide
    expect(flatDist(far.planted!, home)).toBeLessThan(0.1 * stride);
    expect(near.planted).toStrictEqual(nearSet);
  }, 30_000);

  it('now and then re-plants a foot while standing, and shifts its weight off it (seeded)', () => {
    const watch = () => {
      const rig = make(), stride = STRIDE[rig.gait] * rig.legLength;
      const steps: { t: number; leg: number; off: number }[] = [];
      let shift = 0;
      const home = rig.legs.map(() => null as Vec3 | null);
      for (let i = 0; i < 30 * 60; i++) {
        rig.update(DT);
        if (i === 60) rig.legs.forEach((l, k) => (home[k] = l.planted ? { ...l.planted } : null));
        rig.legs.forEach((l, k) => {
          if (l.lift > 0 && (!steps.length || steps[steps.length - 1].leg !== k || i / 60 - steps[steps.length - 1].t > 1)) steps.push({ t: i / 60, leg: k, off: 0 });
        });
        shift = Math.max(shift, Math.abs(rig.mech.pose.offsetX));
      }
      for (const s of steps) s.off = home[s.leg] && rig.legs[s.leg].planted ? flatDist(rig.legs[s.leg].planted!, home[s.leg]!) : 0;
      return { steps, shift, stride, hip: rig.mech.hipWidth };
    };
    const a = watch(), b = watch();
    expect(a.steps.length).toBeGreaterThanOrEqual(1);
    expect(a.steps[0].t).toBeGreaterThanOrEqual(8);
    expect(a.steps[0].t).toBeLessThanOrEqual(20.5);
    expect(a.shift).toBeGreaterThan(0.2 * a.hip * 0.12);
    expect(b).toStrictEqual(a);
  }, 60_000);

  it('herds shuffle on their own: the idle re-plant is salted per animal', () => {
    const first = (salt: number) => {
      const rig = new CreatureRig(createCreatureObject(deerBody, deer, 'low'), deerBody, deer, flat, 3, salt);
      for (let i = 0; i < 30 * 60; i++) {
        rig.update(DT);
        const k = rig.legs.findIndex((l) => l.lift > 1e-4);
        if (k >= 0) return { t: i, leg: k };
      }
      return null;
    };
    const a = first(0), b = first(1), c = first(2);
    expect(a && b && c).toBeTruthy();
    expect(first(1)).toStrictEqual(b); // still seeded
    expect(new Set([a, b, c].map((s) => `${s!.t}/${s!.leg}`)).size).toBeGreaterThan(1);
  }, 60_000);

  it('stopped mid-stride, every foot squares up, even one the gait left in the air (R29)', () => {
    const rig = make();
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    run(rig, 150);
    rig.moveTo(null);
    run(rig, 90); // 1.5 s
    const stride = STRIDE[rig.gait] * rig.legLength;
    const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
    rig.legs.forEach((l, k) => {
      expect(l.planted, `leg ${k} is down`).not.toBeNull();
      const hx = rig.position.x + c * l.home.x + s * l.home.z, hz = rig.position.z - s * l.home.x + c * l.home.z;
      expect(Math.hypot(l.planted!.x - hx, l.planted!.z - hz), `leg ${k}`).toBeLessThan(0.25 * stride);
    });
  }, 30_000);

  it('no foot slides while the body dips to set off from standing', () => {
    const rig = make();
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    run(rig, 150);
    rig.moveTo(null);
    run(rig, 150); // stopped and squared up
    const at = () => rig.legs.map((l) => [l.world.x, l.world.z]);
    const before = at();
    rig.moveTo({ x: rig.position.x, y: 0, z: rig.position.z + 100 });
    rig.setSpeed(0.5);
    let dipped = 0;
    for (let i = 0; i < 10; i++) {
      rig.update(DT);
      expect(rig.speed).toBe(0);
      dipped = Math.max(dipped, rig.obj.root.rotation.x);
      expect(at(), `frame ${i}`).toStrictEqual(before);
    }
    expect(dipped).toBeGreaterThan(0.03);
  }, 30_000);

  it('a driven grazer creeping on between bites hardly dips, and lets go before full depth', () => {
    const rig = make(), full = 0.03 * rig.legLength;
    rig.drive({ x: 0, z: 0, yaw: 0, speed: 0, turnRate: 0, altitude: 0, flying: false });
    run(rig, 30);
    let z = 0, deepest = 0;
    for (let i = 0; i < 60; i++) {
      const speed = i < 30 ? Math.min(0.08, i * 0.01) : Math.max(0, 0.08 - (i - 30) * 0.01);
      z += speed * DT;
      rig.drive({ x: 0, z, yaw: 0, speed, turnRate: 0, altitude: 0, flying: false });
      rig.update(DT);
      deepest = Math.max(deepest, -rig.mech.pace.height);
    }
    expect(deepest).toBeGreaterThan(0); // it did begin to gather itself
    expect(deepest).toBeLessThan(0.3 * full);
    expect(rig.mech.anticipating).toBe(false);
    expect(Math.abs(rig.mech.pace.height)).toBeLessThan(1e-9);
  }, 30_000);

  describe('the head leads the turn', () => {
    const q = new Quaternion(), p = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ');
    // the head's yaw relative to the chest (the neck's parent), so only the neck's own turn is measured
    const lead = (rig: CreatureRig) => {
      const sk = rig.body.skeleton, head = sk.bones.findIndex((b) => b.role === 'head');
      const chest = sk.bones[sk.bones.findIndex((b) => b.role === 'neck')].parent;
      const bones: Bone[] = rig.obj.bones;
      bones[chest].getWorldQuaternion(p);
      bones[head].getWorldQuaternion(q);
      return e.setFromQuaternion(p.invert().multiply(q), 'YXZ').y;
    };

    it('self-steering: from the turn still to make', () => {
      const rig = make();
      rig.moveTo({ x: 0, y: 0, z: 100 });
      rig.setSpeed(0.3);
      run(rig, 60);
      expect(Math.abs(lead(rig))).toBeLessThan(0.02);
      rig.moveTo({ x: rig.position.x + 100, y: 0, z: rig.position.z }); // 90° to the left
      let most = 0;
      for (let i = 0; i < 18; i++) {
        rig.update(DT);
        most = Math.max(most, lead(rig));
        expect(rig.headingError).toBeGreaterThan(0);
      }
      expect(most).toBeGreaterThanOrEqual(0.2);
    }, 30_000);

    it('driven: from the turn rate', () => {
      const at = (turnRate: number) => {
        const rig = make(), speed = 0.9;
        let x = 0, z = 0, yaw = 0, most = 0;
        for (let i = 0; i < 78; i++) {
          const w = i < 60 ? 0 : turnRate;
          yaw += w * DT;
          x += Math.sin(yaw) * speed * DT;
          z += Math.cos(yaw) * speed * DT;
          rig.drive({ x, z, yaw, speed, turnRate: w, altitude: 0, flying: false });
          rig.update(DT);
          if (i >= 60) most = Math.max(most, Math.abs(lead(rig)) * Math.sign(lead(rig) * (turnRate || 1)));
        }
        return most;
      };
      expect(at(1.6)).toBeGreaterThanOrEqual(0.2);
      expect(at(-1.6)).toBeGreaterThanOrEqual(0.2);
      expect(at(0)).toBeLessThan(0.02);
    }, 30_000);

    it('driven: in proportion to the turn rate, below the cap', () => {
      // the steady lead after a second of turning: 0.35 rad per rad/s of turn rate, through the look spring
      const steady = (turnRate: number) => {
        const rig = make(), speed = 0.9;
        let x = 0, z = 0, yaw = 0;
        for (let i = 0; i < 120; i++) {
          const w = i < 60 ? 0 : turnRate;
          yaw += w * DT;
          x += Math.sin(yaw) * speed * DT;
          z += Math.cos(yaw) * speed * DT;
          rig.drive({ x, z, yaw, speed, turnRate: w, altitude: 0, flying: false });
          rig.update(DT);
        }
        return lead(rig);
      };
      const half = steady(0.8), full = steady(1.6);
      expect(full).toBeGreaterThan(0.4);
      expect(half / full).toBeGreaterThan(0.4);
      expect(half / full).toBeLessThan(0.6);
    }, 30_000);
  });

  describe('pause holds a start or a stop bit for bit (R17)', () => {
    const snap = (rig: CreatureRig) => [
      ...rig.obj.root.position.toArray(), ...rig.obj.root.quaternion.toArray(), rig.settle.pitch, rig.settle.height, rig.accel,
      ...rig.obj.bones.flatMap((b) => [...b.quaternion.toArray(), ...b.position.toArray(), ...b.scale.toArray()]),
    ];
    for (const driven of [false, true])
      it(`a ${driven ? 'driven' : 'self-steering'} deer stopping and settling`, () => {
        const go = (pauseAt: number) => {
          const rig = make(), top = rig.traits.topSpeed, shots: number[][] = [];
          let z = 0, speed = 0, kicked = -1;
          for (let i = 0; i < 260; i++) {
            if (driven) {
              // walk off (an anticipation dip), cruise, brake to a stop
              speed = i < 130 ? Math.min(0.5 * top, speed + 1.5 * top * DT) : Math.max(0, speed - 1.5 * top * DT);
              z += speed * DT;
              rig.drive({ x: 0, z, yaw: 0, speed, turnRate: 0, altitude: 0, flying: false });
            } else if (i === 0) {
              rig.moveTo({ x: 0, y: 0, z: 100 });
              rig.setSpeed(0.5);
            } else if (i === 130) rig.moveTo(null);
            rig.update(DT);
            if (kicked < 0 && i > 130 && rig.settle.pitch !== 0) kicked = i;
            shots.push(snap(rig));
            if (i === pauseAt || (pauseAt === -2 && i === kicked + 6) || (pauseAt === -3 && i === 3)) {
              for (let k = 0; k < 100; k++) rig.update(0);
              expect(snap(rig)).toStrictEqual(shots[i]);
            }
          }
          return { shots, kicked };
        };
        const plain = go(-1);
        expect(plain.kicked).toBeGreaterThan(130);
        expect(go(-2).shots).toStrictEqual(plain.shots); // mid-settle
        expect(go(-3).shots).toStrictEqual(plain.shots); // mid-anticipation
      }, 60_000);

    it('a deer squaring up a foot', () => {
      const go = (pause: boolean) => {
        const rig = make(), stride = STRIDE[rig.gait] * rig.legLength, shots: number[][] = [];
        run(rig, 60);
        const leg = rig.legs.find((l) => l.planted)!;
        leg.planted = { x: leg.planted!.x + 0.5 * stride, y: leg.planted!.y, z: leg.planted!.z };
        for (let i = 0; i < 40; i++) {
          rig.update(DT);
          shots.push(snap(rig));
          if (pause && i === 8) {
            expect(leg.lift).toBeGreaterThan(0);
            for (let k = 0; k < 100; k++) rig.update(0);
            expect(snap(rig)).toStrictEqual(shots[i]);
          }
        }
        return shots;
      };
      expect(go(true)).toStrictEqual(go(false));
    }, 30_000);

    it('a deer mid idle re-plant, its weight shifting', () => {
      const go = (pause: boolean) => {
        const rig = make(), shots: number[][] = [];
        let stepAt = -1;
        for (let i = 0; i < 25 * 60; i++) {
          rig.update(DT);
          if (stepAt < 0 && rig.legs.some((l) => l.lift > 1e-4)) stepAt = i;
          if (stepAt < 0) continue;
          shots.push([...snap(rig), rig.mech.pose.offsetX]);
          if (pause && i === stepAt + 8) {
            for (let k = 0; k < 100; k++) rig.update(0);
            expect([...snap(rig), rig.mech.pose.offsetX]).toStrictEqual(shots[shots.length - 1]);
          }
          if (i > stepAt + 40) break;
        }
        expect(stepAt).toBeGreaterThan(0);
        return shots;
      };
      expect(go(true)).toStrictEqual(go(false));
    }, 60_000);
  });
});
