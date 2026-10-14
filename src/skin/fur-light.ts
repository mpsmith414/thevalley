/**
 * Strand lighting for the fur shells (spec §4): Kajiya-Kay with two specular lobes along the strand, shifted apart (a
 * whitish one towards the root, a broader one tinted by the hair towards the tip), a wrapped diffuse (fur scatters, so the
 * terminator is soft) and a warm backlit rim when the light is behind the strand. The ambient light is darkened by the
 * cavity through the material's `aoNode` (three's own ambient-occlusion pass), and by the root darkening in the colour.
 */
import { PhysicalLightingModel, type Node, type NodeBuilder } from 'three/webgpu';
import { abs, diffuseColor, dot, float, max, mix, normalize, normalView, positionViewDirection, pow, smoothstep, vec3 } from 'three/tsl';
import { probe } from '../render/probe';
import { add, dot as dot3, norm, scale, type Vec3 } from '../util/vec';

type F = Node<'float'>;
type C = Node<'vec3'>;

/** The lobes' shifts along the shell normal (primary towards the root, secondary towards the tip) and sharpness. */
export const STRAND = { shift1: -0.1, shift2: 0.1, exp1: 80, exp2: 20 } as const;
/** Diffuse wrap: N·L down to −WRAP still gets some light. */
const WRAP = 0.35;
/** The primary lobe's strength × the light colour (whitish), and the backlit rim's. */
const SPEC1 = 0.6, BACK = 0.6;
/**
 * Both lobes' strength in the shader. At full strength (the lobes peak at 1 × sheen, beside a Lambert diffuse of about
 * albedo/π) the primary added as much white light as a red coat reflects red: the fox looked frosted grey, its dark socks
 * grey. Real hair reflects a few percent at its surface, so its sheen is a soft band, not a white coat.
 */
const STRAND_SPEC = 0.35;
/** The rim's colour: the hair colour mixed this far towards warm white. */
const WARM = [1, 0.92, 0.8] as const, WARM_MIX = 0.5;

type StrandIn = { T: Vec3; N: Vec3; L: Vec3; V: Vec3; t: number; sheen: number; shift1?: number; shift2?: number; exp1?: number; exp2?: number };

/**
 * CPU twin of the strand shading, for tests: Kajiya-Kay with two shifted lobes, wrapped diffuse and backlight. All
 * scalars (the shader multiplies them by the light colour, the hair colour and 1/π, as three's Lambert does).
 * Change it with `strandShade` below.
 */
export function strandShadeCPU(o: StrandIn): { diffuse: number; spec1: number; spec2: number; back: number } {
  const { T, N, L, V, t, sheen } = o;
  const shift1 = o.shift1 ?? STRAND.shift1, shift2 = o.shift2 ?? STRAND.shift2, exp1 = o.exp1 ?? STRAND.exp1, exp2 = o.exp2 ?? STRAND.exp2;
  const H = norm(add(L, V)), NL = dot3(N, L);
  const lit = smooth(-0.1, 0, NL);
  const lobe = (shift: number, e: number) => {
    const d = dot3(norm(add(T, scale(N, shift))), H);
    return Math.pow(Math.max(1 - d * d, 1e-6), e / 2) * lit * sheen;
  };
  return {
    diffuse: Math.max(0, (NL + WRAP) / (1 + WRAP)),
    spec1: lobe(shift1, exp1),
    spec2: lobe(shift2, exp2),
    back: (1 - t) * Math.max(0, -dot3(V, L)) ** 4 * Math.max(0, 1 - Math.abs(NL)) * sheen * BACK,
  };
}
function smooth(a: number, b: number, x: number) {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** The strand shading in TSL (the twin of `strandShadeCPU`: change them together). `exp1` may vary per pixel (feathers). */
export function strandShade(T: C, N: C, L: C, V: C, t: F, sheen: F, exp1: F | number = STRAND.exp1) {
  const H = normalize(L.add(V));
  const NL = dot(N, L).toVar();
  const lit = smoothstep(-0.1, 0, NL);
  // (√(1 − (T·H)²))^e as (1 − (T·H)²)^(e/2)
  const lobe = (shift: number, e: F | number) => {
    const d = dot(normalize(T.add(N.mul(shift))), H);
    return pow(max(float(1).sub(d.mul(d)), 1e-6), typeof e === 'number' ? e / 2 : e.div(2)).mul(lit).mul(sheen);
  };
  return {
    diffuse: max(0, NL.add(WRAP).div(1 + WRAP)),
    spec1: lobe(STRAND.shift1, exp1),
    spec2: lobe(STRAND.shift2, STRAND.exp2),
    back: float(1).sub(t).mul(pow(max(dot(V, L).negate(), 0), 4)).mul(max(float(1).sub(abs(NL)), 0)).mul(sheen).mul(BACK),
  };
}

/**
 * What the fur material hands its lighting model: the strand tangent (view space), the shell height, the sheen and the
 * primary lobe's sharpness (`STRAND.exp1` when not given).
 */
export type StrandInputs = { tangent: C; t: F; sheen: F; exp1?: F };

/**
 * The lighting model the fur material uses: three's physical model (`CrownLightingModel` in impostor.ts is the pattern),
 * with each direct light shaded as strands (`strandShade`) instead of a GGX surface. The ambient terms are three's own,
 * × the cavity (the material's `aoNode`).
 */
export class FurLightingModel extends PhysicalLightingModel {
  constructor(private readonly strand: StrandInputs) { super(); }
  direct(input: Parameters<PhysicalLightingModel['direct']>[0], builder: NodeBuilder) {
    // three r186 passes the light as { lightDirection (view space, towards the light), lightColor (× shadow), reflectedLight };
    // without them, light the fur as a plain surface rather than fail
    const ok = !!(input?.lightDirection && input?.lightColor && input?.reflectedLight?.directDiffuse && input.reflectedLight.directSpecular);
    if (!probe(ok, "PhysicalLightingModel.direct's input is not { lightDirection, lightColor, reflectedLight }, so fur is lit without strand lighting (fur-light.ts)")) return super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = input as unknown as { lightDirection: C; lightColor: C; reflectedLight: { directDiffuse: C; directSpecular: C } };
    const hair = diffuseColor.rgb as unknown as C;
    const s = strandShade(this.strand.tangent, normalView as unknown as C, lightDirection, positionViewDirection as unknown as C, this.strand.t, this.strand.sheen, this.strand.exp1);
    const light = lightColor.mul(1 / Math.PI); // radiance the way three's Lambert scales it, so the coat sits beside the skin
    reflectedLight.directDiffuse.addAssign(light.mul(hair).mul(s.diffuse));
    const rim = mix(hair, vec3(...WARM), WARM_MIX);
    const spec = s.spec1.mul(SPEC1).add(hair.mul(s.spec2)).mul(STRAND_SPEC);
    reflectedLight.directSpecular.addAssign(light.mul(spec));
    // the rim: light through the fringe of hair at the outline, shadowed like the rest (by ridges, trees, other animals);
    // the fur material looks its shadow up a little out from the body (`receivedShadowPositionNode` in fur.ts), so the
    // body's own soft shadow edge doesn't put the fringe's rim out
    reflectedLight.directSpecular.addAssign(light.mul(rim).mul(s.back));
  }
}
