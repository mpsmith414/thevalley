import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { findChains } from '../../src/motion/limbs';
import { CreatureRig, type Ground } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import { snake } from '../fixtures/recipes';

const water: Ground = { heightAt: () => 0, isWater: () => true, waterLevelAt: () => 1 };
const DT = 1 / 60;

const make = (id: string, salt = 0) => {
  const recipe = CAST.find((c) => c.recipe.id === id)!.recipe, body = buildBody(recipe, [2]);
  const obj = createCreatureObject(body, recipe, 'low');
  return { recipe, body, obj, rig: new CreatureRig(obj, body, recipe, water, 3, salt) };
};
const qa = new Quaternion(), qb = new Quaternion(), e = new Euler(0, 0, 0, 'YXZ');
/** A bone's yaw relative to the body (the skeleton's root bone), radians. */
const bodyYaw = (rig: CreatureRig, k: number) => {
  rig.obj.bones[0].getWorldQuaternion(qa).invert();
  return e.setFromQuaternion(qa.multiply(rig.obj.bones[k].getWorldQuaternion(qb)), 'YXZ').y;
};
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

const flat: Ground = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const snakeRig = () => {
  const body = buildBody(snake, [2]);
  return new CreatureRig(createCreatureObject(body, snake, 'low'), body, snake, flat);
};

describe('swimmers, floaters and slitherers', () => {
  const swim = (frac: number, seconds: number, watch: number[]) => {
    const { rig } = make('trout');
    rig.moveTo({ x: 0, y: 0, z: 50 });
    rig.setSpeed(frac);
    const seen = watch.map(() => [] as number[]);
    for (let i = 0; i < seconds / DT; i++) {
      rig.update(DT);
      if (i * DT >= 1) watch.forEach((k, j) => seen[j].push(bodyYaw(rig, k))); // once up to speed
    }
    return { rig, seen };
  };
  const troutBones = () => {
    const { body } = make('trout');
    const chains = findChains(body.skeleton, false);
    const tail = chains.find((c) => c.kind === 'tail')!.chain, spine = chains.find((c) => c.kind === 'spine')!.chain;
    return { tip: tail[tail.length - 1], first: spine[1] };
  };

  it('swims a trout with a tail-heavy wave: the tail swings at least 3× as far as the front of the body', () => {
    const { tip, first } = troutBones();
    const { rig, seen } = swim(0.6, 3, [tip, first]);
    expect(rig.inWater).toBe(true);
    expect(spread(seen[1])).toBeGreaterThan(0.01);
    expect(spread(seen[0])).toBeGreaterThan(3 * spread(seen[1]));
  }, 30_000);

  it('beats its tail faster when it swims faster', () => {
    const { tip } = troutBones();
    const crossings = (frac: number) => {
      const ys = swim(frac, 3, [tip]).seen[0], mean = ys.reduce((s, y) => s + y, 0) / ys.length;
      let n = 0;
      for (let i = 1; i < ys.length; i++) if (Math.sign(ys[i] - mean) !== Math.sign(ys[i - 1] - mean)) n++;
      return n;
    };
    expect(crossings(0.6)).toBeGreaterThan(1.3 * crossings(0.3));
  }, 30_000);

  it('bends a turning fish into a C round the turn, driven (no target)', () => {
    const { tip, first } = troutBones();
    const { rig } = make('trout'), speed = 0.3 * rig.traits.topSpeed, turnRate = 1;
    let x = 0, z = 0, yaw = 0, front = 0, tail = 0;
    for (let i = 0; i < 180; i++) {
      yaw += turnRate * DT;
      x += Math.sin(yaw) * speed * DT;
      z += Math.cos(yaw) * speed * DT;
      rig.drive({ x, z, yaw, speed, turnRate, altitude: 0, flying: false });
      rig.update(DT);
      if (i >= 60) (front += bodyYaw(rig, first)), (tail += bodyYaw(rig, tip));
    }
    // turning left: the front of the body turns to the left (+ yaw) and the tail's tip swings to the left too (− yaw)
    expect(front / 120).toBeGreaterThan(0.02);
    expect(tail / 120).toBeLessThan(-0.1);
  }, 30_000);

  it('bobs a duck on the water by a few millimetres, and its wobble differs from duck to duck', () => {
    const run = (salt: number) => {
      const { rig } = make('duck', salt);
      const ys: number[] = [], yaws: number[] = [];
      for (let i = 0; i < 4 / DT; i++) {
        rig.update(DT);
        ys.push(rig.obj.root.position.y);
        yaws.push(rig.obj.root.rotation.y);
      }
      expect(rig.inWater).toBe(true);
      expect(rig.yaw).toBe(0); // the wobble is pose only
      return { ys, yaws };
    };
    const a = run(1), b = run(2);
    expect(spread(a.ys)).toBeGreaterThan(0.002);
    expect(spread(a.ys)).toBeLessThan(0.012);
    expect(spread(a.yaws)).toBeGreaterThan(0.02);
    expect(spread(a.yaws)).toBeLessThan(0.061);
    expect(a.yaws).not.toStrictEqual(b.yaws);
  }, 30_000);

  it('paddles a floating duck with its legs in opposite phase', () => {
    const { rig } = make('duck');
    const legs = rig.legs.map((l) => l.limb.chain[0]), angles: number[][] = [];
    for (let i = 0; i < 3 / DT; i++) {
      rig.update(DT);
      if (i * DT > 1.5) angles.push(legs.map((k) => rig.obj.bones[k].rotation.x)); // the tuck has eased in
    }
    expect(legs.length).toBe(2);
    // each update the legs move by equal and opposite amounts
    let ll = 0, rr = 0, lr = 0;
    for (let i = 1; i < angles.length; i++) {
      const dl = angles[i][0] - angles[i - 1][0], dr = angles[i][1] - angles[i - 1][1];
      (ll += dl * dl), (rr += dr * dr), (lr += dl * dr);
    }
    expect(ll).toBeGreaterThan(0);
    expect(lr / Math.sqrt(ll * rr)).toBeLessThan(-0.99);
  }, 30_000);

  describe('a snake slithers with its tail leading', () => {
    const v = new Vector3();
    /** A bone's start, sideways in creature space (m, + = left), and its yaw against the heading. */
    const side = (rig: CreatureRig, k: number) => rig.obj.root.worldToLocal(rig.obj.bones[k].getWorldPosition(v)).x;
    const yaw = (rig: CreatureRig, k: number) => {
      rig.obj.root.getWorldQuaternion(qa).invert();
      return e.setFromQuaternion(qa.multiply(rig.obj.bones[k].getWorldQuaternion(qb)), 'YXZ').y;
    };
    const slither = (seconds: number, watch: (rig: CreatureRig) => number[]) => {
      const rig = snakeRig(), seen: number[][] = [];
      rig.moveTo({ x: 0, y: 0, z: 50 });
      rig.setSpeed(0.3);
      for (let i = 0; i < seconds / DT; i++) {
        rig.update(DT);
        if (i * DT >= 1) seen.push(watch(rig)); // once moving
      }
      return seen;
    };

    it('swings its tail tip most, and keeps its head on its line (within 1 cm)', () => {
      const head = buildBody(snake, [2]).skeleton.bones.findIndex((b) => b.role === 'head');
      const seen = slither(2, (rig) => [side(rig, 0), side(rig, head)]);
      const tail = spread(seen.map((s) => s[0])), front = spread(seen.map((s) => s[1]));
      expect(tail).toBeGreaterThan(0.1);
      expect(front).toBeLessThan(0.01);
      expect(tail).toBeGreaterThan(5 * front);
    }, 30_000);

    it('sends its wave from head to tail', () => {
      // a segment nearer the tail (bone 4) does what one nearer the head (bone 6) did a moment before
      const seen = slither(4, (rig) => [yaw(rig, 6), yaw(rig, 4)]), lag = 10;
      const corr = (shift: number) => {
        let c = 0;
        for (let i = lag; i < seen.length - lag; i++) c += seen[i][1] * seen[i - shift][0];
        return c;
      };
      expect(corr(lag)).toBeGreaterThan(corr(-lag));
    }, 30_000);
  });

  describe('pause holds a swim and a float bit for bit (R17)', () => {
    const snap = (rig: CreatureRig) => [
      ...rig.obj.root.position.toArray(), ...rig.obj.root.quaternion.toArray(),
      ...rig.obj.bones.flatMap((b) => [...b.quaternion.toArray(), ...b.position.toArray(), ...b.scale.toArray()]),
    ];
    const check = (go: (pause: boolean) => { shots: number[][]; at: number }) => {
      const paused = go(true), plain = go(false);
      expect(paused.shots[paused.at], 'moving when paused').not.toStrictEqual(paused.shots[paused.at - 1]);
      expect(paused.shots).toStrictEqual(plain.shots);
    };

    it('a self-steering trout swimming', () => {
      check((pause) => {
        const { rig } = make('trout'), shots: number[][] = [], at = 90;
        rig.moveTo({ x: 10, y: 0, z: 50 });
        rig.setSpeed(0.5);
        for (let i = 0; i < 120; i++) {
          rig.update(DT);
          shots.push(snap(rig));
          if (pause && i === at) {
            for (let k = 0; k < 100; k++) rig.update(0);
            expect(snap(rig)).toStrictEqual(shots[i]);
          }
        }
        return { shots, at };
      });
    }, 30_000);

    it('a driven trout swimming a curve and a driven duck floating', () => {
      for (const id of ['trout', 'duck']) {
        check((pause) => {
          const { rig } = make(id, 3), shots: number[][] = [], at = 90;
          const speed = 0.4 * rig.traits.topSpeed, turnRate = 0.5;
          let x = 0, z = 0, yaw = 0;
          for (let i = 0; i < 120; i++) {
            yaw += turnRate * DT;
            x += Math.sin(yaw) * speed * DT;
            z += Math.cos(yaw) * speed * DT;
            rig.drive({ x, z, yaw, speed, turnRate, altitude: 0, flying: false });
            // the residents substep by distance: two half steps on odd frames
            if (i % 2) (rig.update(DT / 2), rig.update(DT / 2));
            else rig.update(DT);
            shots.push(snap(rig));
            if (pause && (i === at || i === at + 1)) {
              // after a whole step, and after a frame of two half steps
              for (let k = 0; k < 100; k++) rig.update(0);
              expect(snap(rig)).toStrictEqual(shots[i]);
            }
          }
          return { shots, at };
        });
      }
    }, 30_000);

    it('a self-steering snake slithering round a turn', () => {
      check((pause) => {
        const rig = snakeRig(), shots: number[][] = [], at = 90;
        rig.moveTo({ x: 8, y: 0, z: 20 });
        rig.setSpeed(0.4);
        for (let i = 0; i < 120; i++) {
          rig.update(DT);
          shots.push(snap(rig));
          if (pause && i === at) {
            for (let k = 0; k < 100; k++) rig.update(0);
            expect(snap(rig)).toStrictEqual(shots[i]);
          }
        }
        return { shots, at };
      });
    }, 30_000);
  });
});
