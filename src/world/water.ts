/**
 * Shading shared by the lake and the river: the colour and opacity water gets from its depth, wave normals, Fresnel
 * reflections, the sun's glint and the foam line at the shore.
 */
import { Color, Vector2, Vector3, type Node, type Texture } from 'three/webgpu';
import {
  cameraPosition, clamp, color, dot, float, max, mix, mx_noise_float, mx_noise_vec3, normalize, pmremTexture, positionWorld, pow, reflect, smoothstep,
  uniform, vec3, vec4,
} from 'three/tsl';
import type { LightState } from './lighting';
import type { WindState } from '../plants/wind';

/** About the brightest a reflection gets (linear): roughly where the sky ends up on screen after tone mapping. */
const SKY_CAP = 1.5;
/** Water colour in the shallows and in deep water (6 m and more). */
export const SHALLOW = '#7a9a84', DEEP = '#0e2a33';
/** The speed the ripples drift downwind at (m/s). */
export const RIPPLE_SPEED = 0.6;

/** What the water's shaders read each frame: the time and the light. */
export type WaterUniforms = {
  time: Node<'float'> & { value: number };
  /** Key light colour × intensity, its direction, and the ambient sky light (colour × hemisphere intensity). */
  key: Node<'color'> & { value: Color };
  keyDir: Node<'vec3'> & { value: Vector3 };
  ambient: Node<'color'> & { value: Color };
  /** How far (m, x and z) the ripples have drifted downwind, and how rough the wind makes them (about 0.8–1.2). */
  drift: Node<'vec2'> & { value: Vector2 };
  rough: Node<'float'> & { value: number };
};

export function waterUniforms(): WaterUniforms {
  return {
    time: uniform(0) as WaterUniforms['time'],
    key: uniform(new Color()) as WaterUniforms['key'],
    keyDir: uniform(new Vector3(0, 1, 0)) as WaterUniforms['keyDir'],
    ambient: uniform(new Color()) as WaterUniforms['ambient'],
    drift: uniform(new Vector2()) as WaterUniforms['drift'],
    rough: uniform(1) as WaterUniforms['rough'],
  };
}

/** Bring the water's time (seconds), light and wind up to date; the ripples drift on with the wind since the last call. */
export function setWater(u: WaterUniforms, t: number, light: LightState, wind?: WindState): void {
  const dt = t - u.time.value;
  if (wind) {
    if (dt > 0 && dt < 1) u.drift.value.set(u.drift.value.x + wind.dirX * RIPPLE_SPEED * dt, u.drift.value.y + wind.dirZ * RIPPLE_SPEED * dt);
    u.rough.value = 0.6 + 0.8 * wind.strength;
  }
  u.time.value = t;
  u.key.value.set(light.keyColor).multiplyScalar(light.keyIntensity);
  u.keyDir.value.set(light.keyDir.x, light.keyDir.y, light.keyDir.z);
  u.ambient.value.set(light.skyColor).multiplyScalar(light.hemiIntensity);
}

/** Water colour at `depth` metres: pale green-grey over the shallows, deep teal by 6 m. */
export const depthColour = (depth: Node<'float'>) => mix(color(SHALLOW), color(DEEP), smoothstep(0, 6, depth));
/** Opacity at `depth`: a quarter at the shore, so the pebbles show through, 0.95 by 1.8 m. */
export const depthOpacity = (depth: Node<'float'>) => float(0.25).add(smoothstep(0, 1.8, depth).mul(0.7));
/**
 * What the water mirrors when all it has is the environment map (the sky alone): the sky in direction `R`, giving way
 * towards the horizon to the dim greens of the valley's sides, which stand between the water and the low sky. `lit` is
 * the light falling on the valley; above `horizon` (R.y) the sky is clear.
 */
export function skyReflection(env: Texture, R: Node<'vec3'>, lit: Node<'vec3'>, blur: number, horizon = 0.4): Node<'vec3'> {
  // how high the mirrored ray climbs, mostly as for a calm surface (the view's own elevation), so the ripples only stir the
  // line between land and sky instead of tossing every ripple between the two
  const climb = mix(normalize(cameraPosition.sub(positionWorld)).y, R.y, 0.25);
  return mix(lit.mul(vec3(0.11, 0.12, 0.09)), pmremTexture(env, R, float(blur)).rgb as Node<'vec3'>, smoothstep(0.02, horizon, climb));
}
/** Schlick's Fresnel for water (F0 = 0.02). */
export const fresnel = (cosT: Node<'float'>) => float(0.02).add(pow(float(1).sub(clamp(cosT, 0, 1)), 5).mul(0.98));

/**
 * A ripple normal from two octaves of gradient noise (7 m and 1.7 m), sampled at `p` (metres, already scrolled with the
 * water) and turned into world space by `along`/`across` (unit xz vectors; the default is the world's own axes). `strength`
 * scales the slopes; the small octave fades out first with distance so far water does not sparkle.
 */
export function rippleNormal(p: Node<'vec2'>, t: Node<'float'>, strength: Node<'float'> | number,
  frame?: { along: Node<'vec2'>; across: Node<'vec2'> }): Node<'vec3'> {
  const dist = positionWorld.sub(cameraPosition).length();
  const big = mx_noise_vec3(vec3(p.div(7), t.mul(0.07))).xy.mul(float(1).sub(smoothstep(250, 900, dist)));
  const small = mx_noise_vec3(vec3(p.div(1.7).add(31.7), t.mul(0.21))).xy.mul(float(1).sub(smoothstep(40, 160, dist)));
  const g = big.mul(0.14).add(small.mul(0.07)).mul(strength);
  const gx = frame ? frame.along.x.mul(g.x).add(frame.across.x.mul(g.y)) : g.x;
  const gz = frame ? frame.along.y.mul(g.x).add(frame.across.y.mul(g.y)) : g.y;
  return normalize(vec3(gx.negate(), 1, gz.negate()));
}

/**
 * The colour (rgb, straight alpha) of water `depth` metres deep with surface normal `N`. `reflection(R)` is what the water
 * mirrors along the reflected ray R (`lit`: the light on the valley); `white` (0–1) is white water or foam laid over the surface, already noise-broken.
 * The shore line: a band of foam at depth 0.02–0.18 m, and the water's alpha fading to nothing over its last 2 cm.
 */
export function shadeWater(u: WaterUniforms, depth: Node<'float'>, N: Node<'vec3'>, reflection: (R: Node<'vec3'>, lit: Node<'vec3'>) => Node<'vec3'>,
  white: Node<'float'> = float(0)): Node<'vec4'> {
  const V = normalize(cameraPosition.sub(positionWorld));
  const F = fresnel(dot(N, V));
  const R = reflect(V.negate(), N);
  const Rup = normalize(vec3(R.x, max(R.y, 0.01), R.z)); // a ray the ripples tip below the horizon still sees the sky
  // light scattered back out of the water body, and the sun's (or moon's) glint off the ripples
  const lit = u.key.mul(max(u.keyDir.y, 0)).add(u.ambient).mul(1 / Math.PI);
  const body = depthColour(depth).mul(lit);
  const glint = u.key.mul(pow(max(dot(Rup, u.keyDir), 0), 1500).mul(4));
  const a = depthOpacity(depth);
  // The sky dome is far brighter than the sunlit ground (tone mapping only squeezes it into the screen's range), so a
  // mirrored sky would swamp the water even at 2% Fresnel. Compress what is mirrored towards the sky's on-screen level:
  // the valley's own colours pass almost unchanged, the sky comes down to about SKY_CAP.
  const seen = reflection(Rup, lit), peak = max(seen.r, max(seen.g, seen.b));
  const mirrored = seen.div(float(1).add(peak.div(SKY_CAP)));
  let premul: Node<'vec3'> = body.mul(a.mul(float(1).sub(F))).add(mirrored.mul(F)).add(glint);
  let alpha: Node<'float'> = a.mul(float(1).sub(F)).add(F);
  // foam: the shore band, plus white water handed in
  const t = u.time, xz = positionWorld.xz;
  const lap = depth.add(mx_noise_float(vec3(xz.mul(0.35), t.mul(0.4))).mul(0.03)); // the line breathes as ripples lap in
  const dist = positionWorld.sub(cameraPosition).length();
  // a thin line at the water's edge, broken into long runs, and specks of foam over the rest of the band
  const line = smoothstep(0.02, 0.03, lap).mul(float(1).sub(smoothstep(0.05, 0.08, lap)));
  const band = smoothstep(0.02, 0.045, lap).mul(float(1).sub(smoothstep(0.12, 0.18, lap)));
  const runs = mx_noise_float(vec3(xz.mul(0.9), t.mul(0.2)));
  const specks = mix(smoothstep(0.2, 0.6, mx_noise_float(vec3(xz.mul(6), t.mul(0.5))).add(runs.mul(0.3))), 0.25, smoothstep(25, 70, dist));
  const shore = clamp(line.mul(smoothstep(-0.35, 0.05, runs)).add(band.mul(specks).mul(0.7)), 0, 1);
  const far = float(1).sub(smoothstep(80, 220, dist)); // thinner than a pixel beyond: it would only sparkle
  const foam = max(shore.mul(0.5).mul(far), white);
  premul = mix(premul, lit.mul(0.9), foam);
  alpha = mix(alpha, float(1), foam);
  const edge = smoothstep(0, 0.02, depth);
  alpha = clamp(alpha.mul(edge), 0, 1);
  return vec4(premul.mul(edge).div(max(alpha, 1e-4)), alpha);
}
