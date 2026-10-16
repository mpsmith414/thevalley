/** Where a released creature arrives: its home, the release camera and where the family walks in from (spec §5). */
import { surfaceAt } from '../camera/freefly';
import { mediumOf } from '../motion/medium';
import type { Recipe } from '../recipe/schema';
import { VALLEY } from '../valley/layout';
import type { HomeRange, Pt, Viewpoint } from '../valley/types';
import type { Valley } from '../valley/valley';

export type Medium = HomeRange['medium'];
export { mediumOf };

const STEP = 4;
/** How much meadow a flier's spot wants under it (and a home on open ground, when there is one near). */
const MEADOW = 0.4;
/** Open ground (arrival v2): no trunk this close (m) to a home's centre, looked for this far (m) before the old passes. */
const OPEN = 12, OPEN_REACH = 150;
const LAND_RADIUS = 40, WATER_RADIUS = 25;
const DISC = 30, DISC_SAMPLES = 16, DISC_RING = 20, DISC_DRY = 0.6;
const MAX_SLOPE = (25 * Math.PI) / 180;
const TWO_PI = Math.PI * 2;
/**
 * The release camera is 12 m back and 4 m up; the family starts 18 m to the side of where it looks (Ruling R6: just out
 * of view, so the first of them walks into the picture within about 3 s of the glide ending; at 25 m it took about 8 s).
 */
const BACK = 12, UP = 4, SIDE = 18;
/**
 * Arrival v2: the glide ends on a wider, higher framing, then the camera pushes in to a close one sized to the creature
 * (`shotSize`; 12 m / 4 m at most, 18 m / 6.5 m wide). Its bearing is the first clear one of every 30° round the home,
 * the eye's side first.
 */
const WIDE_BACK = 18, TURN = Math.PI / 6;
/** The close framing is this many body lengths back (clamped), a third of that up (clamped); the wide one 1.5× and 1.6× those. */
const CLOSE_LENGTHS = 7, CLOSE_BACK = [5, BACK] as const, CLOSE_UP = [2, UP] as const, WIDE_K = 1.5, WIDE_UP_K = 1.6;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
/**
 * Tree crowns are not queryable (the valley keeps trunks only, as x, z, r), so a trunk-only check with a generous radius
 * stands in for them: a sight line passing within this many metres of a trunk's bark is blocked.
 */
const CROWN = 2.5;
/** Heights (m above the ground or water) the sight lines aim at: a walker or swimmer, and a flier coming in low (3 m). */
const TARGET_H = 0.5, FLIER_H = 3;
/** The walk on (arrival v2): this far (m) from the home's centre, away from the camera, each tried at these bearings. */
const ONWARD = [30, 25, 35, 20, 40], ONWARD_TURN = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05];
/** An open place to walk on to: no trunk this close (m) to the lead's point (looked for first, a little further round). */
const ONWARD_OPEN = 12, OPEN_TURN = [...ONWARD_TURN, 1.4, -1.4];
/** Half the vertical field of view of the valley's 55° camera and its 16:9 half-width, plus 3° so nobody pops in at the edge. */
const HALF_V = (55 / 2) * (Math.PI / 180), HALF_H = Math.atan(Math.tan(HALF_V) * (16 / 9)), MARGIN = (3 * Math.PI) / 180;

/** Candidate points on a ring, nearest the facing direction first (so a spiral prefers what the camera sees). */
function* ring(c: Pt, r: number, facing: number, maxOff = Math.PI): Generator<Pt> {
  const n = Math.max(1, Math.ceil((TWO_PI * r) / STEP));
  for (let j = 0; j < n; j++) {
    const off = Math.ceil(j / 2) * (TWO_PI / n) * (j % 2 ? 1 : -1);
    if (Math.abs(off) > maxOff + 1e-9) continue;
    const a = facing + off;
    yield { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
  }
}

/** Dry, inside the valley, gentle, off trunks, with a 30 m disc that is mostly dry (checked on a ring of 16 samples). */
function landSpot(v: Valley, p: Pt): boolean {
  if (!v.inside(p.x, p.z, DISC) || v.isWater(p.x, p.z)) return false;
  if (Math.acos(Math.min(1, v.normalAt(p.x, p.z).y)) >= MAX_SLOPE) return false;
  if (v.trunksNear(p.x, p.z, 2).length) return false;
  let dry = 0;
  for (let k = 0; k < DISC_SAMPLES; k++) {
    const a = (k / DISC_SAMPLES) * TWO_PI;
    if (!v.isWater(p.x + Math.cos(a) * DISC_RING, p.z + Math.sin(a) * DISC_RING)) dry++;
  }
  return dry >= DISC_SAMPLES * DISC_DRY;
}

const deepWater = (v: Valley, p: Pt) => v.inside(p.x, p.z, DISC) && v.waterDepthAt(p.x, p.z) >= 2;

/** The first valid point on rings of growing radius from `c`, `facing` first; null when none within `to` metres. */
function spiral(c: Pt, from: number, to: number, facing: number, ok: (p: Pt) => boolean, maxOff = Math.PI): Pt | null {
  for (let r = from; r <= to + 1e-9; r += STEP) for (const p of ring(c, r, facing, maxOff)) if (ok(p)) return p;
  return null;
}

/** The first meadow's middle (or the valley's), the last place to look for a home. */
function meadowCentre(): Pt {
  const m = VALLEY.areas.find((a) => a.kind === 'meadow');
  if (!m) return { x: 0, z: 0 };
  return { x: m.points.reduce((s, p) => s + p.x, 0) / m.points.length, z: m.points.reduce((s, p) => s + p.z, 0) / m.points.length };
}

/** A home for a released creature (spec §5). Always returns a valid home: in front of the camera when possible. */
export function arrivalHome(valley: Valley, recipe: Recipe, id: string, eye: { x: number; y: number; z: number }, forward: { x: number; z: number }): HomeRange {
  const medium = mediumOf(recipe);
  const facing = Math.hypot(forward.x, forward.z) > 1e-6 ? Math.atan2(forward.z, forward.x) : -Math.PI / 2; // facing -z by default
  const e: Pt = { x: eye.x, z: eye.z };
  const home = (center: Pt, radius: number, m: Medium): HomeRange => ({ species: id, count: 3, center, radius, medium: m, prefer: [] });
  const reach = valley.size;

  if (medium === 'water') {
    const w = spiral(e, 0, reach, facing, (p) => deepWater(valley, p));
    if (w) return home(w, WATER_RADIUS, 'water');
  }
  // land and air (and a swimmer in a valley without deep water): ahead first, then anywhere nearby, then the meadow
  // a flier prefers a meadow (spec §5: "like land, over meadow"); if there is none to find, the land rules alone
  const ahead = (p: Pt) => (p.x - e.x) * forward.x + (p.z - e.z) * forward.z > 0;
  const meadow = (p: Pt) => valley.biomeAt(p.x, p.z).meadow >= MEADOW;
  const open = (p: Pt) => valley.trunksNear(p.x, p.z, OPEN).length === 0;
  const find = (ok: (p: Pt) => boolean) => {
    const pass = (extra: (p: Pt) => boolean) =>
      spiral(e, 25, 60, facing, (p) => extra(p) && ok(p) && ahead(p), Math.PI / 2 - 1e-6) ??
      spiral(e, 60, 400, facing, (p) => extra(p) && ok(p));
    // arrival v2: open ground first (trees hid the family), on a meadow if one is near; ahead, then within OPEN_REACH m
    const clearing = (extra: (p: Pt) => boolean, from: number, to: number, front: boolean) =>
      spiral(e, from, to, facing, (p) => extra(p) && open(p) && ok(p) && (!front || ahead(p)), front ? Math.PI / 2 - 1e-6 : Math.PI);
    const any = () => true;
    return clearing(meadow, 25, 60, true) ?? clearing(any, 25, 60, true) ?? clearing(meadow, 60, OPEN_REACH, false) ?? clearing(any, 60, OPEN_REACH, false) ??
      (medium === 'air' ? pass(meadow) : null) ?? pass(any);
  };
  const near = find((p) => landSpot(valley, p));
  const spot = near ?? spiral(meadowCentre(), 0, reach, facing, (p) => landSpot(valley, p)) ?? meadowCentre();
  return home(spot, LAND_RADIUS, medium === 'air' ? 'air' : 'land');
}

/** A framing of the home from bearing `a` (radians, from the centre), `back` m out and `up` m up, looking at the centre. */
const framing = (c: Pt, a: number, back: number, up: number): Viewpoint =>
  ({ name: 'arrival', pos: { x: c.x + Math.cos(a) * back, z: c.z + Math.sin(a) * back, h: up }, look: { x: c.x, z: c.z, h: 1 } });

/** The bearing (radians) from the home centre to the eye (+z when the eye is on the centre). */
const eyeBearing = (c: Pt, eye: { x: number; z: number }) => (Math.hypot(eye.x - c.x, eye.z - c.z) < 1e-6 ? Math.PI / 2 : Math.atan2(eye.z - c.z, eye.x - c.x));

/** Visit's framing (and the arrival's before v2): a Viewpoint 12 m back towards `eye` and 4 m up, looking at the home centre. */
export function arrivalView(home: HomeRange, eye: { x: number; z: number }): Viewpoint {
  return framing(home.center, eyeBearing(home.center, eye), BACK, UP);
}

/** The arrival's two framings on one bearing: the glide ends on `wide`, and the camera pushes in to `close`. */
export type ArrivalShot = { wide: Viewpoint; close: Viewpoint };

/**
 * Points along the sight line from a framing's eye to `h` m above the home centre (every metre) that a trunk (CROWN m
 * from its bark) or the ground blocks.
 */
export function sightBlockers(valley: Valley, view: Viewpoint, h: number): number {
  const a = { x: view.pos.x, y: surfaceAt(valley, view.pos.x, view.pos.z) + view.pos.h, z: view.pos.z };
  const b = { x: view.look.x, y: surfaceAt(valley, view.look.x, view.look.z) + h, z: view.look.z };
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  let count = 0;
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
    if (valley.trunksNear(x, z, CROWN).length || surfaceAt(valley, x, z) > y) count++;
  }
  return count;
}

/**
 * The arrival's framings for a creature `size` m long: the close one `back` m back and `up` m up (7 lengths back, a third
 * of that up, clamped to 5–12 m and 2–4 m, so a fox fills a good part of the picture), the wide one 1.5× back and
 * 1.6× up. From about 1.7 m long (and with no size) it is 12 m / 4 m and 18 m / 6.4 m.
 */
export function shotSize(size: number): { back: number; up: number; wideBack: number; wideUp: number } {
  const back = clamp(CLOSE_LENGTHS * size, CLOSE_BACK), up = clamp(back / 3, CLOSE_UP);
  return { back, up, wideBack: back * WIDE_K, wideUp: up * WIDE_UP_K };
}

/**
 * The arrival camera (arrival v2): round the home every 30°, the eye's side first, the first bearing from which both
 * framings see the family's height over the home clear of trunks and the ground (from inside the valley); if none is
 * clear, the least blocked.
 */
export function arrivalShot(valley: Valley, home: HomeRange, eye: { x: number; z: number }, size?: number): ArrivalShot {
  const c = home.center, from = eyeBearing(c, eye), h = home.medium === 'air' ? FLIER_H : TARGET_H;
  const z = shotSize(size ?? Infinity); // no size: the largest framing
  let best: ArrivalShot | null = null, fewest = Infinity;
  for (let j = 0; j < Math.round(TWO_PI / TURN); j++) {
    const a = from + Math.ceil(j / 2) * TURN * (j % 2 ? 1 : -1); // 0, +30°, -30°, +60°, … 180°
    const shot = { wide: framing(c, a, z.wideBack, z.wideUp), close: framing(c, a, z.back, z.up) };
    const outside = valley.inside(shot.wide.pos.x, shot.wide.pos.z, 10) ? 0 : 1000;
    const n = outside + sightBlockers(valley, shot.wide, h) + sightBlockers(valley, shot.close, h);
    if (n === 0) return shot;
    if (n < fewest) (fewest = n), (best = shot);
  }
  return best!;
}

/** The push-in's framing at `s` (0 at the glide's end, 1 once pushed in), eased at both ends; it always looks at the home. */
export function pushView(shot: ArrivalShot, s: number): Viewpoint {
  const k = Math.min(1, Math.max(0, s)), e = k * k * (3 - 2 * k);
  const { wide: w, close: c } = shot;
  return { name: 'arrival', pos: { x: w.pos.x + (c.pos.x - w.pos.x) * e, z: w.pos.z + (c.pos.z - w.pos.z) * e, h: w.pos.h + (c.pos.h - w.pos.h) * e }, look: { ...c.look } };
}

/**
 * Where the family walks on to once it reaches its spot (arrival v2): the lead 20–40 m from the home centre, away from
 * the camera at `view` (straight on first, then turning), by a way valid for the medium (dry for walkers, and as clear
 * of trunks as it can be; deep enough for swimmers), the others a step behind it, either side. Null when there is none.
 */
export function onwardPoints(valley: Valley, home: HomeRange, view: Viewpoint, count: number): Pt[] | null {
  const c = home.center, base = Math.atan2(c.z - view.pos.z, c.x - view.pos.x);
  const at = (p: Pt) => {
    if (!valley.inside(p.x, p.z, 10)) return false;
    if (home.medium === 'water') return valley.waterDepthAt(p.x, p.z) >= 0.5;
    return home.medium === 'air' || !valley.isWater(p.x, p.z);
  };
  /** Valid all the way, and (but for fliers) no trunk within `gap` m of it. */
  const way = (p: Pt, gap: number) => {
    const n = Math.ceil(Math.hypot(p.x - c.x, p.z - c.z) / 2);
    for (let i = 1; i <= n; i++) {
      const q = { x: c.x + ((p.x - c.x) * i) / n, z: c.z + ((p.z - c.z) * i) / n };
      if (!at(q) || (gap > 0 && home.medium !== 'air' && valley.trunksNear(q.x, q.z, gap).length)) return false;
    }
    return true;
  };
  const open = (p: Pt) => home.medium === 'air' || valley.trunksNear(p.x, p.z, ONWARD_OPEN).length === 0;
  // to open ground by an open way first (the camera follows close behind), then the most open way, a narrower one, any
  for (const [gap, clear] of [[3, true], [3, false], [1.5, false], [0, false]] as const) {
    for (const d of ONWARD) {
      for (const turn of clear ? OPEN_TURN : ONWARD_TURN) {
        const a = base + turn, ux = Math.cos(a), uz = Math.sin(a);
        const lead = { x: c.x + ux * d, z: c.z + uz * d };
        if ((clear && !open(lead)) || !way(lead, gap)) continue;
        // the others a step behind the lead, either side (on the lead's spot when theirs will not do)
        return Array.from({ length: count }, (_, k) => {
          if (k === 0) return lead;
          const side = k % 2 ? 2 : -2, back = 3 * Math.ceil(k / 2);
          const p = { x: lead.x - ux * back - uz * side, z: lead.z - uz * back + ux * side };
          return at(p) ? p : { ...lead };
        });
      }
    }
  }
  return null;
}

/**
 * True when an animal of `size` m standing at `p` would be seen by the release camera: its bounding sphere (as the
 * residents test it: radius `size` round a point 0.3 `size` up) against the view's frustum, in 3D (the camera looks down a
 * little, which widens what it sees near the ground), with a small margin.
 */
function inView(valley: Valley, view: Viewpoint, p: Pt, size: number): boolean {
  const eye = { x: view.pos.x, y: surfaceAt(valley, view.pos.x, view.pos.z) + view.pos.h, z: view.pos.z };
  const fx = view.look.x - eye.x, fy = surfaceAt(valley, view.look.x, view.look.z) + view.look.h - eye.y, fz = view.look.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1, f = { x: fx / fl, y: fy / fl, z: fz / fl };
  const rl = Math.hypot(f.x, f.z) || 1, r = { x: -f.z / rl, y: 0, z: f.x / rl }; // level, across the view
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const c = { x: p.x - eye.x, y: surfaceAt(valley, p.x, p.z) + size * 0.3 - eye.y, z: p.z - eye.z };
  const along = (a: { x: number; y: number; z: number }) => a.x * c.x + a.y * c.y + a.z * c.z;
  const depth = along(f);
  if (depth < -size) return false; // behind the camera
  // inside both pairs of side planes (each half-angle widened by the margin), the sphere's radius counted
  const within = (half: number, off: number) => Math.abs(off) * Math.cos(half + MARGIN) - depth * Math.sin(half + MARGIN) < size;
  return within(HALF_H, along(r)) && within(HALF_V, along(u));
}

/**
 * Where each of the family starts: 18 m to the side of the framing (fewer for a framing nearer than the 18 m wide one, in
 * proportion), outside the view of an animal `size` m big (Rulings P2 and R6), valid for the medium.
 */
export function entryPoints(valley: Valley, home: HomeRange, view: Viewpoint, count: number, size = 1): { x: number; z: number }[] {
  const c = home.center;
  const fx = c.x - view.pos.x, fz = c.z - view.pos.z, fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl, uz = fz / fl; // along the view
  // to the picture's left first: the join card covers the bottom right while phones are connected
  const sx = uz, sz = -ux;
  const water = home.medium === 'water';
  const medium = (p: Pt) => (water ? valley.waterDepthAt(p.x, p.z) >= 0.5 : !valley.isWater(p.x, p.z));
  // a walker's (or swimmer's) way in stays in its medium, so it does not stop at a river out of the picture
  const way = (p: Pt) => {
    if (home.medium === 'air') return true;
    const n = Math.ceil(Math.hypot(c.x - p.x, c.z - p.z) / 2);
    for (let i = 1; i < n; i++) if (!medium({ x: p.x + ((c.x - p.x) * i) / n, z: p.z + ((c.z - p.z) * i) / n })) return false;
    return true;
  };
  const valid = (p: Pt) => !inView(valley, view, p, size) && valley.inside(p.x, p.z, 10) && medium(p) && way(p);
  // anchors: straight to either side first, then further out, then drifting behind the camera
  const anchors: Pt[] = [];
  const k = Math.min(1, Math.max(0.3, fl / WIDE_BACK)); // a creature-sized framing: the family starts as near its edge
  for (const dist of [SIDE, SIDE + 5, SIDE + 15, SIDE + 30].map((d) => d * k)) {
    for (const lean of [0, 0.5, -0.5, 1, -1]) {
      for (const s of [1, -1]) {
        const lx = s * dist, ly = lean * dist;
        anchors.push({ x: c.x + sx * lx + ux * ly, z: c.z + sz * lx + uz * ly });
      }
    }
  }
  const at = (a: Pt, k: number): Pt => ({ x: a.x + ux * (k - (count - 1) / 2) * 3, z: a.z + uz * (k - (count - 1) / 2) * 3 });
  // arrival v2: a way in clear of trees first (so the family is seen as it comes), then any
  const open = (p: Pt) => {
    const n = Math.ceil(Math.hypot(c.x - p.x, c.z - p.z) / 2);
    for (let i = 0; i < n; i++) if (valley.trunksNear(p.x + ((c.x - p.x) * i) / n, p.z + ((c.z - p.z) * i) / n, 1.5).length) return false;
    return true;
  };
  const all = (a: Pt, ok: (p: Pt) => boolean) => Array.from({ length: count }, (_, k) => ok(at(a, k))).every(Boolean);
  const together = anchors.find((a) => all(a, (p) => valid(p) && open(p))) ?? anchors.find((a) => all(a, valid));
  if (together) return Array.from({ length: count }, (_, k) => at(together, k));
  // no spot holds all of them: each takes the first valid place of its own, or stays at the home centre
  return Array.from({ length: count }, (_, k) => {
    const found = anchors.map((a) => at(a, k)).find(valid);
    return found ?? { x: c.x, z: c.z };
  });
}
