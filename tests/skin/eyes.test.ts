import { Bone, Group, Raycaster, Vector3, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody, type BodyData } from '../../src/builder/build';
import { fox } from '../../src/cast/fox';
import { deer } from '../../src/cast/deer';
import { frog } from '../../src/cast/frog';
import { trout } from '../../src/cast/trout';
import type { Recipe } from '../../src/recipe/schema';
import { createEyes, lidAngles, type Eye } from '../../src/skin/eyes';

const deg = Math.PI / 180;
// coarse bodies, built once on first use (inside a test, under its timeout): only their skeletons matter here
const once = <T>(make: () => T) => { let v: T | undefined; return () => (v ??= make()); };
const foxBody = once(() => buildBody(fox, [2])), frogBody = once(() => buildBody(frog, [2]));
/** The timeout for a test that builds a body. */
const BUILD = 30_000;

/** Bones at their rest positions under a root group (as createCreatureObject places them), with eyes on them. */
function eyesOf(body: BodyData, recipe: Recipe, tint?: Vector3): { root: Group; eyes: Eye[] } {
  const defs = body.skeleton.bones, bones = defs.map(() => new Bone()), root = new Group();
  defs.forEach((d, i) => {
    if (d.parent < 0) (bones[i].position.set(d.start.x, d.start.y, d.start.z), root.add(bones[i]));
    else {
      const p = defs[d.parent].start;
      bones[i].position.set(d.start.x - p.x, d.start.y - p.y, d.start.z - p.z);
      bones[d.parent].add(bones[i]);
    }
  });
  const eyes = createEyes(body, recipe, bones, tint);
  root.updateMatrixWorld(true);
  return { root, eyes };
}

/** What a ray from the eye's centre straight out along its gaze (local +z) hits among its lids. */
function forwardHits(e: Eye, root: Group) {
  root.updateMatrixWorld(true);
  const from = e.getWorldPosition(new Vector3()), dir = e.getWorldDirection(new Vector3());
  return new Raycaster(from, dir).intersectObjects(e.lids as Mesh[], false);
}

describe('lidAngles', () => {
  it('opens the upper rim to +50° and the lower to −55°, and shuts both at −35°, moving steadily between', () => {
    const open = lidAngles(0), shut = lidAngles(1);
    expect(open.upper).toBeCloseTo(50 * deg, 9);
    expect(open.lower).toBeCloseTo(-55 * deg, 9);
    expect(shut.upper).toBeCloseTo(-35 * deg, 9);
    expect(shut.lower).toBeCloseTo(-35 * deg, 9);
    let prev = open;
    for (let k = 1; k <= 20; k++) {
      const a = lidAngles(k / 20);
      expect(a.upper).toBeLessThan(prev.upper);
      expect(a.lower).toBeGreaterThan(prev.lower);
      expect(a.upper).toBeGreaterThanOrEqual(a.lower - 1e-12);
      prev = a;
    }
  });
});

describe('eyelids', () => {
  const tint = new Vector3(0.9, 1, 1.1);
  const lidded = once(() => eyesOf(foxBody(), fox, tint));

  it('gives each eye an upper and a lower lid, children of the eyeball, sharing one material, casting no shadow', () => {
    const { eyes } = lidded();
    expect(eyes.length).toBe(2);
    const mats = new Set<unknown>();
    for (const e of eyes) {
      expect(e.lids).toHaveLength(2);
      for (const l of e.lids) {
        expect(l.parent).toBe(e);
        expect(l.castShadow).toBe(false);
        expect(l.userData.tint).toBe(tint);
        mats.add(l.material);
      }
      // where the open lids overlap (behind the eye) the lower lies just inside the upper, never on the same surface
      expect(e.lids[1].scale.x).toBeLessThan(0.99 * e.lids[0].scale.x);
    }
    expect(mats.size).toBe(1);
  }, BUILD);

  it('covers the pupil when shut and leaves it clear when open', () => {
    const { root, eyes } = lidded();
    for (const e of eyes) {
      e.blink(1);
      expect(forwardHits(e, root).length).toBeGreaterThan(0);
      e.blink(0);
      expect(forwardHits(e, root)).toHaveLength(0);
      e.blink(0.45);
      expect(forwardHits(e, root)).toHaveLength(0); // half shut: the pupil still peeks out
    }
  }, BUILD);

  it('no longer squashes the eyeball to blink', () => {
    const e = lidded().eyes[0];
    e.blink(0);
    const s = e.scale.clone();
    e.blink(1);
    expect(e.scale.equals(s)).toBe(true);
    e.blink(0);
  }, BUILD);
});

describe('an upturned eye', () => {
  it('keeps its upper lid on top: the eye looks along its bone, its local up as near the body up as can be', () => {
    const { eyes } = eyesOf(frogBody(), frog);
    const defs = frogBody().skeleton.bones.filter((d) => d.role === 'eye');
    expect(eyes.length).toBe(defs.length);
    eyes.forEach((e, k) => {
      const d = defs[k], dir = new Vector3(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z).normalize();
      const z = new Vector3(0, 0, 1).applyQuaternion(e.quaternion), y = new Vector3(0, 1, 0).applyQuaternion(e.quaternion);
      expect(z.distanceTo(dir)).toBeLessThan(1e-9);
      expect(y.y).toBeCloseTo(Math.sqrt(1 - dir.y * dir.y), 9); // the most up a direction across the gaze can be
    });
    expect(defs.some((d) => d.end.y - d.start.y > 0.5 * Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z))).toBe(true);
  }, BUILD);

  it('opens its lower lid wider (seen from the side it would look half shut), and still shuts at −35°', () => {
    const { eyes } = eyesOf(frogBody(), frog);
    // the lower lid is the cap turned over, then turned −e about x: its rim's elevation is −rotation.x
    const lowerRim = (e: Eye) => -e.lids[1].rotation.x;
    for (const e of eyes) {
      e.blink(0);
      expect(lowerRim(e)).toBeLessThan(-70 * deg);
      e.blink(1);
      expect(lowerRim(e)).toBeCloseTo(-35 * deg, 9);
      e.blink(0);
    }
    // a level eye keeps the plain angles
    const fe = eyesOf(foxBody(), fox).eyes[0];
    fe.blink(0);
    expect(lowerRim(fe)).toBeCloseTo(-55 * deg, 9);
    expect(-fe.lids[0].rotation.x).toBeCloseTo(50 * deg, 9);
  }, BUILD);
});

describe('pupils after the turn', () => {
  /** The eye's local axes in creature space (the rest pose: bones unturned). */
  const axes = (e: Eye) => ({ x: new Vector3(1, 0, 0).applyQuaternion(e.quaternion), y: new Vector3(0, 1, 0).applyQuaternion(e.quaternion) });
  it("stand a fox's slit upright (its long axis, local y, as near vertical as the gaze allows) and lay a deer's bar level", () => {
    expect(fox.skin.eyes.pupil).toBe('slit');
    expect(deer.skin.eyes.pupil).toBe('bar');
    for (const e of eyesOf(foxBody(), fox).eyes) {
      const { x, y } = axes(e), z = e.getWorldDirection(new Vector3());
      expect(y.y).toBeCloseTo(Math.sqrt(1 - z.y * z.y), 9);
      expect(x.y).toBeCloseTo(0, 9);
    }
    for (const e of eyesOf(buildBody(deer, [2]), deer).eyes) expect(axes(e).x.y).toBeCloseTo(0, 9); // the bar's long axis is local x
  }, BUILD);
});

describe('a fish', () => {
  it('has no lids, and blinking leaves its eyes as they are', () => {
    const { eyes } = eyesOf(buildBody(trout, [2]), trout);
    expect(eyes.length).toBeGreaterThan(0);
    for (const e of eyes) {
      expect(e.lids).toHaveLength(0);
      expect(e.children).toHaveLength(0);
      const s = e.scale.clone();
      e.blink(1);
      expect(e.scale.equals(s)).toBe(true);
    }
  }, BUILD);
});
