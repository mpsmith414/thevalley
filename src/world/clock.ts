import type { Vec3 } from '../util/vec';

/** The valley sits at 48° N on midsummer's day; a day starts at 5:30 and passes at one valley hour per real minute. */
export const LATITUDE = 48, DAY_OF_YEAR = 172, START_HOUR = 5.5, DEFAULT_SPEED = 1 / 60; // valley hours per real second
/** Hours worth a look: dawn mist, high noon, golden hour, moonlit night. */
export const PRESETS = { dawn: 4.5, noon: 12, golden: 19, night: 23 } as const;
/** Days in one cycle of the moon's phases, and the phase on day 0. */
const SYNODIC = 29.53, PHASE0 = 0.3;
const RAD = Math.PI / 180;

/** The valley's running time: whole hours since the start of day 0, moving at `speed` valley hours per real second. */
export class ValleyClock {
  hours = START_HOUR;
  speed = DEFAULT_SPEED;
  paused = false;
  update(dtSeconds: number): void {
    if (!this.paused) this.hours += dtSeconds * this.speed;
  }
  /** The time of day, 0..24. */
  get hour(): number { return this.hours - 24 * this.day; }
  get day(): number { return Math.floor(this.hours / 24); }
  /** Move to the next time it is `hour` o'clock (now, if it is that hour already); time never runs backwards. */
  jumpTo(hour: number): void {
    let t = 24 * this.day + (((hour % 24) + 24) % 24);
    if (t < this.hours - 1e-9) t += 24;
    this.hours = t;
  }
}

/** A body at declination `dec` and hour angle `ha` (radians, west positive) seen from latitude `lat`, in the world frame. */
function skyDirection(lat: number, dec: number, ha: number): Vec3 {
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const east = -Math.cos(dec) * Math.sin(ha);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha);
  return { x: east, y: up, z: -north + 0 }; // north is −z; `+ 0` keeps −0 out of exact comparisons
}

/** The sun's declination on `dayOfYear`, radians. */
const declination = (dayOfYear: number) => 23.44 * RAD * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);

/** Unit vector to the sun at `hour` (+x east, +z south, +y up). */
export function sunDirection(hour: number, latDeg = LATITUDE, dayOfYear = DAY_OF_YEAR): Vec3 {
  return skyDirection(latDeg * RAD, declination(dayOfYear), 15 * RAD * (hour - 12));
}

/** Unit vector to the moon `hours` into the valley's time: it lags the sun by its phase angle, at the sun's declination negated. */
export function moonDirection(hours: number, latDeg = LATITUDE): Vec3 {
  const hour = hours - 24 * Math.floor(hours / 24);
  return skyDirection(latDeg * RAD, -declination(DAY_OF_YEAR), 15 * RAD * (hour - 12) - 2 * Math.PI * moonPhase(hours));
}

/** The moon's phase `hours` into the valley's time: 0 new, 0.5 full, back to 1. */
export function moonPhase(hours: number): number {
  const p = PHASE0 + hours / 24 / SYNODIC;
  return p - Math.floor(p);
}

/** Degrees above the horizon of a unit direction. */
export const elevationDeg = (dir: Vec3) => Math.asin(Math.max(-1, Math.min(1, dir.y))) / RAD;
