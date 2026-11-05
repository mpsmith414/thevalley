/**
 * The Eyes view's lenses on the picture (the numbers are `src/views/lens.ts`'s): two steps the post pipeline builds once,
 * whose strengths are uniforms, so entering and leaving Eyes changes values and nothing else. With every strength 0 each
 * step hands its picture on untouched (a branch on the uniforms skips the work), so free flight pays nothing for them.
 *
 * - `lensSceneNode`, on the HDR picture before tone mapping: the wide view's gentle barrel (the scene and its glow read at
 *   bent places), a soft blur toward the sides and, for weak sight, away from the centre, keen sight's sharpening (all
 *   from five taps of the scene), and the night sight's exposure.
 *   Then, with the eye under the water, the look from under it (see `underwater`).
 * - `lensColourNode`, on the display-referred picture before the grade: the colour range (two-colour sight folding reds
 *   and greens toward yellows, or birds' and fishes' richer colour with a violet lift in the shadows), night sight's
 *   cooler, greyer look, and its fine grain (new grain at most GRAIN_HZ times a second). Then the Fear sense's pulse:
 *   the edges darkened by `edge` (0..0.6, the wiring beats it with the animal's heart), most in the corners.
 */
import { Color, Matrix4, Vector3, type Camera, type Node, type TextureNode, type UniformNode } from 'three/webgpu';
import {
  Fn, If, abs, clamp, dot, exp2, float, getViewPosition, hash, max, min, mix, mx_noise_float, pow, screenCoordinate, screenSize, smoothstep, sqrt,
  time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import type { Lens } from '../views/lens';
import type { LightState } from '../world/lighting';
import type { RGB } from './grade';

/** Two-colour sight folds this far (0..1) toward a dichromat's colours (Machado et al.'s deuteranope, on linear rgb). */
export const MUTED = 0.85;
/** A deuteranope's colours from ours (rows: r, g, b of the result), on linear rgb (Machado, Oliveira and Fernandes 2009). */
const DICHROMAT: [RGB, RGB, RGB] = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]];
/** The display's gamma, near enough, for the dichromat's step into linear and back. */
const GAMMA = 2.2;
/** Two-colour sight is this much less saturated in full (a share). */
const MUTED_GREY = 0.12;
/** Vivid sight in full: saturation ×(1 + VIVID_SAT), vibrance +VIVID_VIB, and up to VIOLET_LIFT of VIOLET added in shadows darker than VIOLET_BELOW. */
const VIVID_SAT = 0.2, VIVID_VIB = 0.2, VIOLET: RGB = [0.55, 0.25, 1], VIOLET_LIFT = 0.03, VIOLET_BELOW = 0.3;
/** Night sight in full: saturation down by NIGHT_GREY, red down and blue up by NIGHT_COOL (shares). */
const NIGHT_GREY = 0.45, NIGHT_COOL: RGB = [-0.08, 0, 0.06];
/** The night grain changes this many times a second at most (a fine, slow grain, never a fast flicker). */
export const GRAIN_HZ = 12;
/** The blur's taps reach this many pixels out, plus BLUR_REACH more at full blur. */
const TAP = 1, BLUR_REACH = 2.5;
/** The sides blur from this far out (a share of the half width) to the edge; weak sight from SOFT_FROM to SOFT_TO of the corner distance. */
const SIDE_FROM = 0.35, SOFT_FROM = 0.1, SOFT_TO = 0.8;
/** Keen sight in full adds this much of the picture's own detail back (an unsharp mask). */
const SHARPEN = 0.5;
/**
 * The fear pulse darkens the picture from EDGE_FROM of the way from its middle to its corners (measured across the
 * screen's width and height alike, so the middle of each side is about 0.7 of the way), fully by EDGE_TO: a soft
 * vignette, the middle untouched.
 */
const EDGE_FROM = 0.35, EDGE_TO = 0.95;

/** Under the water the picture is hidden in the fog by this far (m): the fog thickens fast near the eye and is whole here. */
export const FOG_END = 12;
/**
 * The water's own colour under it, looking level (a share of the light on the water): what the fog fades to,
 * green-blue. It is FOG_UP times brighter looking straight up and as much darker looking straight down.
 */
const FOG: RGB = [0.05, 0.2, 0.19], FOG_UP = 0.5;
/** Everything seen under the water is tinted this much green-blue (the water takes the reds first). */
const TINT: RGB = [0.75, 1, 0.85];
/**
 * The surface from below: inside the window straight up (rays within about 49° of overhead, Snell's window) it is the
 * bright sky, CEILING times the light on the water; outside it, the water mirrored, a silvery REFLECT times the level fog.
 * The window's edge is a soft band from WINDOW_FROM to WINDOW_TO (the cosine of the ray from straight up), wobbled by the
 * ripples, which also brighten and darken it all by up to RIPPLE.shade.
 */
const CEILING: RGB = [1.6, 2.1, 2.0], REFLECT = 1.6, WINDOW_FROM = 0.5, WINDOW_TO = 0.75;
/**
 * The ripples on the surface from below: two octaves (sizes per m: the surface the eye sees from just under it is only a
 * few metres across), drifting slowly (per s).
 */
const RIPPLE = { big: 2.2, small: 6, slow: 0.3, fast: 0.5, wobble: 0.05, shade: 0.35 };
/**
 * The light the ripples throw on the bed (caustics): thin moving lines in cells about 1/CAUSTIC.size m across, up to
 * CAUSTIC.gain brighter, fading out by CAUSTIC.far m from the eye and CAUSTIC.deep m under the surface.
 */
const CAUSTIC = { size: 1.6, slow: 0.3, fast: 0.4, gain: 0.6, far: 10, deep: 5 };

const LUMA: RGB = [0.2126, 0.7152, 0.0722];
/** The taps read the top level by name (the picture has no others), which a branch on the uniforms is free to do. */
const LOD0 = float(0);

/** The lens's colour strengths: two-colour sight, vivid sight and night sight, each 0 when it is not this animal's. */
function colourStrengths(lens: Lens, k: number): { muted: number; vivid: number; night: number } {
  return { muted: lens.colour === 'muted' ? MUTED * k : 0, vivid: lens.colour === 'vivid' ? k : 0, night: lens.night * k };
}

/**
 * CPU twin of the lens's colour step (without its grain, which is noise), for tests: display-referred rgb (0..1) seen
 * with `lens` in full. Matches `lensColourNode` step for step; with no colour strength it is the identity.
 */
export function lensColourCPU(c: RGB, lens: Lens): RGB {
  const { muted, vivid, night } = colourStrengths(lens, 1);
  if (muted + vivid + night <= 0) return c;
  const lin = c.map((v) => Math.pow(Math.max(v, 0), GAMMA));
  let o = DICHROMAT.map((row, i) => {
    const m = Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
    return Math.pow(lin[i] + (m - lin[i]) * muted, 1 / GAMMA);
  }) as RGB;
  const y = o[0] * LUMA[0] + o[1] * LUMA[1] + o[2] * LUMA[2];
  const sat = Math.max(...o) - Math.min(...o);
  const k = (1 - MUTED_GREY * muted) * (1 + vivid * (VIVID_SAT + VIVID_VIB * (1 - sat))) * (1 - NIGHT_GREY * night);
  const shade = VIOLET_LIFT * vivid * Math.min(1, Math.max(0, 1 - y / VIOLET_BELOW));
  o = o.map((x, i) => Math.min(1, Math.max(0, (y + (x - y) * k + VIOLET[i] * shade) * (1 + NIGHT_COOL[i] * night)))) as RGB;
  return o;
}

/** How far into the fog a thing `dist` m away is (0..1): quickly at first, all of it by FOG_END. */
const fogShare = (dist: number) => 1 - (1 - Math.min(1, Math.max(0, dist) / FOG_END)) ** 3;

/** The fog's colour under the water looking level, for `light` (linear rgb) on the water: the water's green-blue. */
export function underwaterFog(light: RGB): RGB {
  return FOG.map((f, i) => f * light[i]) as RGB;
}

/**
 * CPU twin of the look under the water (looking level, without the surface and the bed's light), for tests: HDR rgb
 * `c` of a thing `dist` m from the eye, tinted and fogged `k` of the way in (0: out of the water, 1: under it), with `light` on the water.
 */
export function underwaterCPU(c: RGB, dist: number, k: number, light: RGB): RGB {
  if (k <= 0) return c;
  const f = fogShare(dist) * k, fog = underwaterFog(light);
  return c.map((v, i) => v * (1 + (TINT[i] - 1) * k) * (1 - f) + fog[i] * f) as RGB;
}

const key = new Color(), sky = new Color();
/** The light falling on the water now (linear rgb): the key light from above and the sky's, as the water itself has it (`shadeWater`). */
export function waterLight(light: LightState, out = new Vector3()): Vector3 {
  key.set(light.keyColor).multiplyScalar(light.keyIntensity * Math.max(light.keyDir.y, 0));
  sky.set(light.skyColor).multiplyScalar(light.hemiIntensity);
  return out.set(key.r + sky.r, key.g + sky.g, key.b + sky.b).multiplyScalar(1 / Math.PI);
}

type F = UniformNode<'float', number>;
/**
 * The lens's uniforms (one set per pipeline; `setLens` changes them without rebuilding anything): the strengths, the
 * exposure in stops, the grain's size and `seed` (which grain is showing: the wiring steps it GRAIN_HZ times a second).
 * `underwater` is the look from under the water; for it, `surface` is the height of the water's surface over the eye (m)
 * and `waterLight` the light on the water (see `waterLight`), both set by the valley. `edge` is the fear pulse's darkening
 * of the edges (0..0.6; not the lens's: `setLens` leaves it be).
 */
export type LensUniforms = {
  barrel: F; sideBlur: F; soften: F; sharpen: F; muted: F; vivid: F; night: F; exposure: F; grain: F; underwater: F; seed: F;
  surface: F; waterLight: UniformNode<'vec3', Vector3>; edge: F;
};

/** The lens's uniforms, all off. */
export function lensUniforms(): LensUniforms {
  return {
    barrel: uniform(0), sideBlur: uniform(0), soften: uniform(0), sharpen: uniform(0), muted: uniform(0), vivid: uniform(0),
    night: uniform(0), exposure: uniform(0), grain: uniform(0), underwater: uniform(0), seed: uniform(0),
    surface: uniform(0), waterLight: uniform(new Vector3(1, 1, 1)), edge: uniform(0),
  };
}

/** Put `lens` into its uniforms, `k` of the way in (0: none of it, 1: all; the 0.5 s ease in and out of Eyes). */
export function setLens(u: LensUniforms, lens: Lens, k: number): void {
  const s = colourStrengths(lens, k);
  u.barrel.value = lens.barrel * k;
  u.sideBlur.value = lens.sideBlur * k;
  u.soften.value = lens.soften * k;
  u.sharpen.value = lens.sharpen * k;
  u.muted.value = s.muted;
  u.vivid.value = s.vivid;
  u.night.value = s.night;
  u.exposure.value = lens.exposure * k;
  u.grain.value = lens.grain * k;
  u.underwater.value = lens.underwater * k;
}

/** What the look from under the water reads of the scene: its depth texture and the camera it was drawn with. */
export type SceneView = { depth: TextureNode; camera(): Camera };

/**
 * The look from under the water, put into the picture's pixel `out` (a var, HDR rgba; untouched while `u.underwater` is
 * off), which was read at `at` on the scene's textures. Called inside the lens's `Fn`. From the scene's depth there and the
 * camera: where a ray climbing from the eye meets the water's surface (at `u.surface`) before anything else, the surface
 * from below (bright where the sky is, slowly rippling); elsewhere what is there, with the light the ripples throw on it
 * if it is under the water. Then all of it is tinted green-blue and fogged by its distance (hidden by FOG_END m).
 * A screen-space stand-in for the surface (the water itself is drawn from above only), so it costs no new pipelines.
 */
function underwater(out: Node<'vec4'>, at: Node<'vec2'>, view: SceneView, u: LensUniforms): void {
  const world = uniform(new Matrix4()).onRenderUpdate(() => view.camera().matrixWorld);
  const unproject = uniform(new Matrix4()).onRenderUpdate(() => view.camera().projectionMatrixInverse);
  If(u.underwater.greaterThan(0), () => {
    const p = getViewPosition(at, view.depth.sample(at).level(LOD0), unproject).toVar(); // in the camera's space
    const dist = p.length().toVar();
    const dir = world.mul(vec4(p.div(dist), 0)).xyz.toVar(), eye = world.mul(vec4(0, 0, 0, 1)).xyz.toVar();
    const k = u.underwater, light = u.waterLight, flat = light.mul(vec3(...FOG)).toVar(); // the fog looking level
    const fog = flat.mul(dir.y.mul(FOG_UP).add(1)).toVar(); // brighter looking up, darker looking down
    const toSurface = u.surface.sub(eye.y).div(max(dir.y, 1e-4)).toVar();
    const seen = out.rgb.toVar(), far = dist.toVar(), opaque = out.a.toVar();
    If(dir.y.greaterThan(0).and(eye.y.lessThan(u.surface)).and(toSurface.lessThan(dist)), () => {
      // the surface from below: the sky through the window overhead, the water mirrored round it, rippling slowly
      const xz = eye.xz.add(dir.xz.mul(toSurface));
      const n = mx_noise_float(vec3(xz.mul(RIPPLE.big), time.mul(RIPPLE.slow)))
        .add(mx_noise_float(vec3(xz.mul(RIPPLE.small).add(17.3), time.mul(RIPPLE.fast))).mul(0.5)).toVar();
      const window = smoothstep(WINDOW_FROM, WINDOW_TO, dir.y.add(n.mul(RIPPLE.wobble)));
      const surface = mix(flat.mul(REFLECT), light.mul(vec3(...CEILING)), window).mul(n.mul(RIPPLE.shade).add(1));
      seen.assign(mix(seen, surface, k));
      far.assign(toSurface);
      opaque.assign(1);
    }).Else(() => {
      // the bed (or anything) under the water: the ripples' light moving over it, near the eye and the surface
      const at3 = eye.add(dir.mul(dist)), under = u.surface.sub(at3.y);
      const line = (scale: number, speed: number, shift: number) =>
        float(1).sub(abs(mx_noise_float(vec3(at3.xz.mul(scale).add(shift), time.mul(speed)))));
      const lines = pow(line(CAUSTIC.size, CAUSTIC.slow, 0).mul(line(CAUSTIC.size * 1.7, CAUSTIC.fast, 5.1)), 8);
      const reach = smoothstep(0, 0.2, under).mul(float(1).sub(smoothstep(0, CAUSTIC.deep, under))).mul(float(1).sub(smoothstep(0, CAUSTIC.far, dist)));
      seen.mulAssign(lines.mul(reach).mul(CAUSTIC.gain).mul(k).add(1));
    });
    const f = float(1).sub(pow(float(1).sub(clamp(far.div(FOG_END), 0, 1)), 3)).mul(k); // as fogShare
    const tinted = seen.mul(vec3(...TINT).sub(1).mul(k).add(1));
    out.assign(vec4(mix(tinted, fog, f), mix(opaque, 1, f)));
  });
}

/**
 * The lens on the HDR picture: `plain` is the picture as it is without a lens (the scene plus its glow), which is handed
 * on untouched while no shape strength is on; `scene` and `glow` are the textures it is made of, read at bent places when
 * one is. Then the look from under the water (from `view`: none, no such look), and the night sight's exposure.
 */
export function lensSceneNode(plain: Node, scene: TextureNode, glow: TextureNode | null, u: LensUniforms, view: SceneView | null = null): Node {
  return Fn(() => {
    const out = vec4(0).toVar(), from = vec2(uv()).toVar(); // the picture, and where on the scene it was read
    If(u.barrel.add(u.sideBlur).add(u.soften).add(u.sharpen).greaterThan(0), () => {
      const d = uv().sub(0.5).toVar(), aspect = screenSize.x.div(screenSize.y);
      // the distance from the middle, 1 at the corners (in the picture's own proportions)
      const r2 = dot(d.mul(vec2(aspect, 1)), d.mul(vec2(aspect, 1))).div(aspect.mul(aspect).add(1).mul(0.25)).toVar();
      const at = d.mul(float(1).sub(u.barrel.mul(float(1).sub(r2)))).add(0.5).toVar(); // the middle swells, the corners stay
      const blur = clamp(
        u.sideBlur.mul(smoothstep(SIDE_FROM, 1, abs(d.x).mul(2))).add(u.soften.mul(smoothstep(SOFT_FROM, SOFT_TO, sqrt(r2)))), 0, 1,
      ).toVar();
      const o = vec2(1).div(screenSize).mul(blur.mul(BLUR_REACH).add(TAP)).toVar();
      const c = scene.sample(at).level(LOD0).toVar();
      const t1 = scene.sample(at.add(o)).level(LOD0).toVar(), t2 = scene.sample(at.sub(o)).level(LOD0).toVar();
      const t3 = scene.sample(at.add(vec2(o.x, o.y.negate()))).level(LOD0).toVar(), t4 = scene.sample(at.add(vec2(o.x.negate(), o.y))).level(LOD0).toVar();
      const taps = t1.add(t2).add(t3).add(t4).mul(0.25).toVar();
      // keen sight's detail, kept within the colours round it (no dark or bright rims where a ridge meets the bright sky)
      const lo = min(c.rgb, min(min(t1.rgb, t2.rgb), min(t3.rgb, t4.rgb))), hi = max(c.rgb, max(max(t1.rgb, t2.rgb), max(t3.rgb, t4.rgb)));
      const crisp = clamp(c.rgb.add(c.rgb.sub(taps.rgb).mul(u.sharpen.mul(SHARPEN))), lo, hi);
      const rgb = mix(crisp, taps.rgb, blur).toVar();
      if (glow) rgb.addAssign(glow.sample(at).level(LOD0).rgb);
      out.assign(vec4(max(rgb, 0), clamp(mix(c.a, taps.a, blur), 0, 1)));
      from.assign(at);
    }).Else(() => {
      out.assign(plain);
    });
    if (view) underwater(out, from, view, u);
    return vec4(out.rgb.mul(exp2(u.exposure)), out.a);
  })();
}

/**
 * The lens's colour step on the display-referred picture (rgba; alpha passes through). The same steps as `lensColourCPU`,
 * plus the grain; then the fear pulse's darkened edges (with `u.edge` 0 the picture passes untouched).
 */
export function lensColourNode(color: Node, u: LensUniforms): Node {
  return Fn(() => {
    const out = vec4(color as Node<'vec4'>).toVar();
    If(u.muted.add(u.vivid).add(u.night).add(u.grain).greaterThan(0), () => {
      const lin = pow(max(out.rgb, 0), vec3(GAMMA)).toVar();
      const fold = max(vec3(dot(lin, vec3(...DICHROMAT[0])), dot(lin, vec3(...DICHROMAT[1])), dot(lin, vec3(...DICHROMAT[2]))), 0);
      const c = pow(mix(lin, fold, u.muted), vec3(1 / GAMMA)).toVar();
      const y = dot(c, vec3(...LUMA)).toVar();
      const sat = max(c.r, max(c.g, c.b)).sub(min(c.r, min(c.g, c.b)));
      const k = float(1).sub(u.muted.mul(MUTED_GREY))
        .mul(u.vivid.mul(float(VIVID_SAT).add(float(1).sub(sat).mul(VIVID_VIB))).add(1))
        .mul(float(1).sub(u.night.mul(NIGHT_GREY)));
      const shade = u.vivid.mul(VIOLET_LIFT).mul(clamp(float(1).sub(y.div(VIOLET_BELOW)), 0, 1));
      c.assign(mix(vec3(y), c, k).add(vec3(...VIOLET).mul(shade)).mul(vec3(...NIGHT_COOL).mul(u.night).add(1)));
      // the grain: one value per pixel, a new set each time the seed steps
      const px = screenCoordinate.x.floor().add(screenCoordinate.y.floor().mul(4099));
      c.addAssign(hash(hash(px).mul(1e6).add(u.seed)).sub(0.5).mul(2).mul(u.grain));
      out.assign(vec4(clamp(c, 0, 1), out.a));
    });
    If(u.edge.greaterThan(0), () => {
      const r = uv().sub(0.5).mul(2).length().mul(Math.SQRT1_2); // 1 at the corners
      out.assign(vec4(out.rgb.mul(float(1).sub(u.edge.mul(smoothstep(EDGE_FROM, EDGE_TO, r)))), out.a));
    });
    return out;
  })();
}
