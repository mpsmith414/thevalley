import type { Vec3 } from '../util/vec';
import { elevationDeg } from './clock';

/** Everything the sky, the lights, the exposure and the fog need for one moment of the day. */
export type LightState = { key: 'sun' | 'moon'; keyDir: Vec3; keyColor: string; keyIntensity: number; skyColor: string; groundColor: string;
  hemiIntensity: number; exposure: number; fogColor: string; fogDensity: number; stars: number; mist: number };

/** One row of the lighting table. `moon` rows scale `keyI` by how lit the moon is. */
type Row = { elev: number; key: string; keyI: number; moon: boolean; sky: string; ground: string; hemi: number; exposure: number; fog: string; stars: number };
const MOON_COLOR = '#9db4ff';
const row = (elev: number, key: string, keyI: number, sky: string, ground: string, hemi: number, exposure: number, fog: string, stars: number): Row =>
  ({ elev, key, keyI, moon: key === MOON_COLOR, sky, ground, hemi, exposure, fog, stars });

/** The lighting table, keyed by sun elevation (degrees). */
const TABLE: Row[] = [
  row(-18, MOON_COLOR, 0.25, '#1c2a4a', '#0d1018', 0.35, 2.2, '#1a2236', 1),
  row(-8, MOON_COLOR, 0.2, '#2d3d66', '#151820', 0.4, 1.9, '#2a3350', 0.7),
  row(-3, '#ff9a6a', 0.1, '#6f7fb0', '#3a3030', 0.5, 1.5, '#8a8aa8', 0.15),
  row(0, '#ff8c50', 0.7, '#9fb0d0', '#5a4a3a', 0.55, 1.25, '#d8a888', 0),
  row(5, '#ffb070', 1.6, '#b8c8e0', '#5a4a34', 0.5, 1.05, '#e4c8a8', 0),
  row(15, '#ffe0b8', 2.4, '#c8daf0', '#56483a', 0.45, 0.95, '#c8d4dc', 0),
  row(40, '#fff4e5', 3.0, '#cfe3ff', '#5a4a30', 0.4, 0.95, '#b9c8cf', 0),
  row(65, '#fff4e5', 3.0, '#cfe3ff', '#5a4a30', 0.4, 0.95, '#b9c8cf', 0),
];
/** Below this sun elevation the moon takes over as the key light. */
const MOON_BELOW = -3;
/** Clear-air fog density per metre, and the extra the dawn mist adds. */
const FOG_DENSITY = 0.00018, MIST_DENSITY = 0.0002;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Each table colour parsed once, at load, so `lightingAt` never parses strings per call. */
const RGB = new Map<string, number[]>();
const parse = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
for (const r of TABLE) for (const c of [r.key, r.sky, r.ground, r.fog]) RGB.set(c, parse(c));
const hex = (c: string) => RGB.get(c) ?? parse(c);
const mixHex = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('');
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A bell curve centred on `c` with width `w`. */
const bell = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** How much light the moon gives: fading in across the horizon (−2° to 4°), 0.3 for a new moon up to 1 when full. */
export const moonLit = (moon: Vec3, phase: number) => smooth(-2, 4, elevationDeg(moon)) * (0.3 + 0.7 * (1 - Math.abs(phase - 0.5) * 2));

/**
 * The light at `hour` with the sun and moon at `sun` and `moon` (unit vectors) and the moon at `phase`:
 * the table above interpolated by sun elevation, the key on the moon below −3° (its intensity dipping to 0 at the switch so the flip is invisible), and the dawn mist (3:30 to 8:00, peaking at 5:30).
 */
export function lightingAt(hour: number, sun: Vec3, moon: Vec3, phase: number): LightState {
  const elev = elevationDeg(sun), lit = moonLit(moon, phase);
  let i = 0;
  while (i < TABLE.length - 2 && elev > TABLE[i + 1].elev) i++;
  const a = TABLE[i], b = TABLE[i + 1], t = Math.min(1, Math.max(0, (elev - a.elev) / (b.elev - a.elev)));
  const keyI = (r: Row) => r.keyI * (r.moon ? lit : 1);
  const moonKey = elev < MOON_BELOW;
  // the mist rolls in and out at the edges of its window instead of popping
  const mist = hour > 3.5 && hour < 8 ? bell(hour, 5.5, 1.5) * smooth(3.5, 4, hour) * (1 - smooth(7.5, 8, hour)) : 0;
  return {
    key: moonKey ? 'moon' : 'sun',
    keyDir: moonKey ? moon : sun,
    keyColor: moonKey ? MOON_COLOR : mixHex(a.key, b.key, t),
    keyIntensity: lerp(keyI(a), keyI(b), t) * smooth(0, 1.5, Math.abs(elev - MOON_BELOW)),
    skyColor: mixHex(a.sky, b.sky, t),
    groundColor: mixHex(a.ground, b.ground, t),
    hemiIntensity: lerp(a.hemi, b.hemi, t),
    exposure: lerp(a.exposure, b.exposure, t),
    fogColor: mixHex(a.fog, b.fog, t),
    fogDensity: FOG_DENSITY + MIST_DENSITY * mist,
    stars: lerp(a.stars, b.stars, t),
    mist,
  };
}
