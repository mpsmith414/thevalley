import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { CreatureRig, type Ground } from '../../src/motion/rig';
import type { Recipe } from '../../src/recipe/schema';
import { createCreatureObject } from '../../src/render/creature';
import { snake } from '../fixtures/recipes';

/**
 * Golden bone poses: a few frames of every bone's transform for the deer, hawk, trout and snake, self-steering and driven,
 * on rolling ground (or in water). It pins the rig's behaviour bit for bit, so a refactor (the allocation-free rig) can
 * prove it changed nothing. A deliberate change of motion rewrites it: `GOLDEN=write npx vitest run tests/motion/golden.test.ts`.
 */
const FILE = new URL('./golden/rig.json', import.meta.url);
const DT = 1 / 60;
const hills: Ground = { heightAt: (x, z) => 0.15 * Math.sin(0.9 * x) * Math.cos(0.6 * z), isWater: () => false, waterLevelAt: () => -1 };
const pond: Ground = { heightAt: (x, z) => 0.1 * Math.sin(0.5 * x + z), isWater: () => true, waterLevelAt: () => 1.2 };
const cast = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe;
const SHOTS = [25, 70, 140, 210, 300];

const snap = (rig: CreatureRig) => [
  ...rig.obj.root.position.toArray(), ...rig.obj.root.quaternion.toArray(),
  ...rig.obj.bones.flatMap((b) => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
];

/** A self-steering run: stand, set off, turn hard and faster, look about, stop and graze (a flier flies, then lands). */
function steered(recipe: Recipe, ground: Ground, flier: boolean) {
  const body = buildBody(recipe, [2]), rig = new CreatureRig(createCreatureObject(body, recipe, 'low'), body, recipe, ground, 3, 7);
  const out: number[][] = [];
  for (let i = 0; i <= SHOTS[SHOTS.length - 1]; i++) {
    if (i === 20) {
      rig.moveTo({ x: 6, y: 0, z: 8 });
      rig.setSpeed(0.4);
      if (flier) (rig.cruise = 2), (rig.wantFly = true);
    }
    if (i === 100) rig.moveTo({ x: -6, y: 0, z: 14 }), rig.setSpeed(1);
    if (i === 160) rig.look = { x: 3, y: 1, z: 3 };
    if (i === 190) (rig.look = null), rig.moveTo(null), rig.setSpeed(0), (rig.wantFly = false);
    if (i === 250) rig.headDown = 1;
    rig.update(DT);
    if (SHOTS.includes(i)) out.push(snap(rig));
  }
  return out;
}

/** A driven run: the simulation's pose, speeding up and slowing, weaving, with a flight (up, then down) for a flier. */
function driven(recipe: Recipe, ground: Ground, flier: boolean) {
  const body = buildBody(recipe, [2]), rig = new CreatureRig(createCreatureObject(body, recipe, 'low'), body, recipe, ground, 3, 7);
  const out: number[][] = [];
  let x = 0, z = 0, yaw = 0.3, speed = 0, alt = 0, flying = false;
  for (let i = 0; i <= SHOTS[SHOTS.length - 1]; i++) {
    const want = i < 20 ? 0 : i < 180 ? (i < 100 ? 1 : 2.2) : 0;
    speed = want > speed ? Math.min(want, speed + 2 * DT) : Math.max(want, speed - 3 * DT);
    const turnRate = speed > 0 ? 0.8 * Math.sin(i / 30) : 0;
    yaw += turnRate * DT;
    x += Math.sin(yaw) * speed * DT;
    z += Math.cos(yaw) * speed * DT;
    if (flier) {
      if (i === 30) flying = true;
      if (flying) {
        const cruise = i < 160 ? 2.5 : 0;
        alt += Math.max(-1.2, Math.min(1.5, (cruise - alt) * 1.2)) * DT;
        if (cruise === 0 && alt < 0.03) (alt = 0), (flying = false);
      }
    }
    rig.drive({ x, z, yaw, speed, turnRate, altitude: alt, flying });
    // the residents' substeps: two updates in some frames, and a paused one now and then
    if (i % 3 === 0) rig.update(DT / 2), rig.update(DT / 2);
    else rig.update(i % 17 === 0 ? 0 : DT);
    if (SHOTS.includes(i)) out.push(snap(rig));
  }
  return out;
}

const CASES: [string, Recipe, Ground, boolean][] = [
  ['deer', cast('deer'), hills, false],
  ['hawk', cast('hawk'), hills, true],
  ['trout', cast('trout'), pond, false],
  ['snake', snake, hills, false],
];

describe('golden bone poses', () => {
  const write = process.env.GOLDEN === 'write';
  const golden: Record<string, number[][]> = !write && existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  const fresh: Record<string, number[][]> = {};
  for (const [name, recipe, ground, flier] of CASES)
    for (const [mode, run] of [['steered', steered], ['driven', driven]] as const)
      it(`${name}, ${mode}: the bones are where they were`, () => {
        const got = run(recipe, ground, flier), key = `${name}-${mode}`;
        fresh[key] = got;
        if (write) return;
        const want = golden[key];
        expect(want, `no golden for ${key}: write it with GOLDEN=write`).toBeDefined();
        expect(got.length).toBe(want.length);
        let worst = 0;
        got.forEach((frame, f) => {
          expect(frame.length).toBe(want[f].length);
          frame.forEach((v, j) => (worst = Math.max(worst, Math.abs(v - want[f][j]))));
        });
        expect(worst).toBe(0);
      }, 60_000);
  if (write) it('writes the golden file', () => writeFileSync(FILE, JSON.stringify(fresh)));
});
