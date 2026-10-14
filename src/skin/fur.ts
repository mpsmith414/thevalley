import { MeshStandardNodeMaterial, SkinnedMesh, Vector4, type BufferGeometry, type Material, type Node } from 'three/webgpu';
import {
  abs, attribute, clamp, cross, dot, float, floor, Fn, fract, fwidth, hash, If, length, max, min, mix, modelViewMatrix, mx_noise_vec3, normalize,
  normalLocal, normalWorld, positionLocal, positionWorld, pow, select, sin, smoothstep, tangentLocal, uint, uniform, uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { COATS, MAX_REGIONS } from '../recipe/schema';
import { probe, skinsTangent } from '../render/probe';
import { cellSeed, COAT_LOOK, drawsFeathersAt, featherCell, feathersAt, strandCell } from './coat';
import type { EyePlace } from './eyes';
import { FurLightingModel, STRAND, type StrandInputs } from './fur-light';
import { furCover, markedColor, regionNodes } from './material';
import type { RegionPack } from './patterns';

type F = Node<'float'>;
type C = Node<'vec3'>;
type V4 = ReturnType<typeof uniformArray>;

/** Shell heights as fractions 0..`length` of the fur length, packed closer near the skin (where fur is densest). */
export function furShellOffsets(count: number, length = 1): number[] {
  return Array.from({ length: count }, (_, k) => length * ((k + 1) / count) ** 1.6);
}

/** How high the shells reach, in fur lengths: the longest guard hairs of the creature's coats (1 without guard hairs). */
export function shellTop(pack: RegionPack): number {
  let top = 1;
  pack.coat.forEach((c, i) => {
    const l = c >= 0 && pack.furLength[i] > 0 ? COAT_LOOK[COATS[c]] : null;
    if (l && l.guard > 0) top = Math.max(top, l.guardLen);
  });
  return top;
}

/**
 * How far (fur lengths) the shell that draws feathers stands off the skin. Feathers are drawn whole on the lowest shell only,
 * lit as strands along the groom (glossy), over the same feathers drawn on the skin (`createSkinMaterial`): clear of it, or
 * the two fight for depth and speckle. (Feather tips drawn on several low shells, lifted for relief, were tried first: the
 * tips came out as shards cut by their neighbours, the shells' lift showed as scribbled outlines close up and as a tweedy
 * speckle at a few metres, and the coat read as fur.)
 */
const FEATHER_LIFT = 0.06;
/**
 * The primary specular lobe's sharpness on feathers: broad. A feather's sheen lies across its whole vane; a sharp lobe
 * (120) along the groom, which runs round a head, drew a thin pale ring on the mallard's head and a smear on the hawk's brow.
 */
const FEATHER_EXP1 = 24;

/** Eyes the fur keeps clear of (more are rare; the rest just get the coat). */
const MAX_EYES = 4;
/** `furCoat` elements per region. */
const PER_REGION = 3;
/** Where the eyes start in the `furCoat` array (after the regions' elements). */
const EYE_BASE = PER_REGION * MAX_REGIONS;

/**
 * The coat settings per region, as one vec4 array (the fur material's only uniform buffer beyond the skin's six):
 * element 3i = (lean, radius, guard, guardLen), 3i+1 = (clump, crimp, droop, cell) with cell = `strandCell`, 3i+2 =
 * (sheen, feathers 1/0, `featherCell` (0 without feathers), 0); then MAX_EYES elements (eye centre at rest, eyeball
 * radius; radius 0 for none).
 */
export function packCoat(pack: RegionPack, eyes: EyePlace[] = []): Vector4[] {
  const v: Vector4[] = [];
  for (let i = 0; i < MAX_REGIONS; i++) {
    const c = pack.coat[i] >= 0 ? COAT_LOOK[COATS[pack.coat[i]]] : null;
    v.push(new Vector4(c?.lean ?? 0, c?.radius ?? 0, c?.guard ?? 0, c?.guardLen ?? 1));
    v.push(new Vector4(c?.clump ?? 0, c?.crimp ?? 0, c?.droop ?? 0, strandCell(pack.furLength[i], c?.density ?? 1)));
    const f = drawsFeathersAt(pack.coat[i]);
    v.push(new Vector4(c?.sheen ?? 0, f ? 1 : 0, f ? featherCell(pack.furLength[i]) : 0, 0));
  }
  for (let k = 0; k < MAX_EYES; k++) {
    const e = eyes[k];
    v.push(e ? new Vector4(e.centre.x, e.centre.y, e.centre.z, e.r) : new Vector4(1e4, 1e4, 1e4, 0));
  }
  return v;
}

/** The fur is short and upright from the eyeball's rim (× its radius) out to a radius plus most of a fur length (as far as
 * lying fur reaches) beyond it. */
const EYE_RIM = 1.1, EYE_REACH = 1.2;
/** The fur's length right round an eye, × its length. */
const EYE_LEN = 0.35;
/** A strand's least radius, in pixels: thinner, strands drop in and out of pixels and the coat goes grainy. */
const MIN_WIDTH = 0.75;
/** The coat's even shade far off, × its colour (close to the skin's, so gaps between strands don't speckle). */
const FAR_SHADE = 0.9;
/** Each strand's own shade, ± this (hairs are never all one colour). */
const STRAND_TONE = 0.1;
/** How much darker a strand is at its sides than along its middle (a round hair, not a flat disc). */
const STRAND_ROUND = 0.2;
/** Underfur strands stop here (in fur lengths) on coats with guard hairs: above it only the guard hairs show. */
const UNDER_TOP = 0.75;
/** Guard-hair cells per strand cell (a sparser, coarser lattice). */
const GUARD_CELL = 2.5;
/**
 * A guard hair's radius × an underfur strand's (both in strand cells: the guard lattice's own cells are GUARD_CELL times
 * larger). At 1.2 guard cells (3 × an underfur strand) they drew as wide pale leaves lying over the coat: shingles, not hair.
 */
const GUARD_THICK = 1.3;
/** Clump cells per strand cell. */
const CLUMP_CELL = 6;
/** How far the clump lattice wobbles, in clump cells. */
const CLUMP_WOBBLE = 0.6;
/** A strand's lean between two shells reaches at most this many cells (it is drawn as a segment; see `axis`). */
const MAX_STEP = 1.2;
/** Guard hairs catch the light more: their sheen × the coat's. */
const GUARD_SHEEN = 1.5;
/** The sheen far off (× the coat's), where strands are wider than they are (see `far`): each lit strand was a pale
 * speck on the darker underfur, and the coat looked frosted. */
const FAR_SHEEN = 0.3;
/**
 * How far out from the body (in fur lengths, along the normal) the fur looks up the shadows it receives. Near the outline
 * the body's own soft shadow edge lay over the fringe of hair and put out its backlit rim; looked up this far out, the
 * fringe is clear of it while the body's far side stays in its own shadow and shadows cast by anything else (ridges,
 * trees: far larger than a fur length) still fall on the coat.
 */
const SHADOW_LIFT = 1;
/** A rotation for the clump lattice, so clump borders don't line up with the strand grid or the body's axes. */
const ROT = [vec3(0.6683, -0.5632, 0.486), vec3(0.6652, 0.7448, -0.0516), vec3(-0.3329, 0.3578, 0.8724)];

/** Where a cell's strand stands: a random point in the middle half of the cell, so the coat doesn't show the grid. */
const jitterOf = (s: ReturnType<typeof cellSeed>) => vec3(hash(s), hash(s.add(uint(1))), hash(s.add(uint(2)))).mul(0.5).add(0.25);
/** How much of the offset along the skin's normal counts in a strand's distance (see `segDist`). */
const DEPTH_WEIGHT = 0.4;
/**
 * Distance from `l` to the segment from `j − a` to `j`, with the part along the rest normal `rn` weighted down: the skin
 * slices the 3D lattice at a different depth in each cell, and a round strand sliced off-centre showed thin or not at all
 * (a sparse, spotty coat); weighted, each strand is a rod standing through the skin's slice.
 */
function segDist(l: C, j: C, a: C, rn: C): F {
  const pa = l.sub(j).add(a);
  const h = clamp(dot(pa, a).div(dot(a, a).add(1e-6)), 0, 1);
  const v = pa.sub(a.mul(h));
  return length(v.sub(rn.mul(dot(v, rn).mul(1 - DEPTH_WEIGHT))));
}

/** The fur shells' material: three's standard one, lit as strands (`FurLightingModel`). */
class FurNodeMaterial extends MeshStandardNodeMaterial {
  strand: StrandInputs | null = null;
  setupLightingModel() {
    return this.strand ? new FurLightingModel(this.strand) : super.setupLightingModel();
  }
}

/**
 * The one material every fur shell of a creature (and of its whole species) shares: each shell's height, in fur lengths,
 * is read per object from `userData.shellT` (and the shell below's from `userData.shellPrev`). The shells reach
 * `material.userData.shellTop` fur lengths (the guard hairs). Null when no region has fur.
 *
 * Each shell is pushed out along the normal and slid along the groom (the hair's direction, posed by three's skinning: see
 * `lodGeometry`), so a strand rises from the skin and lies over towards the tail; on it, the strands are 3D lattice cells
 * scaled to the fur length, each drawn as the short segment its strand travels between this shell and the one below (so a
 * leaning hair reads as a line, not a stack of dots). Guard hairs come from a coarser lattice and reach higher; clumps pull
 * strand tips together; crimp waves them. Edges are a plain alpha test. Lit
 * as strands (`FurLightingModel`: two specular lobes along the strand, wrapped diffuse, a backlit rim), with the ambient
 * light × the cavity.
 */
export function furMaterial(pack: RegionPack, eyes: EyePlace[] = []): MeshStandardNodeMaterial | null {
  if (pack.furLength.every((l) => l <= 0)) return null;
  skinsTangent();
  const r = regionNodes(pack);
  const coat = uniformArray(packCoat(pack, eyes), 'vec4').setName('furCoat') as V4;
  type E = ReturnType<typeof vec4> & { x: F; y: F; z: F; w: F; xyz: C };
  // round the eyes the fur is short and stands up (lying fur slid over the eyeball and hid it)
  let eyeGap: F = float(1);
  for (let k = 0; k < MAX_EYES; k++) {
    const e = coat.element(EYE_BASE + k) as unknown as E;
    const beyond = length(r.bp.sub(e.xyz)).sub(e.w.mul(EYE_RIM));
    eyeGap = min(eyeGap, smoothstep(0, max(e.w.add(r.furLength.mul(EYE_REACH)), 1e-5), beyond));
  }
  // (plain expressions, not vars: since the fragment stage runs a Fn (`look`), three r186 also declared these vertex-only
  // vars there, unused, which cost a slot of the 16 WebGPU allows between the stages for the `feature` attribute)
  const clear = eyeGap;
  // no fur on the nose, lips or hooves, short fur inside the ears and round the eyes
  const len = r.furLength.mul(furCover(r)).mul(mix(float(EYE_LEN), float(1), clear));
  const t = uniform(0).onObjectUpdate(({ object }) => (object?.userData.shellT as number | undefined) ?? 0);
  const tp = uniform(0).onObjectUpdate(({ object }) => (object?.userData.shellPrev as number | undefined) ?? 0);
  const cA = coat.element(r.i.mul(PER_REGION)) as unknown as E, cB = coat.element(r.i.mul(PER_REGION).add(1)) as unknown as E;
  const cC = coat.element(r.i.mul(PER_REGION).add(2)) as unknown as E;
  // the feather shell stands straight up off the skin (no lean, wander or droop), so its feathers lie right over the skin's
  const plume = cC.y; // 1 where the region draws feathers
  const lean = cA.x.mul(clear).mul(float(1).sub(plume));
  const crimp = cB.y, droop = cB.z, cell = cB.w;

  // --- vertex: where this shell's surface lies ---
  // the posed normal and groom (re-orthogonalised: skinning blends them separately), no groom where there's none (eyes)
  const n = normalize(normalLocal).toVar();
  const gp = tangentLocal.sub(n.mul(dot(tangentLocal, n))).toVar();
  const gl = length(gp).toVar();
  const gs = select(gl.greaterThan(1e-4), gp.div(max(gl, 1e-4)), vec3(0)).toVar();
  const t15 = pow(t, 1.5), tp15 = pow(tp, 1.5);
  const wave = (x: F) => sin(x.mul(6 * Math.PI)).mul(crimp).mul(len).mul(0.15);
  const rise = n.mul(len.mul(mix(t.mul(max(float(1).sub(lean.mul(t)), 0.05)), float(FEATHER_LIFT), plume)));
  const along = gs.mul(len.mul(lean).mul(t15));
  const sag = vec3(0, -1, 0).mul(droop.mul(len).mul(t.mul(t)));
  // fluffy fur wanders (as before)
  const roam = mx_noise_vec3(r.bp.mul(40)).mul(r.fluff).mul(0.8).mul(float(1).sub(plume)).toVar();
  const wander = roam.mul(len).mul(t);
  const m = new FurNodeMaterial();
  m.positionNode = positionLocal.add(rise).add(along).add(sag).add(wander).add(cross(n, gs).mul(wave(t)));
  // the strand's direction for the strand lighting: its chord from the root to its tip (the shell offset at t = 1, over
  // len). The offset's derivative at each shell (the literal tangent) turns through up to 90° from root to tip on lean
  // coats, so each shell lit up at its own light angle and the highlight broke into bright flecks, one shell at a time.
  // A feather's is its groom: it lies flat along it.
  const chord = n.mul(max(float(1).sub(lean), 0.05)).add(gs.mul(lean)).add(vec3(0, -1, 0).mul(droop)).add(roam);
  const strandT = mix(chord, gs, plume);
  const tangentV = varying(modelViewMatrix.mul(vec4(strandT, 0)).xyz);

  // --- per vertex, for the strands (shells repeat 16–24 times, so the pixel work must stay small) ---
  // Everything that depends on the region's cell size is passed in metres and divided per pixel by the pixel's own region's
  // cell: divided per vertex, a triangle whose corners lie in regions of different cells interpolated between two lattice
  // scales (~50 cells swept across it) and drew a flat seam along every such border.
  const bpV = varying(r.bp), wobble = varying(mx_noise_vec3(r.bp.mul(25)));
  // the strand's slide from the shell below to this one, in the rest pose's lattice (rest groom, rest normal), in metres
  const rn = attribute('normal', 'vec3'), gr = r.groom;
  const step = gr.mul(len.mul(lean).mul(t15.sub(tp15)))
    .add(vec3(0, -1, 0).mul(droop.mul(len).mul(t.mul(t).sub(tp.mul(tp)))))
    .add(cross(rn, gr).mul(wave(t).sub(wave(tp))));
  const slide = varying(step.sub(rn.mul(dot(step, rn))));
  const restN = varying(rn);
  // the clump lattice wobbles (a straight lattice sliced by a flat flank drew its partings as long straight scratches);
  // bounded (CLUMP_WOBBLE), so across a border between cell sizes it only shifts the clumps a little, smoothly
  const clumpWarp = varying(mx_noise_vec3(r.bp.div(cell.mul(CLUMP_CELL * 3))).mul(CLUMP_WOBBLE));

  // --- per pixel (the coat settings of the pixel's own region: a clean switch at the border's midline) ---
  // feathers or strands, one branch per pixel (each costs a lattice search the other doesn't need). Out: (alpha, shade × the
  // colour, guard hair 1/0, far 0..1)
  const look = Fn(() => {
    // before the branches: the region's coat (its index is built from vars, which a branch would scope) and the derivative
    // (WGSL allows derivatives only in uniform control flow)
    const ca = cA.toVar(), cb = cB.toVar(), cc = cC.toVar();
    const fw = length(fwidth(bpV)).toVar();
    const out = vec4(0, 1, 0, 0).toVar();
    If(cc.y.greaterThan(0.5), () => {
      // feathers: the lowest shell draws them all (see FEATHER_LIFT); the shells above draw none
      If(tp.equal(0), () => {
        // the rest groom is the raw attribute (the cavity already brings it to this stage; a varying of its own would be the 17th)
        const f = feathersAt(bpV, cc.z, gr, restN, fw);
        // not over a triangle that reaches into a region without feathers (the length, and the colour, interpolated
        // across it): there the shell drew a band of mixed colour and a lifted edge along the border; the skin beneath
        // has the same feathers
        const whole = (coat.element(r.across.mul(PER_REGION).add(2)) as unknown as E).y.greaterThan(0.5);
        out.assign(vec4(select(f.found.and(whole), float(1), float(0)), f.shade, 0, 0));
      });
    }).Else(() => {
      const cellF = cb.w;
      // the lattice: cells scaled to the region's fur length; offset keeps ids clear of zero; a little noise breaks up moiré
      const P = bpV.div(cellF).add(1000).add(wobble.mul(1.5)).toVar();
      const flat = slide.div(cellF).toVar();
      const axis = flat.mul(min(1, float(MAX_STEP).div(max(length(flat), 1e-6)))).toVar();
      // cells per pixel: far off a strand is thinner than a pixel and the coat would sparkle, so strands widen to stay about
      // 1.5 pixels wide (and the shading across and along them flattens, below), and the coat reads as a soft, even nap
      const px = fw.div(cellF).mul(0.5).toVar();
      const far = smoothstep(0.25, 1, px).toVar();
      const rad = ca.y, gShare = ca.z, gLen = ca.w, clumpK = min(cb.x.mul(t), 0.6).toVar();
      // clumps: the lattice is sampled spread out from each clump's centre, so its strands' tips gather (by clump × t);
      // past the clump's edge strands thin, a parting where clumps gather strongly
      const K = vec3(dot(P, ROT[0]), dot(P, ROT[1]), dot(P, ROT[2])).div(CLUMP_CELL).add(clumpWarp).toVar();
      const kc = floor(K).toVar();
      const centre = kc.add(jitterOf(cellSeed(kc)));
      const Kq = centre.add(K.sub(centre).div(float(1).sub(clumpK))).toVar();
      const shift = Kq.sub(K).mul(CLUMP_CELL);
      const q = P.add(ROT[0].mul(shift.x)).add(ROT[1].mul(shift.y)).add(ROT[2].mul(shift.z)).toVar();
      const inside = Kq.sub(kc).sub(0.5).toVar();
      const edge = float(0.5).sub(max(max(abs(inside.x), abs(inside.y)), abs(inside.z)));
      const parting = mix(float(1), smoothstep(0, 0.04, edge), smoothstep(0.1, 0.4, clumpK));
      const a = axis.div(float(1).sub(clumpK)).toVar();

      // underfur: the cell the pixel is in and the one downstream (whose strand's segment may reach back into this one);
      // each strand tapers, has its own length (0.6–1, cut at UNDER_TOP when guard hairs stand above it) and a rounded end
      const underTop = select(gShare.greaterThan(0), float(UNDER_TOP), float(1));
      const taper = max(rad.mul(float(1).sub(t.mul(0.7))), min(px.mul(MIN_WIDTH), 0.45)).mul(parting).toVar();
      /** A strand's alpha (its edge at 0.5) and shade: its own tone, darker at its sides. */
      const strand = (rr: F, d: F, h: F) => ({
        alpha: float(0.5).add(rr.sub(d)).toVar(),
        tone: float(1 + STRAND_TONE).sub(fract(h.mul(3.71)).mul(2 * STRAND_TONE)).mul(float(1).sub(pow(clamp(d.div(max(rr, 1e-3)), 0, 1), 2).mul(STRAND_ROUND))),
      });
      const under = (o: C) => {
        const s = cellSeed(o).toVar();
        const h = hash(s.add(uint(3))).toVar();
        const own = min(underTop, fract(h.mul(7.13)).mul(0.4).add(0.6));
        const rr = taper.mul(smoothstep(0, 0.1, own.sub(t))).mul(select(h.greaterThan(0.1), float(1), float(0))).toVar();
        return strand(rr, segDist(q.sub(o), jitterOf(s), a, restN).toVar(), h);
      };
      const u1 = under(floor(q)), u2 = under(floor(q.add(a)));
      const alphaU = max(u1.alpha, u2.alpha).toVar();
      // guard hairs: a sparser lattice (share `guard` of its cells), thicker, reaching guardLen
      const G = P.div(GUARD_CELL).add(vec3(0.37, 0.71, 0.13)).toVar();
      const og = floor(G);
      const sg = cellSeed(og).toVar();
      const hg = hash(sg.add(uint(3))).toVar();
      const gOwn = gLen.mul(fract(hg.mul(5.31)).mul(0.15).add(0.85));
      const rg = max(rad.mul(GUARD_THICK / GUARD_CELL).mul(float(1).sub(t.mul(0.6))), min(px.mul(MIN_WIDTH / GUARD_CELL), 0.45)).mul(smoothstep(0, 0.08, gOwn.sub(t))).mul(select(hg.lessThan(gShare), float(1), float(0)));
      const gs1 = strand(rg.toVar(), segDist(G.sub(og), jitterOf(sg), axis.div(GUARD_CELL), restN).toVar(), hg);
      const alphaG = gs1.alpha;
      // where a guard hair is drawn: they catch the light more (the strand lighting gives them their own sheen)
      const isGuard = alphaG.greaterThan(alphaU).toVar('isGuard');
      const tone = select(isGuard, gs1.tone, select(u1.alpha.greaterThan(u2.alpha), u1.tone, u2.tone));
      // fur is darker near the skin (self-shadowing), lighter at the tips
      const shade = mix(mix(float(0.6), float(1), smoothstep(0, 1, t)).mul(tone), float(FAR_SHADE), far);
      out.assign(vec4(max(alphaU, alphaG), shade, select(isGuard, float(1), float(0)), far));
    });
    return out;
  })() as unknown as E;
  m.userData.shellTop = shellTop(pack);
  // a coat of only feathers needs no shell above the lowest (`createFurShells`)
  m.userData.featherOnly = pack.furLength.every((l, i) => l <= 0 || drawsFeathersAt(pack.coat[i]));

  const lenV = varying(len);
  m.opacityNode = select(lenV.greaterThan(0.0005), clamp(look.x, 0, 1), float(0));
  // a plain cut. Alpha to coverage (three r186, WebGPU on Chrome/Windows) drew every pixel a strand only partly covered
  // darker, towards grey, not as a mix of the strand and what lay behind: a dark outline round each strand close up, and
  // at a few metres, where strands are about a pixel, a salt-and-pepper coat (the "grey, dithered" fur)
  m.alphaTest = 0.5;
  m.alphaToCoverage = false;
  // feathers take their pattern (bars, spots) per pixel: the colour is passed per vertex, and on a bird's large triangles a
  // pattern sampled at the corners blurred away (the hawk's barring); the fur keeps its per-vertex pattern (soft-edged in a
  // coat anyway, and on 16 shells the pattern's noise per pixel would cost)
  const colV = varying(markedColor({ ...r, colorNode: mix(r.plainColor, r.patternColor, r.patternOf(r.rn as unknown as C).mul(float(1).sub(r.feathers))) as unknown as typeof r.colorNode }));
  const colour = Fn(() => {
    const c = colV.toVar();
    If(cC.y.greaterThan(0.5), () => c.assign(mix(c, r.patternColor, r.patternOf(restN as unknown as C))));
    return c;
  })() as unknown as C;
  m.colorNode = colour.mul(look.y);
  const guardHair = look.z.greaterThan(0.5);
  m.roughnessNode = select(guardHair, float(0.8), float(0.95));
  m.aoNode = r.cavity; // ambient × cavity (and × the root darkening, already in the colour)
  // three r186 reads a material's `receivedShadowPositionNode` for the world position its received shadows are looked up at
  probe('receivedShadowPositionNode' in m, "NodeMaterial has no receivedShadowPositionNode, so the body's own shadow edge puts out the fur's backlit rim (fur.ts)");
  m.receivedShadowPositionNode = positionWorld.add(normalWorld.mul(lenV.mul(SHADOW_LIFT)));
  m.strand = {
    tangent: normalize(tangentV), t,
    sheen: cC.x.mul(select(guardHair, float(GUARD_SHEEN), float(1))).mul(mix(float(1), float(FAR_SHEEN), look.w)),
    exp1: select(cC.y.greaterThan(0.5), float(FEATHER_EXP1), float(STRAND.exp1)),
  };
  return m;
}

/** Layers of shells over the body that, seen together, look like soft fur or lifted feather tips (all in one `furMaterial`). */
export function createFurShells(base: SkinnedMesh<BufferGeometry, Material>, material: Material | null, count: number): SkinnedMesh<BufferGeometry, Material>[] {
  if (count <= 0 || !material) return [];
  const all = furShellOffsets(count, (material.userData.shellTop as number | undefined) ?? 1);
  // feathers draw only on the lowest shell: a coat of nothing else skips the rest
  const offsets = material.userData.featherOnly ? all.slice(0, 1) : all;
  return offsets.map((t, k) => {
    const shell = new SkinnedMesh<BufferGeometry, Material>(base.geometry, material);
    shell.userData.shellT = t;
    shell.userData.shellPrev = k > 0 ? offsets[k - 1] : 0;
    shell.name = `fur${k}`;
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = k + 1;
    shell.bind(base.skeleton, base.bindMatrix);
    return shell;
  });
}
