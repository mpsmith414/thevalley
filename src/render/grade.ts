import { Vector3, type Node, type UniformNode } from 'three/webgpu';
import { Fn, clamp, dot, float, max, min, mix, pow, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

export type RGB = [number, number, number];
/**
 * A colour grade, applied to the display-referred picture after tone mapping: white balance (`warmth` warms red over blue,
 * `tint` lifts green), lift/gamma/gain per channel, contrast about 0.45, saturation plus vibrance (which saturates the dull
 * colours more than the vivid ones) and a vignette.
 */
export type Grade = { warmth: number; tint: number; lift: RGB; gamma: RGB; gain: RGB; contrast: number; saturation: number; vibrance: number; vignette: number };

/** The grade that changes nothing. */
export const NEUTRAL_GRADE: Grade = { warmth: 0, tint: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], contrast: 1, saturation: 1, vibrance: 0, vignette: 0 };
/** The lab's studio: a touch of contrast and a soft vignette. */
export const STUDIO_GRADE: Grade = { ...NEUTRAL_GRADE, contrast: 1.03, vignette: 0.1 };

const LUMA: RGB = [0.2126, 0.7152, 0.0722];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** CPU twin of the grade, for tests: display-referred rgb (0..1) at screen position uv (0..1). Matches `gradeNode` step for step. */
export function gradeCPU(c: RGB, g: Grade, uv: [number, number] = [0.5, 0.5]): RGB {
  const wb: RGB = [1 + 0.08 * g.warmth, 1 + 0.04 * g.tint, 1 - 0.08 * g.warmth];
  let o = c.map((v, i) => {
    let x = v * wb[i];
    x = g.gain[i] * (x + g.lift[i] * (1 - x));
    x = Math.pow(Math.max(x, 0), 1 / g.gamma[i]);
    return (x - 0.45) * g.contrast + 0.45;
  }) as RGB;
  const y = o[0] * LUMA[0] + o[1] * LUMA[1] + o[2] * LUMA[2];
  const sat = Math.max(...o) - Math.min(...o);
  const k = g.saturation + g.vibrance * (1 - sat);
  const v = 1 - g.vignette * smooth(0.35, 1, 1.4142 * Math.hypot(uv[0] - 0.5, uv[1] - 0.5));
  o = o.map((x) => Math.min(1, Math.max(0, (y + (x - y) * k) * v))) as RGB;
  return o;
}

/** The grade's uniforms (one set per pipeline; `setGrade` changes them without rebuilding anything). */
type F = UniformNode<'float', number>;
type V = UniformNode<'vec3', Vector3>;
export type GradeUniforms = { warmth: F; tint: F; lift: V; gamma: V; gain: V; contrast: F; saturation: F; vibrance: F; vignette: F };

/** The grade as uniforms. */
export function gradeUniforms(g: Grade = NEUTRAL_GRADE): GradeUniforms {
  const u: GradeUniforms = {
    warmth: uniform(0), tint: uniform(0), lift: uniform(new Vector3()), gamma: uniform(new Vector3(1, 1, 1)), gain: uniform(new Vector3(1, 1, 1)),
    contrast: uniform(1), saturation: uniform(1), vibrance: uniform(0), vignette: uniform(0),
  };
  setGrade(u, g);
  return u;
}

/** Put a grade into its uniforms. */
export function setGrade(u: GradeUniforms, g: Grade): void {
  u.warmth.value = g.warmth;
  u.tint.value = g.tint;
  u.lift.value.set(...g.lift);
  u.gamma.value.set(...g.gamma);
  u.gain.value.set(...g.gain);
  u.contrast.value = g.contrast;
  u.saturation.value = g.saturation;
  u.vibrance.value = g.vibrance;
  u.vignette.value = g.vignette;
}

/** The grade applied to a colour node (rgba, display-referred; alpha passes through). The same steps as `gradeCPU`. */
export function gradeNode(color: Node, u: GradeUniforms): Node {
  return Fn(() => {
    const src = vec4(color as Node<'vec4'>).toVar();
    const c = src.rgb.mul(vec3(u.warmth.mul(0.08).add(1), u.tint.mul(0.04).add(1), u.warmth.mul(-0.08).add(1))).toVar();
    c.assign(u.gain.mul(c.add(u.lift.mul(float(1).sub(c)))));
    c.assign(pow(max(c, 0), vec3(1).div(u.gamma)));
    c.assign(c.sub(0.45).mul(u.contrast).add(0.45));
    const y = dot(c, vec3(...LUMA)).toVar();
    const sat = max(c.r, max(c.g, c.b)).sub(min(c.r, min(c.g, c.b)));
    const k = u.saturation.add(u.vibrance.mul(float(1).sub(sat)));
    c.assign(mix(vec3(y), c, k));
    c.mulAssign(float(1).sub(u.vignette.mul(smoothstep(0.35, 1, screenUV.sub(0.5).length().mul(1.4142)))));
    return vec4(clamp(c, 0, 1), src.a);
  })();
}

/**
 * Ease `g` towards `to` in place, by `1 − exp(−dt/tau)` of the way: dt = 0 leaves it exactly as it was (a paused valley),
 * dt = Infinity reaches `to` (a snap after a jump in time). No allocation and no closures: the valley runs it every frame.
 */
export function easeGrade(g: Grade, to: Grade, dt: number, tau: number): void {
  const k = 1 - Math.exp(-dt / tau);
  g.warmth += (to.warmth - g.warmth) * k;
  g.tint += (to.tint - g.tint) * k;
  for (let i = 0; i < 3; i++) {
    g.lift[i] += (to.lift[i] - g.lift[i]) * k;
    g.gamma[i] += (to.gamma[i] - g.gamma[i]) * k;
    g.gain[i] += (to.gain[i] - g.gain[i]) * k;
  }
  g.contrast += (to.contrast - g.contrast) * k;
  g.saturation += (to.saturation - g.saturation) * k;
  g.vibrance += (to.vibrance - g.vibrance) * k;
  g.vignette += (to.vignette - g.vignette) * k;
}

/**
 * A grade `t` of the way from `a` to `b`, written into `out` (its arrays reused) and returned: exactly `a` at 0 and `b` at 1.
 * No allocation and no closures: the valley's light runs it every frame.
 */
export function mixGradeInto(out: Grade, a: Grade, b: Grade, t: number): Grade {
  const s = 1 - t;
  out.warmth = a.warmth * s + b.warmth * t;
  out.tint = a.tint * s + b.tint * t;
  for (let i = 0; i < 3; i++) {
    out.lift[i] = a.lift[i] * s + b.lift[i] * t;
    out.gamma[i] = a.gamma[i] * s + b.gamma[i] * t;
    out.gain[i] = a.gain[i] * s + b.gain[i] * t;
  }
  out.contrast = a.contrast * s + b.contrast * t;
  out.saturation = a.saturation * s + b.saturation * t;
  out.vibrance = a.vibrance * s + b.vibrance * t;
  out.vignette = a.vignette * s + b.vignette * t;
  return out;
}

/** A new grade `t` of the way from `a` to `b` (see `mixGradeInto`). */
export function mixGrade(a: Grade, b: Grade, t: number): Grade {
  return mixGradeInto({ ...NEUTRAL_GRADE, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0] }, a, b, t);
}
