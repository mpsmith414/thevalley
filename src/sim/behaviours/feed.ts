import { whereText } from '../moments';
import type { KeepOff } from '../places';
import { LOW, type Agent, type Pt } from '../types';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';

/** Walking to a feeding ground (speed fraction); nibbling along within PATCH m of it in steps of 1 to 3 m. */
const TRAVEL = 0.25, NIBBLE = 0.06, PATCH = 8, STEP = [1, 3] as const;
/** A feeder this many PATCHes from its ground (it moved: it keeps with its group) looks up and walks there. */
const MOVED = 2;
/** A feeding bout lasts this many animal seconds before it chooses again (a sated one SATED_BOUT); sated at this hunger. */
const BOUT = 60, SATED_BOUT = 15, SATED = 0.05;
/** A walk to a feeding ground that has not got there in this many animal seconds gives up (and it chooses again). */
const LOST = 240;
/** Near enough to a nibble step (m); a grazing herd or flock is a moment when this many graze within GROUP_NEAR m. */
const STEP_NEAR = 0.4, GROUP = 2, GROUP_NEAR = 40;
/** The hawk circles high (28–45 m) at this speed fraction, a waypoint counting as reached within WAYPOINT m. */
const SOAR_HEIGHT = [28, 45] as const, SOAR_SPEED = 0.8, WAYPOINT = 4;
/** Its circles are 35–70 m across, 8 waypoints a turn, 12 to 24 waypoints (1.5 to 3 turns) before it drifts to the next. */
const CIRCLE_R = [35, 70] as const, CIRCLE_STEPS = 8, CIRCLE_LAPS = [12, 24] as const;
/** Circles keep this far inside the valley's edge (m). */
const EDGE = 20;

/** Whether it lives on the wing and soars (the hawk): a flier whose home is the air. */
export const soars = (t: Traits) => t.canFly && t.medium === 'air';

/** Its own soaring height, from its seed. */
export const soarHeight = (a: Agent) => SOAR_HEIGHT[0] + ((a.seed % 1000) / 1000) * (SOAR_HEIGHT[1] - SOAR_HEIGHT[0]);

/**
 * Grazing where its plants grow (round its leader's patch, when it follows one): walking there head up, then nibbling
 * slowly along, head down and chewing.
 */
export function graze(a: Agent, t: Traits, s: SimCtx): void {
  feed(a, t, s, true);
}

/**
 * Foraging for small food or berries: the same slow, head-down feeding at its foraging ground (a hunter's near the middle
 * of its home, off the ground where it hunts).
 */
export function forage(a: Agent, t: Traits, s: SimCtx): void {
  feed(a, t, s, false);
}

function feed(a: Agent, t: Traits, s: SimCtx, grazing: boolean) {
  const m = a.motion, home = s.home(a), hunts = t.prey[1] > 0 && !t.smallFood;
  if (!a.place) {
    const keep = s.keepOff(a);
    a.place = outside(s.beside(a), keep) ?? s.apart(a, (p) => (grazing ? s.places.grazeSpot(home, t, p) : s.places.forageSpot(home, t, hunts ? home.center : p, keep)));
  }
  const p = a.place;
  if (!s.at(a, p, a.pose.headDown < 1 ? PATCH : PATCH * MOVED)) {
    s.go(a, t, p, TRAVEL);
    s.pose(a, 0, 0);
  } else {
    if (a.pose.headDown < 1) {
      // starting to feed (the bout counts from here): a herd or flock feeding together is worth a look
      a.since = s.t;
      s.stop(a);
      if (t.social === 'herd' || t.social === 'flock') {
        const herd = s.mates(a, GROUP_NEAR, (b) => b === a || (b.doing === a.doing && b.pose.headDown >= 1));
        if (herd.length >= GROUP) s.moment('graze', a, herd, LOW, whereText(s.world.biomeAt(m.x, m.z), s.world.isWater(m.x, m.z)));
      }
    }
    s.pose(a, 1, 0, 'chew');
    if (!m.target || Math.hypot(m.target.x - m.x, m.target.z - m.z) < STEP_NEAR) nibble(a, t, s, p);
  }
  const time = s.t - a.since, feeding = a.pose.headDown >= 1;
  if (feeding ? (a.needs.hunger <= SATED && time >= SATED_BOUT) || time >= BOUT : time >= LOST) s.done(a);
}

/** `p`, unless it lies inside a hunter's keep-off from its prey. */
export const outside = (p: Pt | null, keep: KeepOff | undefined) => (p && (!keep || keep(p) >= 0) ? p : null);

/** The next small step while feeding: within PATCH m of its ground, and in its own medium (any for water birds and frogs). */
function nibble(a: Agent, t: Traits, s: SimCtx, p: Pt) {
  const m = a.motion, r = s.rng, ang = r.next() * Math.PI * 2, d = r.range(...STEP);
  let x = m.x + Math.sin(ang) * d, z = m.z + Math.cos(ang) * d;
  const off = Math.hypot(x - p.x, z - p.z);
  if (off > PATCH) (x = p.x + ((x - p.x) * PATCH) / off), (z = p.z + ((z - p.z) * PATCH) / off);
  if (!t.floater && s.world.isWater(x, z) !== t.swimmer) return s.stop(a);
  s.go(a, t, { x, z }, NIBBLE);
}

/** Soaring: round and round a circle somewhere over its home at its own height, then drifting off to the next. */
export function soar(a: Agent, t: Traits, s: SimCtx) {
  const m = a.motion;
  m.wantFly = true;
  m.cruise = soarHeight(a);
  m.speedFrac = SOAR_SPEED;
  if (m.target && Math.hypot(m.target.x - m.x, m.target.z - m.z) > WAYPOINT) return;
  if (!a.route.length) {
    const home = s.home(a), r = s.rng, c = s.places.roamSpot(home, t, home.center);
    const radius = r.range(...CIRCLE_R), dir = r.next() < 0.5 ? 1 : -1, laps = CIRCLE_LAPS[0] + Math.floor(r.next() * (CIRCLE_LAPS[1] - CIRCLE_LAPS[0]));
    const half = s.world.size / 2 - EDGE;
    let ang = Math.atan2(m.z - c.z, m.x - c.x);
    for (let i = 0; i < laps; i++) {
      ang += (dir * Math.PI * 2) / CIRCLE_STEPS;
      let x = c.x + Math.cos(ang) * radius, z = c.z + Math.sin(ang) * radius;
      const dx = x - home.center.x, dz = z - home.center.z, d = Math.hypot(dx, dz);
      if (d > home.radius) (x = home.center.x + (dx / d) * home.radius), (z = home.center.z + (dz / d) * home.radius);
      a.route.push({ x: Math.max(-half, Math.min(half, x)), z: Math.max(-half, Math.min(half, z)) });
    }
  }
  m.target = a.route.shift()!;
  a.detour = null;
}
