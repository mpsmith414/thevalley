import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { anticipationTime } from '../../src/motion/body';
import { CreatureRig } from '../../src/motion/rig';
import type { Recipe } from '../../src/recipe/schema';
import { createCreatureObject } from '../../src/render/creature';
import { arrived, keepClear, newMotion, steer } from '../../src/sim/mover';
import { traitsFor } from '../../src/sim/traits';
import type { Agent, Motion, SimWorld } from '../../src/sim/types';
import { bird, quadruped, snake } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const fast = (r: Recipe, s: number): Recipe => ({ ...r, life: { ...r.life, topSpeed: s } });
const DT = 1 / 60;

type Case = { recipe: Recipe; cap: number; target: [number, number]; frac: number; yaw: number; phases: { steps: number; wantFly: boolean }[] };
/** The lab's quadruped (cap 3), a quick one in the valley (cap 8), and a flier taking off, cruising and landing. */
const CASES: Record<string, Case> = {
  lab: { recipe: quadruped, cap: 3, target: [10, -6], frac: 1, yaw: 0, phases: [{ steps: 300, wantFly: false }] },
  valley: { recipe: fast(quadruped, 13), cap: 8, target: [-20, 25], frac: 0.7, yaw: 0.5, phases: [{ steps: 300, wantFly: false }] },
  flier: { recipe: fast(bird, 18), cap: 8, target: [40, 30], frac: 1, yaw: 0, phases: [{ steps: 300, wantFly: true }, { steps: 300, wantFly: false }] },
};
/**
 * Recorded from the rig before its steering moved out (every 30th step of 1/60 s): x, z, yaw, speed, altitude, flying.
 * Both the rig and `steer` must still follow these to 1e-6.
 */
const GOLDEN: Record<string, number[][]> = {
  lab: [
    [0.10898773629356588, 0.18963404655012145, 0.8826764898740639, 0.830096481699058, 0, 0],
    [1.024592719090863, 0.3378497620956164, 1.7453110885601502, 2.685929306429143, 0, 0],
    [2.3499058686377, -0.23142431093826035, 2.1082096788157783, 2.98059274824508, 0, 0],
    [3.5897129521307307, -1.0692907023253615, 2.1988233110978443, 2.9987457774622506, 0, 0],
    [4.7903284584563455, -1.9680703464764167, 2.222155062045418, 2.9999131524088014, 0, 0],
    [5.97966256195589, -2.8820906464572715, 2.228415843913157, 2.9999933216071266, 0, 0],
    [7.165825059634176, -3.800248786971383, 2.2302097247072, 2.999999386275835, 0, 0],
    [8.351032154671191, -4.719641910610951, 2.2307908241794943, 2.999999918124691, 0, 0],
    [9.535892320367626, -5.639482279647698, 2.2310551779579164, 2.9999999576114953, 0, 0],
    [10.233456381040927, -6.240692311597806, 2.6137407886813064, 0.7634049865998576, 0, 0],
  ],
  valley: [
    [-0.12065206446569986, 1.4719079719162427, -0.3317906440087981, 5.1834357774763165, 0, 0],
    [-1.4826629853292252, 3.83293019931833, -0.6316977365864453, 5.576672003651774, 0, 0],
    [-3.233174086003206, 6.012901037342586, -0.7026378362824679, 5.598675140814713, 0, 0],
    [-5.0652718373363825, 8.129992372295318, -0.7196192407598265, 5.59992292031173, 0, 0],
    [-6.916198673798849, 10.230942400275223, -0.7237394217623543, 5.599995375006356, 0, 0],
    [-8.771674931126189, 12.327893298681664, -0.7247564515931098, 5.599999711075297, 0, 0],
    [-10.628280973122347, 14.42384503970242, -0.725013302128679, 5.599999980933203, 0, 0],
    [-12.485175607078219, 16.51954117651015, -0.7250802715763898, 5.599999998638252, 0, 0],
    [-14.342146826353702, 18.615169456825864, -0.7250985854446035, 5.599999999889916, 0, 0],
    [-16.199139609175337, 20.71077862945724, -0.7251040080937439, 5.59999999998888, 0, 0],
  ],
  flier: [
    [1.2922797866493008, 2.0825455139981393, 0.7213256993024976, 9.600000000000007, 0.7500000000000003, 1],
    [5.860193347376469, 6.170926045282934, 0.9061173573942153, 12.778534757398118, 1.4999999999999987, 1],
    [11.00654327513657, 9.968804917931664, 0.9521875134939402, 12.798621805446396, 2.226635739986227, 1],
    [16.24759765941372, 13.64140535015665, 0.9640071982226833, 12.799905453519207, 2.6867437092713593, 1],
    [21.512216416603415, 17.280574511883096, 0.9671610712620785, 12.799992835532862, 2.937725391739295, 1],
    [26.78319091119634, 20.91056197653728, 0.9680562488951158, 12.799999358834768, 3.074631963977776, 1],
    [32.05603848089006, 24.537830458674307, 0.9683406767495828, 12.799999919632064, 3.149312352354266, 1],
    [37.329541687349945, 28.164145890723848, 0.9684613634615205, 12.799999969864047, 3.190049333179032, 1],
    [42.31170194073901, 30.936785857533753, 1.4352253434118447, 7.9999988036064025, 3.2122707174379244, 1],
    [44.06530572052137, 30.516559940844473, 2.4352253434118465, 1.92, 3.2243921341061226, 1],
    [44.237343569813454, 29.607429041460442, -2.8479599637677437, 2.24, 2.624392134106122, 1],
    [42.26969259566813, 27.978137404885565, -1.8479599637677462, 6.838188010434333, 2.0243921341061215, 1],
    [39.42310279575337, 28.56065193730594, -0.8479599637677436, 4.416774023797701, 1.424392134106121, 1],
    [38.86594139472513, 29.954871243127215, 0.15204003623225618, 2.464496937110436, 0.8374844274178576, 1],
    [39.49594217848583, 30.784612499019673, 1.1520400362322567, 1.9541824669259027, 0.4568346228834203, 1],
    [40.41255218068966, 30.694814903854517, 2.1520400362322603, 1.92, 0.24919612333389485, 1],
    [40.83181879329906, 29.875297511234436, -3.13114527094733, 1.92, 0.13593257772953152, 1],
    [40.368749403430215, 29.079709684893256, -2.1311452709473335, 1.92, 0.07414908964469374, 1],
    [39.44908787257466, 29.03951120332781, -1.131145270947332, 1.92, 0.04044716569766309, 1],
    [39.092519292245825, 29.879722923080315, 0.32799328988294785, 3.522108830094851, 0, 0],
  ],
};

/** Runs a case's steps, sampling every 30th through `row`. */
function run(c: Case, step: (wantFly: boolean) => void, row: () => number[]) {
  const rows: number[][] = [];
  let n = 0;
  for (const p of c.phases) for (let i = 0; i < p.steps; i++) {
    step(p.wantFly);
    if (++n % 30 === 0) rows.push(row());
  }
  return rows;
}
const expectGolden = (rows: number[][], golden: number[][]) => {
  expect(rows).toHaveLength(golden.length);
  rows.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(v - golden[i][j]), `row ${i}, value ${j}`).toBeLessThan(1e-6)));
};

describe('steering golden trajectories', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: the rig steers as it always has`, () => {
      const body = buildBody(c.recipe, [2]), rig = new CreatureRig(createCreatureObject(body, c.recipe, 'low'), body, c.recipe, flat, c.cap);
      rig.yaw = c.yaw;
      rig.moveTo({ x: c.target[0], y: 0, z: c.target[1] });
      rig.setSpeed(c.frac);
      let still = 0, going = false;
      const rows = run(c, (wantFly) => {
        rig.wantFly = wantFly;
        rig.update(DT);
        if (!going && rig.speed === 0) still++;
        else going = true;
      }, () => [rig.position.x, rig.position.z, rig.yaw, rig.speed, rig.altitude, rig.flying ? 1 : 0]);
      // setting off from rest briskly, the rig first gathers itself with its speed held at 0 (the anticipation, R15);
      // otherwise it is `steer`, step for step: the golden path, or that path with the speed held for those first steps
      if (!still) return expectGolden(rows, GOLDEN[name]);
      if (name === 'flier') {
        // taking off, the rig first crouches with its flight and speed held (R15), then jumps 0.3 leg lengths up over
        // 0.1 s: `steer`, step for step, with those holds and that jump
        expect(still).toBe(Math.ceil(0.2 / DT - 1e-6));
        const t = traitsFor(c.recipe, 'land', c.cap), m = newMotion(0, 0, c.yaw), jump = 0.3 * rig.legLength;
        m.target = { x: c.target[0], z: c.target[1] };
        let n = 0, left = 0;
        return expectGolden(rows, run(c, (wantFly) => {
          const held = n++ < still, flew = m.flying;
          m.wantFly = wantFly && !held;
          m.speedFrac = held ? 0 : c.frac;
          steer(m, t, DT);
          if (m.flying && !flew) left = jump;
          const up = Math.min(left, (jump * DT) / 0.1);
          m.altitude += up;
          left -= up;
        }, () => [m.x, m.z, m.yaw, m.speed, m.altitude, m.flying ? 1 : 0]));
      }
      expect(name).toBe('valley'); // the lab's case sets off at only 0.15 of its top speed (a sharp turn first)
      expect(still).toBe(Math.ceil(anticipationTime(c.recipe.life.sizeM) / DT - 1e-6));
      const t = traitsFor(c.recipe, 'land', c.cap), m = newMotion(0, 0, c.yaw);
      m.target = { x: c.target[0], z: c.target[1] };
      let n = 0;
      expectGolden(rows, run(c, (wantFly) => {
        m.wantFly = wantFly;
        m.speedFrac = n++ < still ? 0 : c.frac;
        steer(m, t, DT);
      }, () => [m.x, m.z, m.yaw, m.speed, m.altitude, m.flying ? 1 : 0]));
    }, 30_000);

    it(`${name}: steer follows the same path`, () => {
      const t = traitsFor(c.recipe, 'land', c.cap), m = newMotion(0, 0, c.yaw);
      m.target = { x: c.target[0], z: c.target[1] };
      m.speedFrac = c.frac;
      const rows = run(c, (wantFly) => {
        m.wantFly = wantFly;
        steer(m, t, DT);
      }, () => [m.x, m.z, m.yaw, m.speed, m.altitude, m.flying ? 1 : 0]);
      expectGolden(rows, GOLDEN[name]);
    });
  }
});

describe('steer', () => {
  it('walks a quadruped from rest to a target 20 m away', () => {
    const t = traitsFor(quadruped, 'land'), m = newMotion(0, 0, 0);
    m.target = { x: 12, z: -16 };
    m.speedFrac = 1;
    for (let i = 0; i < 2000 && !arrived(m); i++) steer(m, t, DT);
    expect(Math.hypot(m.x - 12, m.z + 16)).toBeLessThan(0.3);
  });

  it('flies up to its cruise and lands when it no longer wants to fly', () => {
    const t = traitsFor(bird, 'air'), m = newMotion(0, 0, 0);
    m.wantFly = true;
    for (let i = 0; i < 900; i++) steer(m, t, DT);
    expect(m.flying).toBe(true);
    expect(m.altitude).toBeCloseTo(2.2 + t.bodyLength * 2, 2);
    m.cruise = 6;
    for (let i = 0; i < 900; i++) steer(m, t, DT);
    expect(m.altitude).toBeCloseTo(6, 2);
    m.wantFly = false;
    for (let i = 0; i < 900; i++) steer(m, t, DT);
    expect(m.altitude).toBe(0);
    expect(m.flying).toBe(false);
    expect(m.climb).toBe(0);
  });

  it('never takes off while lying down, and a walker never takes off at all', () => {
    const m = newMotion(0, 0, 0);
    m.wantFly = true;
    steer(m, traitsFor(bird, 'air'), DT, true);
    expect(m.flying).toBe(false);
    steer(m, traitsFor(quadruped, 'land'), DT);
    expect(m.flying).toBe(false);
  });

  it('stays put while lying down, its turn easing off', () => {
    const t = traitsFor(quadruped, 'land'), m = newMotion(0, 0, 0);
    m.target = { x: 5, z: 5 };
    m.speedFrac = 1;
    m.turnRate = 2;
    for (let i = 0; i < 60; i++) steer(m, t, DT, true);
    expect(m.x).toBe(0);
    expect(m.z).toBe(0);
    expect(Math.abs(m.turnRate)).toBeLessThan(0.01);
  });
});

describe('arrived', () => {
  it('is within 0.3 m by default, ignoring height, and true with no target', () => {
    const m: Motion = newMotion(1, 1, 0);
    expect(arrived(m)).toBe(true);
    m.target = { x: 1.2, z: 1.2 };
    expect(arrived(m)).toBe(true);
    m.target = { x: 1.3, z: 1.3 };
    expect(arrived(m)).toBe(false);
    expect(arrived(m, 0.5)).toBe(true);
  });
});

/** A world with water wherever x < 0 and one trunk at (5, 5), 0.5 m across its radius. */
const TRUNK = { x: 5, z: 5, r: 0.5 };
const world = {
  isWater: (x: number) => x < 0,
  trunksNear: (x: number, z: number, r: number) => (Math.hypot(TRUNK.x - x, TRUNK.z - z) <= r + TRUNK.r ? [TRUNK] : []),
} as unknown as SimWorld;
const agent = (m: Motion): Agent => ({
  id: 'a', species: 's', n: 0, seed: 1, home: 0, motion: m, needs: { hunger: 0, thirst: 0, tired: 0, fear: 0, company: 0 }, doing: 'walk',
  since: 0, group: null, leader: false, focus: null, place: null, stamina: 1, cooldown: 0, fedDay: 0,
  pose: { headDown: 0, sleep: 0, calling: 0, mouth: 'shut', ears: 'rest', look: null }, route: [], detour: null, sink: 0, threat: null, wary: 0, until: 0,
});

describe('keepClear', () => {
  it('puts a walker that stepped into the water back where it was, and stops it', () => {
    const a = agent(newMotion(-0.1, 2, 0));
    a.motion.target = { x: -5, z: 2 };
    expect(keepClear(a, traitsFor(quadruped, 'land'), world, { x: 0.1, z: 2 }, 0.3)).toBe(true);
    expect(a.motion.x).toBe(0.1);
    expect(a.motion.z).toBe(2);
    expect(a.motion.target).toBeNull();
  });

  it('slides a walker along the edge when only a corner of its step went into the water', () => {
    const a = agent(newMotion(-0.05, 2.3, 0));
    a.motion.target = { x: -5, z: 8 };
    expect(keepClear(a, traitsFor(quadruped, 'land'), world, { x: 0.1, z: 2 }, 0.3)).toBe(false);
    expect([a.motion.x, a.motion.z]).toEqual([0.1, 2.3]);
    expect(a.motion.target).toEqual({ x: -5, z: 8 });
  });

  it('puts a swimmer that stepped onto land back in the water', () => {
    const fish = { ...snake, motion: { ...snake.motion, gait: 'swim' as const } }, t = traitsFor(fish, 'water');
    expect(t.swimmer).toBe(true);
    const a = agent(newMotion(0.1, 2, 0));
    expect(keepClear(a, t, world, { x: -0.1, z: 2 }, 0.2)).toBe(true);
    expect(a.motion.x).toBe(-0.1);
    expect(keepClear(a, t, world, { x: -0.2, z: 2 }, 0.2)).toBe(false); // in the water: nothing to do
  });

  it('pushes a walker out of a trunk', () => {
    const a = agent(newMotion(5.2, 5, 0));
    expect(keepClear(a, traitsFor(quadruped, 'land'), world, { x: 5.2, z: 5 }, 0.4)).toBe(false);
    expect(Math.hypot(a.motion.x - 5, a.motion.z - 5)).toBeCloseTo(0.5 + 0.4 * 0.5, 9);
    expect(a.motion.x).toBeGreaterThan(5);
  });

  it('side-steps a trunk in the way and heads back on course once past it', () => {
    const t = traitsFor(quadruped, 'land'), a = agent(newMotion(2, 5, Math.PI / 2)), final = { x: 12, z: 5.1 };
    a.motion.target = final;
    a.motion.speedFrac = 1;
    keepClear(a, t, world, { x: 2, z: 5 }, 0.3);
    expect(a.detour).toBe(final);
    expect(a.motion.target).not.toBe(final);
    let closest = Infinity;
    for (let i = 0; i < 600 && a.detour; i++) {
      const prev = { x: a.motion.x, z: a.motion.z };
      steer(a.motion, t, DT);
      keepClear(a, t, world, prev, 0.3);
      closest = Math.min(closest, Math.hypot(a.motion.x - TRUNK.x, a.motion.z - TRUNK.z));
    }
    expect(a.detour).toBeNull();
    expect(a.motion.target).toBe(final);
    expect(closest).toBeGreaterThan(TRUNK.r + 0.3);
  });
});
