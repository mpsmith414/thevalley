/**
 * The overview map (spec section 6), its pure parts: where the camera stands to see the whole valley (about 75° down,
 * north up) or a third of it zoomed in, the animal markers (one species' animals within 40 m of each other merged into
 * one "Deer 5"; a released creature always its own star), the cursor's pull to the nearest marker, the spot a dive down
 * lands on (30 m back from the point chosen and 15 m above it, looking at it), the glide up and the dive down, the
 * markers' colours, the places named on it, and its light at night. `map-view.ts` puts it on the screen.
 */
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import type { Grade } from '../render/grade';
import type { Recipe } from '../recipe/schema';
import type { Vec3 } from '../util/vec';
import type { Layout, Pt, Viewpoint } from '../valley/types';
import type { Pose } from './types';

const DEG = Math.PI / 180;
/** The map looks this far down (rad): almost straight down, so the valley reads as a map, yet the hills still stand up. */
export const MAP_PITCH = -75 * DEG;
/** The valley camera's vertical field of view (degrees), which the map frames the valley with. */
export const MAP_FOV = 55;
/** Zoomed right in (zoom 1), the map sees this many times less of the valley across: about a third of it. */
const ZOOM_IN = 3;
/** At zoom 0 the valley's corners stand within this share of the screen's half width and height: a thin margin round it. */
const FIT = 0.96;
/** The glide up to the map and each dive down from it take this long (s). */
export const RISE_S = 2.5, DIVE_S = 2.5;
/** A dive lands this far back from the point chosen (m), toward where the map's camera stood (south: the map has north up), and this high over the ground. */
const DIVE_BACK = 30, DIVE_UP = 15;
/** The dive's spot keeps this far (m) inside the valley's edge. */
const DIVE_EDGE = 20;
/** On its way up or down the camera keeps this far over the ground or the water (m), easing to each end's own height there. */
const CLEAR = 2;
/** A species' marker colour is its coat colour with at least this lightness (0..1), so it reads on the land from above. */
const MARKER_LIGHT = 0.55;
/** At deep night the map lifts the exposure by this factor and cools the grade by this much warmth (eased in over the rise). */
export const MAP_NIGHT_EXPOSURE = 1.8, MAP_NIGHT_COOL = 0.45;
/** Where the forest is named: the wide forest between the river, the lake and the rocky east side. */
const FOREST: Pt = { x: 300, z: -280 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** An animal as the map shows it: its id, its species (its kind of body), its name ("Deer", or a released creature's own), whether it was released, and where it is. */
export type MapAnimal = { id: string; species: string; name: string; released: boolean; x: number; z: number };
/** A marker on the map: the animals it stands for, their species, what it says ("Deer 5", "Bramble"), whether it is a released creature's star, and where it stands (the middle of them). */
export type Marker = { ids: string[]; species: string; label: string; star: boolean; x: number; z: number };
/** A place named on the map. */
export type Place = { name: string; at: Pt };

/**
 * How far (m) the map's camera stands back along its 75° look to see a valley `size` m across whole on a screen of
 * `aspect` (width over height): the nearest distance at which its four corners all fit, and how far south of the
 * valley's middle (m) it then looks (the near half of the valley looms larger, so the look settles a little south of
 * the middle to frame it evenly).
 */
function wholeValley(size: number, aspect: number): { d: number; south: number } {
  const h = size / 2, tanV = Math.tan((MAP_FOV * DEG) / 2), tanH = tanV * aspect;
  const s = Math.sin(-MAP_PITCH), c = Math.cos(-MAP_PITCH);
  // the camera's frame: forward (0, -s, -c), up (0, c, -s), right (1, 0, 0); it looks at (0, 0, south)
  const fits = (d: number, south: number) => [[-h, -h], [h, -h], [-h, h], [h, h]].every(([x, z]) => {
    const vy = -d * s, vz = z - south - d * c, depth = -vy * s - vz * c, up = vy * c - vz * s;
    return depth > 0 && Math.abs(x) <= FIT * depth * tanH && Math.abs(up) <= FIT * depth * tanV;
  });
  const nearest = (south: number) => {
    let lo = 0, hi = size * 20;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, south)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let best = { d: nearest(0), south: 0 };
  for (let south = -h / 2; south <= h / 2; south += size / 160) {
    const d = nearest(south);
    if (d < best.d) best = { d, south };
  }
  return best;
}
let fitted = { size: 0, aspect: 0, d: 0, south: 0 };

/** How far the map can be panned from the valley's middle (m, each way) at `zoom`: none at all while it shows the whole valley. */
export const panLimit = (size: number, zoom: number) => (size / 2) * (1 - ZOOM_IN ** -clamp(zoom, 0, 1));

/**
 * Where the map's camera stands: about 75° down, north up (facing −z), looking at the point `pan` (m from the valley's
 * middle) from far enough back to see a valley `size` m across whole at `zoom` 0 on a screen of `aspect`, or about a
 * third of it at zoom 1. For the valley on 16:9 that is about 1.5 km up (the valley camera's 55° sees 1.6 km of land
 * from that high at this slant; free flight's ceiling does not apply: the map's camera never goes through free flight).
 */
export function mapPose(size: number, aspect: number, zoom: number, pan: Pt): Pose {
  if (fitted.size !== size || fitted.aspect !== aspect) fitted = { size, aspect, ...wholeValley(size, aspect) };
  const k = ZOOM_IN ** -clamp(zoom, 0, 1), d = fitted.d * k, z = pan.z + fitted.south * k; // zoomed in, it looks at the pan point itself
  return { pos: { x: pan.x, y: d * Math.sin(-MAP_PITCH), z: z + d * Math.cos(-MAP_PITCH) }, yaw: 0, pitch: MAP_PITCH };
}

/**
 * The markers for `animals`: a species' animals within `merge` m of each other (one to the next) make one marker in the
 * middle of them, counted ("Deer 5"); a lone one says its name ("Deer"). A released creature is never merged: its own
 * star, with its name.
 */
export function markers(animals: MapAnimal[], merge = 40): Marker[] {
  const out: Marker[] = [], left = animals.filter((a) => !a.released);
  for (const a of animals) if (a.released) out.push({ ids: [a.id], species: a.species, label: a.name, star: true, x: a.x, z: a.z });
  while (left.length) {
    const group = [left.pop()!];
    for (let i = 0; i < group.length; i++) {
      const g = group[i];
      for (let j = left.length - 1; j >= 0; j--) {
        const b = left[j];
        if (b.species === g.species && Math.hypot(b.x - g.x, b.z - g.z) <= merge) group.push(left.splice(j, 1)[0]);
      }
    }
    const n = group.length, x = group.reduce((s, a) => s + a.x, 0) / n, z = group.reduce((s, a) => s + a.z, 0) / n;
    out.push({ ids: group.map((a) => a.id), species: group[0].species, label: n > 1 ? `${group[0].name} ${n}` : group[0].name, star: false, x, z });
  }
  return out;
}

/**
 * The marker the cursor is drawn to: the nearest within `radius` px of it on the screen, or null. `cursor` and what
 * `screen` gives back are screen points in px (x right, z down).
 */
export function snap(cursor: Pt, ms: Marker[], screen: (p: Pt) => Pt, radius = 40): Marker | null {
  let best: Marker | null = null, near = radius;
  for (const m of ms) {
    const s = screen(m), d = Math.hypot(s.x - cursor.x, s.z - cursor.z);
    if (d <= near) (best = m), (near = d);
  }
  return best;
}

/**
 * Where a dive down to point `p` lands: 30 m back from it toward the map's camera (south), 15 m above the ground (or
 * the water) there, looking at it. Near the valley's edge it lands on whichever other side of the point stays inside.
 */
export function diveTo(p: Pt, world: FlyWorld): Viewpoint {
  const ways: Pt[] = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
  const w = ways.find((d) => world.inside(p.x + d.x * DIVE_BACK, p.z + d.z * DIVE_BACK, DIVE_EDGE)) ?? ways[0];
  return { name: '', pos: { x: p.x + w.x * DIVE_BACK, z: p.z + w.z * DIVE_BACK, h: DIVE_UP }, look: { x: p.x, z: p.z, h: 0 } };
}

/**
 * The camera `k` (0..1, in time) of the way from `from` to `to`, eased, over the valley: going `up`, it climbs early and
 * slides across; coming down, it slides across high and drops late (a dive). It keeps clear of the ground (and the
 * water), easing to each end's own height over it at the ends, so a camera under the water or on the grass starts and
 * lands where it is.
 */
export function between(from: Pose, to: Pose, k: number, world: FlyWorld, up: boolean): Pose {
  if (k >= 1) return { pos: { ...to.pos }, yaw: to.yaw, pitch: to.pitch };
  const s = smooth(k), v = up ? 1 - (1 - s) * (1 - s) : s * s;
  const x = from.pos.x + (to.pos.x - from.pos.x) * s, z = from.pos.z + (to.pos.z - from.pos.z) * s;
  const c0 = Math.min(CLEAR, from.pos.y - surfaceAt(world, from.pos.x, from.pos.z)), c1 = Math.min(CLEAR, to.pos.y - surfaceAt(world, to.pos.x, to.pos.z));
  const clear = CLEAR - (CLEAR - c0) * (1 - smooth(k / 0.1)) - (CLEAR - c1) * smooth((k - 0.9) / 0.1);
  const y = Math.max(from.pos.y + (to.pos.y - from.pos.y) * v, surfaceAt(world, x, z) + clear);
  return { pos: { x, y, z }, yaw: from.yaw + wrap(to.yaw - from.yaw) * s, pitch: from.pitch + (to.pitch - from.pitch) * s };
}

/** The dive down from the map to a pose (a spot, or where you were): 2.5 s, sliding across high and dropping late. */
export class Dive {
  readonly duration = DIVE_S;
  constructor(private readonly from: Pose, private readonly to: Pose, private readonly world: FlyWorld) {}

  /** The pose `t` seconds in; `done` once it has landed (the pose is then exactly the end's). */
  sample(t: number): Pose & { done: boolean } {
    return { ...between(this.from, this.to, t / this.duration, this.world, false), done: t >= this.duration };
  }
}

/** Hex colour to hue (0..1), saturation and lightness, and back. */
function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = l - c / 2, i = Math.floor(h * 6) % 6;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return '#' + [r, g, b].map((v) => Math.round(clamp(v + m, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

/** A species' colour on the map: its main coat colour (its body's, else its first region's), lifted to at least 55% lightness so it reads on the land. */
export function speciesColour(recipe: Recipe): string {
  const regions = recipe.skin.regions, coat = (regions.find((r) => r.id === 'body') ?? regions[0])?.color ?? '#808080';
  const [h, s, l] = toHsl(coat);
  return toHex(h, s, Math.max(l, MARKER_LIGHT));
}

/**
 * The places named on the map: every viewpoint where it stands but the Valley Overview (the map is that, and more), then
 * the lake (its middle), the river (halfway along it) and the forest.
 */
export function places(layout: Layout): Place[] {
  const own = layout.viewpoints.filter((v) => v.name !== 'Valley Overview').map((v) => ({ name: v.name, at: { x: v.pos.x, z: v.pos.z } }));
  const shore = layout.lake.outline, river = layout.river.points;
  const lake = { x: shore.reduce((s, p) => s + p.x, 0) / shore.length, z: shore.reduce((s, p) => s + p.z, 0) / shore.length };
  return [...own, { name: 'Lake', at: lake }, { name: 'River', at: river[Math.floor(river.length / 2)] }, { name: 'Forest', at: FOREST }];
}

/**
 * Where a ray from `eye` along `dir` (the cursor's, from the map's camera) meets the ground or the water: found on the
 * level plane first, then a few times on the plane at the height met, which settles within a metre on the valley's
 * slopes seen from this high. Null if it points up.
 */
export function groundUnder(eye: Vec3, dir: Vec3, world: FlyWorld): Pt | null {
  if (dir.y >= -1e-6) return null;
  let level = 0, p: Pt = { x: eye.x, z: eye.z };
  for (let i = 0; i < 6; i++) {
    const t = (eye.y - level) / -dir.y;
    p = { x: eye.x + dir.x * t, z: eye.z + dir.z * t };
    level = surfaceAt(world, p.x, p.z);
  }
  return p;
}

/**
 * The grade on the map at night, `k` (0..1) of the way in (how far up the map is, times how dark it is): `g` cooled, its
 * warmth taken down so the moonlit land reads blue and clear. Written into `out` in place (its own arrays filled: it
 * runs every frame at night, so nothing is made).
 */
export function nightGrade(g: Grade, k: number, out: Grade): Grade {
  const { lift, gamma, gain } = out;
  Object.assign(out, g);
  for (let i = 0; i < 3; i++) (lift[i] = g.lift[i]), (gamma[i] = g.gamma[i]), (gain[i] = g.gain[i]);
  out.lift = lift;
  out.gamma = gamma;
  out.gain = gain;
  out.warmth = g.warmth - MAP_NIGHT_COOL * k;
  return out;
}
