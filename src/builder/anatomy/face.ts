import type { Face, Recipe } from '../../recipe/schema';
import { add, cross, dot, lerp, norm, scale, sub, v3, type Vec3 } from '../../util/vec';
import { thinAxis, tipRadius } from '../sdf';
import type { BoneDef, Skeleton } from '../skeleton';
import { boneFrame, feature, shapeSize, type Feature, type Frame, type Shape } from './shapes';
import type { Detail } from '.';

/** Where the mouth opens: the hinge (mouth corners' midpoint), the tip, and the slit's plane. */
export type MouthFrame = { hinge: Vec3; tip: Vec3; forward: Vec3; up: Vec3; side: Vec3; halfThick: number; head: number /* head bone */; mouth: number /* front mouth bone or -1 */ };

const R = (b: BoneDef) => Math.max(b.r0, b.r1);
const length = (b: BoneDef) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y, b.end.z - b.start.z);

/**
 * A head's frame: the bone frame, its up kept on the dorsal side (the top, or the back of the skull). The bone
 * frame's up is world up made perpendicular, which turns to the face for a head leaning backward from upright.
 */
export function headFrame(h: BoneDef): Frame {
  const f = boneFrame(h);
  return f.a.z < 0 ? { a: f.a, up: scale(f.up, -1), side: scale(f.side, -1) } : f;
}

/**
 * A frame along `a` with `up` made perpendicular to it (side = up × a). When `a` is parallel to `up`, up falls back to
 * backward (−z), then to +x, made perpendicular (as boneFrame does for an exactly vertical bone).
 */
export function frameAlong(a: Vec3, up: Vec3): Frame {
  let t = v3();
  for (const r of [up, v3(0, 0, -1), v3(1, 0, 0)]) {
    t = sub(r, scale(a, dot(r, a)));
    if (Math.hypot(t.x, t.y, t.z) > 1e-6) break;
  }
  const u = norm(t);
  return { a, up: u, side: norm(cross(u, a)) };
}

const descends = (sk: Skeleton, i: number, from: number) => { for (let p = sk.bones[i].parent; p >= 0; p = sk.bones[p].parent) if (p === from) return true; return false; };

/**
 * The head bone H, its frame, the front mouth bone M (−1), the muzzle frame (along M), the tip T and its radius rn.
 * T is the front of the tip's surface: the bone's end is its round cap's centre, where nose shapes would sit inside
 * the head (and carves there would leave sealed pockets).
 */
function head(sk: Skeleton) {
  const h = sk.bones.findIndex((b) => b.role === 'head');
  if (h < 0) return null;
  const H = sk.bones[h], f = headFrame(H), rH = R(H);
  let m = -1;
  sk.bones.forEach((b, i) => { if (b.role === 'mouth' && descends(sk, i, h) && (m < 0 || b.end.z > sk.bones[m].end.z)) m = i; });
  const M = m >= 0 ? sk.bones[m] : null;
  const muzzle = M ? frameAlong(norm(sub(M.end, M.start)), f.up) : f;
  const T = M ? add(M.end, scale(muzzle.a, tipRadius(M))) : add(H.end, scale(f.a, tipRadius(H)));
  return { h, H, f, rH, m, M, muzzle, T, rn: M ? Math.max(M.r1, 0.35 * M.r0) : 0.35 * rH };
}

/**
 * The mouth's frame (Task 10 hangs the jaw on it); null without a head bone. Forward runs from the hinge to the tip, so
 * the slit's plane holds both (along the mouth bone instead, a down-turned muzzle's slit cuts under the eye and shaves
 * the chin to a blade); up is the head's, made perpendicular.
 */
export function mouthFrame(sk: Skeleton, face: Face, detail: Detail): MouthFrame | null {
  const hd = head(sk);
  if (!hd) return null;
  const { h, H, M, m, f, muzzle, T, rn, rH } = hd;
  const tip = face.nose === 'beak' || face.nose === 'bill' ? T : sub(T, scale(muzzle.up, 0.35 * rn)); // mandibles meet on the axis
  const mid = lerp(H.start, H.end, 0.55);
  // on the head's centre plane, below the eyes
  const hinge = sub(mid, scale(f.up, 0.3 * rH));
  hinge.x = mid.x;
  const { a: forward, up, side } = frameAlong(norm(sub(tip, hinge), f.a), f.up);
  const halfThick = Math.max(0.035 * (M ? R(M) : rH), 1.1 * detail.cell);
  return { hinge, tip, forward, up, side, halfThick, head: h, mouth: m };
}

/** Where a thin ear's inner-ear mark starts, in base radii up the ear from its (buried) start. */
const EAR_CUT = 0.5;
const ellipsoid = (c: Vec3, ax: [Vec3, Vec3, Vec3], r: Vec3): Shape => ({ type: 'ellipsoid', c, ax, r });
const sphere = (c: Vec3, r: number): Shape => ({ type: 'ellipsoid', c, ax: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)], r: v3(r, r, r) });
const cone = (a: Vec3, b: Vec3, r0: number, r1: number): Shape => ({ type: 'cone', a, b, r0, r1 });
/** p + Σ dᵢ·sᵢ */
const at = (p: Vec3, ...terms: [Vec3, number][]) => terms.reduce((q, [d, s]) => add(q, scale(d, s)), p);

/** The shapes that sculpt a face: skull, sockets, brows, cheeks, muzzle creases, nose, mouth slit and ear cups. */
export function faceFeatures(sk: Skeleton, recipe: Pick<Recipe, 'build' | 'face' | 'skin'>, detail: Detail): Feature[] {
  const hd = head(sk);
  if (!hd) return [];
  const out: Feature[] = [];
  const push = (f: Feature) => { if (shapeSize(f.shape) >= 2 * detail.cell) out.push(f); };
  const { h, H, f, rH, M, m, muzzle, T, rn } = hd, { a, up, side } = f, cell = detail.cell;
  const nose = recipe.face.nose, brow = recipe.face.brow, muscle = recipe.build.muscle;

  // 1. cranium: the braincase, over the back of the head (as thin as the head across its squashed axis: a trout's, a frog's)
  const thin = thinAxis(H), sideThin = Math.abs(dot(thin, side)) >= Math.abs(dot(thin, up));
  const [sq, uq] = H.squash < 0.999 ? (sideThin ? [H.squash, 1] : [1, H.squash]) : [1, 1];
  push(feature('add', ellipsoid(at(lerp(H.start, H.end, 0.3), [up, 0.25 * rH * uq]), [a, side, up], v3(0.45 * length(H), 0.85 * rH * sq, 0.75 * rH * uq)), 0.5 * rH, { name: 'cranium', bone: h }));

  // per eye: socket, brow, cheek (eyeballs placed as src/skin/eyes.ts places them)
  sk.bones.forEach((E, i) => {
    if (E.role !== 'eye' || !descends(sk, i, h)) return;
    const d = sub(E.end, E.start), le = Math.hypot(d.x, d.y, d.z), o = norm(d);
    const c = add(E.start, scale(o, le / 2)), re = R(E) * recipe.skin.eyes.size;
    // 2. socket: the eyeball fills it, the lids (Task 11) sit in it
    push(feature('carve', sphere(at(c, [o, 0.35 * re]), 1.2 * re), 0.4 * re, { name: 'socket', bone: i }));
    // 3. brow: a ridge along the socket's upper rim (lower, the socket carves it to a loose shelf); none over an eye
    // that looks up (a frog's: it would stand as a knob behind it)
    if (brow >= 0.05 && dot(o, up) < 0.5) {
      const bf = frameAlong(o, up), across = norm(cross(bf.up, o));
      push(feature('add', ellipsoid(at(c, [bf.up, 1.2 * re], [o, -0.3 * re]), [across, bf.up, o], v3(1.2 * re, 0.35 * re * (0.5 + brow), 0.45 * re * (0.5 + brow))), 0.3 * re, { name: 'brow', bone: i }));
    }
    // 4. cheek: under and behind the eye (not on beaks and bills)
    if (nose === 'pad' || nose === 'slits' || nose === 'none') {
      const s = 0.6 + 0.4 * muscle;
      push(feature('add', ellipsoid(at(c, [up, -1.2 * re], [a, -0.5 * re], [o, -0.3 * re]), [a, side, up], v3(1.3 * re * s, 0.9 * re * s, 0.8 * re * s)), 0.6 * re, { name: 'cheek', bone: i }));
    }
    // 5. muzzle crease: from under the eye to the side of the nose
    if (nose === 'pad' && M && 0.05 * M.r0 >= cell) {
      const sgn = dot(sub(c, H.start), muzzle.side) >= 0 ? 1 : -1;
      const to = at(T, [muzzle.a, -0.5 * rn], [muzzle.up, 0.4 * rn], [muzzle.side, sgn * 0.5 * rn]);
      const r = Math.max(0.05 * M.r0, cell);
      out.push(feature('carve', cone(at(c, [up, -0.6 * re], [a, 0.6 * re]), to, r, r), 0.04 * M.r0, { name: 'crease', bone: i }));
    }
  });

  // 6. nose
  const { a: na, up: nu, side: ns } = muzzle;
  if (nose === 'pad') {
    push(feature('add', ellipsoid(at(T, [nu, 0.2 * rn]), [na, ns, nu], v3(0.55 * rn, 0.85 * rn, 0.6 * rn)), 0.3 * rn, { mark: 'nose', markBand: 0.25 * rn, name: 'nose', bone: m >= 0 ? m : h }));
    if (0.2 * rn >= 1.5 * cell)
      for (const s of [-1, 1]) out.push(feature('carve', sphere(at(T, [na, 0.35 * rn], [ns, s * 0.38 * rn], [nu, 0.15 * rn]), 0.2 * rn), 0.08 * rn, { mark: 'nose', markBand: 0.1 * rn, name: 'nostril', bone: m >= 0 ? m : h }));
    if (0.07 * rn >= 0.7 * cell) {
      const r = Math.max(0.07 * rn, cell);
      out.push(feature('carve', cone(at(T, [nu, -0.15 * rn], [na, 0.3 * rn]), at(T, [nu, -0.8 * rn], [na, 0.2 * rn]), r, r), 0.5 * r, { name: 'philtrum', bone: m >= 0 ? m : h }));
    }
  } else if ((nose === 'beak' || nose === 'bill') && M) {
    const rM = R(M), lM = length(M);
    if (nose === 'beak') {
      // at least a cell thick at its root and 0.75 of a cell at its tip (as a talon's): thinner, the mesh drops it or
      // breaks it into shards
      const r0 = Math.max(0.45 * rn, cell), r1 = Math.max(0.06 * rn, 0.75 * cell);
      out.push(feature('add', cone(at(T, [na, -0.2 * rn]), at(T, [na, 0.6 * rn], [nu, -0.9 * rn]), r0, r1), 0.2 * rn, { name: 'hook', bone: m }));
    } else push(feature('add', ellipsoid(lerp(M.start, M.end, 0.6), [na, ns, nu], v3(0.55 * lM, 1.25 * rM, 0.35 * rM)), 0.3 * M.r0, { name: 'bill', bone: m }));
    if (0.12 * M.r0 >= 1.5 * cell)
      for (const s of [-1, 1]) out.push(feature('carve', sphere(at(M.start, [na, 0.3 * lM], [nu, 0.6 * M.r0], [ns, s * 0.4 * M.r0]), 0.12 * M.r0), 0.05 * M.r0, { mark: 'nose', markBand: 0.06 * M.r0, name: 'nostril', bone: m }));
  } else if (nose === 'slits' && 0.08 * rn >= 0.7 * cell) {
    const r = Math.max(0.08 * rn, cell);
    for (const s of [-1, 1]) {
      // from inside the head out through the skin (the tip's surface curves back from T, so p sits just outside it)
      const p = at(T, [nu, 0.4 * rn], [ns, s * 0.3 * rn]);
      out.push(feature('carve', cone(at(p, [na, -0.25 * rn]), p, r, r), 0.5 * r, { mark: 'nose', markBand: r, name: 'slit', bone: m >= 0 ? m : h }));
    }
  }

  // 7. mouth slit: a thin slab from the corners to past the tip (Task 10's jaw opens along it); it stops at the hinge,
  // so the lower jaw stays joined to the head behind it
  const mf = mouthFrame(sk, recipe.face, detail)!, L = Math.hypot(mf.tip.x - mf.hinge.x, mf.tip.y - mf.hinge.y, mf.tip.z - mf.hinge.z);
  const rM = M ? R(M) : rH;
  // the lower jaw under a muzzle: a round cone just below the slit, so a thin muzzle's chin is not shaved to a blade
  // whose tip crumbles off (a head without a muzzle bone has its own bulk under the slit)
  if (M) {
    const cf = Math.max(0.3 * rn, 1.2 * cell), cb = Math.max(0.35 * rH, cf), below = (r: number) => -(mf.halfThick + r);
    out.push(feature('add', cone(at(mf.hinge, [mf.up, below(cb)]), at(mf.tip, [mf.up, below(cf)], [mf.forward, -cf]), cb, cf), 0.5 * cf, { name: 'chin', bone: m }));
  }
  // (a slab of even thickness: an ellipsoid thins to nothing towards its rim, and a slit thinner than a cell breaks into
  // sealed pockets and loose shards)
  out.push(feature('carve', { type: 'slab', c: at(lerp(mf.hinge, mf.tip, 0.5), [mf.forward, 0.15 * L]), ax: [mf.forward, mf.side, mf.up], r: v3(0.62 * L, 1.4 * Math.max(rM, 0.8 * rH), mf.halfThick) },
    0.5 * mf.halfThick, { mark: 'mouth', markBand: 3 * mf.halfThick, name: 'mouth', bone: m >= 0 ? m : h }));

  // 8. ear cups: a hollow in each flat ear's front, or only a front mark where the ear is too thin to hollow
  sk.bones.forEach((E, i) => {
    if (E.role !== 'ear' || E.squash >= 0.8) return;
    const t = thinAxis(E), ea = norm(sub(E.end, E.start)), rmid = (E.r0 + E.r1) / 2, hth = rmid * E.squash;
    if (hth < 1.5 * cell) {
      // the ear's round cone (as wide as the ear all along it) trimmed to the squashed ear's thickness (a round cone alone
      // reaches r0 into the head all round the base: the forehead took the mark) and cut half a base radius up from the
      // buried start (below it the cone runs on through the head, and beside the root lies head skin; the crotch between
      // two close ears too). Inside, it holds the whole ear, so the front face is marked (facing keeps the colour off the
      // back); the band only softens the edges. (A slab's ellipse bulges past a tapering ear and runs on below the base.)
      const th = E.r0 * E.squash, cut = (p: Vec3, n: Vec3) => ({ p, n });
      out.push(feature('mark', cone(E.start, E.end, E.r0, E.r1), 0, {
        mark: 'earInner', markBand: hth, facing: t, name: 'earCup', bone: i,
        cuts: [cut(at(E.start, [t, th]), scale(t, -1)), cut(at(E.start, [t, -th]), t), cut(at(E.start, [ea, EAR_CUT * E.r0]), ea)],
      }));
      return;
    }
    out.push(feature('carve', ellipsoid(at(lerp(E.start, E.end, 0.5), [t, 1.6 * hth]), [ea, norm(cross(t, ea)), t], v3(0.38 * length(E), 0.55 * rmid, 1.4 * hth)),
      0.3 * hth, { mark: 'earInner', markBand: 0.6 * hth, facing: t, name: 'earCup', bone: i }));
  });
  return out;
}
