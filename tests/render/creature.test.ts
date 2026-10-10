import { Quaternion, Vector3, type Material, type Object3D, type SkinnedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody, individualVariation } from '../../src/builder/build';
import { createCreatureObject, type CreatureObject } from '../../src/render/creature';
import { fox } from '../../src/cast/fox';
import { cross, dot, norm, sub, type Vec3 } from '../../src/util/vec';
import { jawWeight } from '../fixtures/jaw';
import { blob, quadruped } from '../fixtures/recipes';

// two coarse levels of detail are enough: the first gets 12 fur shells on High, the second 6
const body = buildBody(quadruped, [2, 2]);
const bones = body.skeleton.bones;
const variation = (seed: number) => individualVariation(quadruped, seed, bones.length, bones.map((b) => b.partId));
const shells = (o: CreatureObject) => o.root.children.filter((c): c is SkinnedMesh => c.name.startsWith('fur'));
const disposed = (m: Material) => {
  let gone = false;
  m.addEventListener('dispose', () => (gone = true));
  return () => gone;
};

describe('the creature geometry', () => {
  it('has exactly 8 vertex attributes (the WebGPU limit), the last the feature marks', () => {
    const g = createCreatureObject(body, quadruped, 'high').meshes[0].geometry;
    expect(Object.keys(g.attributes).sort()).toEqual(['bodyPos', 'feature', 'normal', 'partInfo', 'position', 'restNormal', 'skinIndex', 'skinWeight']);
    expect(g.attributes.feature.itemSize).toBe(4);
    expect(g.attributes.feature.array).toBe(body.lods[0].feature);
  });
});

describe('createCreatureObject with a shared look', () => {
  it('shares the species materials, with each animal its own tint', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const b = createCreatureObject(body, quadruped, 'high', variation(2), a.look);
    expect(b.look).toBe(a.look);
    expect(b.meshes[0].material).toBe(a.meshes[0].material);
    expect(shells(b)[0].material).toBe(shells(a)[0].material);
    const tint = (o: Object3D) => o.userData.tint as Vector3;
    expect(tint(a.meshes[0])).toBeDefined();
    expect(tint(b.meshes[0]).equals(tint(a.meshes[0]))).toBe(false);
    for (const s of shells(b)) expect(tint(s)).toBe(tint(b.meshes[0])); // fur takes the animal's tint too
    // the eyelids: one material for the species, each animal's own tint
    expect(a.look.lids).not.toBeNull();
    for (const e of b.eyes) for (const l of e.lids) {
      expect(l.material).toBe(a.look.lids);
      expect(tint(l)).toBe(tint(b.meshes[0]));
    }
  });

  it('draws every fur shell with one material, each at its own height', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const s = shells(a);
    expect(s).toHaveLength(12 + 6);
    expect(new Set(s.map((x) => x.material)).size).toBe(1);
    expect(s[0].material).toBe(a.look.fur);
    const near = s.slice(0, 12).map((x) => x.userData.shellT as number);
    expect(new Set(near).size).toBe(12);
    near.forEach((t, i) => i && expect(t).toBeGreaterThan(near[i - 1]));
    expect(near[11]).toBeCloseTo(1, 10);
  });

  it('leaves shared materials alive when a borrower goes, and frees them with their owner', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const b = createCreatureObject(body, quadruped, 'high', variation(2), a.look);
    const skinGone = disposed(a.look.skin), furGone = disposed(a.look.fur!), lidsGone = disposed(a.look.lids!);
    b.dispose();
    expect(skinGone()).toBe(false);
    expect(furGone()).toBe(false);
    expect(lidsGone()).toBe(false);
    a.dispose();
    expect(skinGone()).toBe(true);
    expect(furGone()).toBe(true);
    expect(lidsGone()).toBe(true);
  });
});

describe('the jaw', () => {
  const fb = buildBody(fox, [0]), m = fb.mouth!, lod = fb.lods[0], P = lod.positions, n = P.length / 3, jaw = fb.skeleton.jaw;
  const H = fb.skeleton.bones[m.head], rH = Math.max(H.r0, H.r1), L = Math.hypot(m.tip.x - m.hinge.x, m.tip.y - m.hinge.y, m.tip.z - m.hinge.z);
  const obj = createCreatureObject(fb, fox, 'low');
  /** Every LOD0 vertex skinned on the CPU in the current pose (creature space). */
  const skinned = () => {
    obj.root.updateMatrixWorld(true);
    obj.skeleton.update();
    const out = new Float32Array(P.length), v = new Vector3();
    for (let i = 0; i < n; i++) out.set(obj.meshes[0].getVertexPosition(i, v).toArray(), i * 3);
    return out;
  };
  const rel = (A: Float32Array, v: number): Vec3 => sub({ x: A[v * 3], y: A[v * 3 + 1], z: A[v * 3 + 2] }, m.hinge);
  const open = (theta: number) => obj.jaw!.open(theta);

  it('is exposed: its bone raised to shut, and an axis that drops the chin when turned by a positive angle', () => {
    expect(obj.jaw).not.toBeNull();
    expect(obj.jaw!.bone).toBe(obj.bones[jaw]);
    const a = obj.jaw!.axis, want = norm(cross(m.up, m.forward));
    expect(a.x).toBeCloseTo(want.x, 6); expect(a.y).toBeCloseTo(want.y, 6); expect(a.z).toBeCloseTo(want.z, 6);
    const tip = new Vector3(m.forward.x, m.forward.y, m.forward.z).applyQuaternion(new Quaternion().setFromAxisAngle(a, 0.1));
    expect(tip.dot(new Vector3(m.up.x, m.up.y, m.up.z))).toBeLessThan(0);
    // the rest pose: unturned, raised by jawLift along the mouth's up from where the skeleton puts it
    const H = fb.skeleton.bones[m.head];
    expect(obj.jaw!.bone.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-12);
    const rest = new Vector3(m.hinge.x - H.start.x, m.hinge.y - H.start.y, m.hinge.z - H.start.z).addScaledVector(new Vector3(m.up.x, m.up.y, m.up.z), fb.jawLift);
    expect(obj.jaw!.shut.distanceTo(rest)).toBeLessThan(1e-9);
    expect(obj.jaw!.bone.position.distanceTo(rest)).toBeLessThan(1e-9);
  });

  it('shuts the mouth at rest: the lower lip meets the upper all along the slit', () => {
    open(0);
    const S = skinned();
    const h = m.halfThick, gaps: number[] = [];
    for (let v = 0; v < n; v++) {
      const q = rel(P, v), u = dot(q, m.up), f = dot(q, m.forward), nu = lod.normals[v * 3] * m.up.x + lod.normals[v * 3 + 1] * m.up.y + lod.normals[v * 3 + 2] * m.up.z;
      // the slit's lower face (facing up into it), from near the corners to the tip
      if (jawWeight(lod, jaw, v) < 0.5 || u > -0.4 * h || u < -1.6 * h || f < 0.15 * L || f > 0.95 * L || nu < 0.5) continue;
      gaps.push(h - dot(rel(S, v), m.up)); // how far below the upper face (at +h) it still is
    }
    expect(gaps.length).toBeGreaterThan(20); // the parted lips: the front of the mouth (the cheeks close the rest)
    gaps.sort((a, b) => a - b);
    expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(0.25 * h); // was 2h: the bind pose's carved slot
    expect(gaps[Math.floor(gaps.length * 0.95)]).toBeLessThan(0.5 * h); // about half a fine cell: a lip line, not a slot
  });

  it('opens: turning the jaw down 0.4 rad drops the chin and leaves the forehead still, with no stretched spikes', () => {
    open(0);
    const shut = skinned();
    open(0.4);
    const opened = skinned();
    open(0);
    let chin = 0, brow = 0;
    for (let v = 0; v < n; v++) {
      const q = rel(P, v), f = dot(q, m.forward), j = jawWeight(lod, jaw, v);
      const drop = dot(rel(opened, v), m.up) - dot(rel(shut, v), m.up);
      if (j > 0.95 && f > 0.5 * L) { chin++; expect(drop).toBeLessThan(-0.25 * f); }
      if (fb.skeleton.bones[lod.boneOf[v]].role === 'head' && dot(q, m.up) > 0.5 * rH && j === 0) {
        brow++;
        expect(Math.hypot(opened[v * 3] - shut[v * 3], opened[v * 3 + 1] - shut[v * 3 + 1], opened[v * 3 + 2] - shut[v * 3 + 2])).toBeLessThan(1e-6);
      }
    }
    expect(chin).toBeGreaterThan(20);
    expect(brow).toBeGreaterThan(20);
    // no stretched spikes: nothing pulls far, but the mouth's own skin (the lips and the cheeks' lip line, marked at both
    // ends), which stretches by design into the open mouth's dark inside, and only about as far as the mouth opens
    const I = lod.indices, d = (A: Float32Array, a: number, b: number) => Math.hypot(A[a * 3] - A[b * 3], A[a * 3 + 1] - A[b * 3 + 1], A[a * 3 + 2] - A[b * 3 + 2]);
    const lip = (v: number) => lod.feature[v * 4 + 2] >= 0.5; // (where the lip colour starts)
    let grow = 0, lips = 0;
    for (let t = 0; t < I.length; t += 3)
      for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) {
        const g = d(opened, a, b) - d(shut, a, b);
        if (lip(a) && lip(b)) lips = Math.max(lips, g); else grow = Math.max(grow, g);
      }
    expect(grow).toBeLessThan(0.2 * rH);
    expect(lips).toBeLessThan(0.4 * L); // the lips part by 0.4 L at the tip
  });
});

describe('a body without a head', () => {
  it('has no jaw', () => {
    expect(createCreatureObject(buildBody(blob, [2]), blob, 'low').jaw).toBeNull();
  });
});
