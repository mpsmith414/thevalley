import { MeshStandardNodeMaterial, SkinnedMesh, Vector4, type BufferGeometry, type Material, type Node } from 'three/webgpu';
import {
  abs, attribute, clamp, cross, dot, float, floor, fract, fwidth, hash, int, length, max, min, mix, mx_noise_vec3, normalize, normalLocal,
  positionLocal, pow, select, sin, smoothstep, tangentLocal, uint, uniform, uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { COATS, MAX_REGIONS } from '../recipe/schema';
import { skinsTangent } from '../render/probe';
import { COAT_LOOK, strandCell } from './coat';
import type { EyePlace } from './eyes';
import { markedColor, regionNodes } from './material';
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

/** Eyes the fur keeps clear of (more are rare; the rest just get the coat). */
const MAX_EYES = 4;
/** Where the eyes start in the `furCoat` array (after two elements per region). */
const EYE_BASE = 2 * MAX_REGIONS;

/**
 * The coat settings per region, as one vec4 array (the fur material's only uniform buffer beyond the skin's six):
 * element 2i = (lean, radius, guard, guardLen), 2i+1 = (clump, crimp, droop, cell) with cell = `strandCell`; then
 * MAX_EYES elements (eye centre at rest, eyeball radius; radius 0 for none).
 */
export function packCoat(pack: RegionPack, eyes: EyePlace[] = []): Vector4[] {
  const v: Vector4[] = [];
  for (let i = 0; i < MAX_REGIONS; i++) {
    const c = pack.coat[i] >= 0 ? COAT_LOOK[COATS[pack.coat[i]]] : null;
    v.push(new Vector4(c?.lean ?? 0, c?.radius ?? 0, c?.guard ?? 0, c?.guardLen ?? 1));
    v.push(new Vector4(c?.clump ?? 0, c?.crimp ?? 0, c?.droop ?? 0, strandCell(pack.furLength[i], c?.density ?? 1)));
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
/** A strand's least radius, in pixels: thinner, alpha to coverage dithers it and the coat goes grainy. */
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
/** Clump cells per strand cell. */
const CLUMP_CELL = 6;
/** How far the clump lattice wobbles, in clump cells. */
const CLUMP_WOBBLE = 0.6;
/** A strand's lean between two shells reaches at most this many cells (it is drawn as a segment; see `axis`). */
const MAX_STEP = 1.2;
/** A rotation for the clump lattice, so clump borders don't line up with the strand grid or the body's axes. */
const ROT = [vec3(0.6683, -0.5632, 0.486), vec3(0.6652, 0.7448, -0.0516), vec3(-0.3329, 0.3578, 0.8724)];

/** A uint seed for a lattice cell (`o` integer-valued; negative cells are fine: i32 → u32 keeps the bits). */
function cellSeed(o: C) {
  const u = (x: F) => int(x).toUint();
  return u(o.x).mul(uint(73856093)).bitXor(u(o.y).mul(uint(19349663))).bitXor(u(o.z).mul(uint(83492791)));
}
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

/**
 * The one material every fur shell of a creature (and of its whole species) shares: each shell's height, in fur lengths,
 * is read per object from `userData.shellT` (and the shell below's from `userData.shellPrev`). The shells reach
 * `material.userData.shellTop` fur lengths (the guard hairs). Null when no region has fur.
 *
 * Each shell is pushed out along the normal and slid along the groom (the hair's direction, posed by three's skinning: see
 * `lodGeometry`), so a strand rises from the skin and lies over towards the tail; on it, the strands are 3D lattice cells
 * scaled to the fur length, each drawn as the short segment its strand travels between this shell and the one below (so a
 * leaning hair reads as a line, not a stack of dots). Guard hairs come from a coarser lattice and reach higher; clumps pull
 * strand tips together; crimp waves them. Edges use alpha to coverage (MSAA), with the alpha test as the fallback.
 */
export function furMaterial(pack: RegionPack, eyes: EyePlace[] = []): MeshStandardNodeMaterial | null {
  if (pack.furLength.every((l) => l <= 0)) return null;
  skinsTangent();
  const r = regionNodes(pack), f = r.feature;
  const coat = uniformArray(packCoat(pack, eyes), 'vec4').setName('furCoat') as V4;
  type E = ReturnType<typeof vec4> & { x: F; y: F; z: F; w: F; xyz: C };
  // round the eyes the fur is short and stands up (lying fur slid over the eyeball and hid it)
  let eyeGap: F = float(1);
  for (let k = 0; k < MAX_EYES; k++) {
    const e = coat.element(EYE_BASE + k) as unknown as E;
    const beyond = length(r.bp.sub(e.xyz)).sub(e.w.mul(EYE_RIM));
    eyeGap = min(eyeGap, smoothstep(0, max(e.w.add(r.furLength.mul(EYE_REACH)), 1e-5), beyond));
  }
  const clear = eyeGap.toVar();
  // no fur on the nose, lips or hooves, short fur inside the ears and round the eyes
  const len = r.furLength.mul(float(1).sub(max(max(f.x, f.z), max(f.w, f.y.mul(0.7))))).mul(mix(float(EYE_LEN), float(1), clear)).toVar();
  const t = uniform(0).onObjectUpdate(({ object }) => (object?.userData.shellT as number | undefined) ?? 0);
  const tp = uniform(0).onObjectUpdate(({ object }) => (object?.userData.shellPrev as number | undefined) ?? 0);
  const cA = coat.element(r.i.mul(2)) as unknown as E, cB = coat.element(r.i.mul(2).add(1)) as unknown as E;
  const lean = cA.x.mul(clear), radius = cA.y, guard = cA.z, guardLen = cA.w;
  const clump = cB.x, crimp = cB.y, droop = cB.z, cell = cB.w;

  // --- vertex: where this shell's surface lies ---
  // the posed normal and groom (re-orthogonalised: skinning blends them separately), no groom where there's none (eyes)
  const n = normalize(normalLocal).toVar();
  const gp = tangentLocal.sub(n.mul(dot(tangentLocal, n))).toVar();
  const gl = length(gp).toVar();
  const gs = select(gl.greaterThan(1e-4), gp.div(max(gl, 1e-4)), vec3(0)).toVar();
  const t15 = pow(t, 1.5), tp15 = pow(tp, 1.5);
  const wave = (x: F) => sin(x.mul(6 * Math.PI)).mul(crimp).mul(len).mul(0.15);
  const rise = n.mul(len.mul(t).mul(max(float(1).sub(lean.mul(t)), 0.05)));
  const along = gs.mul(len.mul(lean).mul(t15));
  const sag = vec3(0, -1, 0).mul(droop.mul(len).mul(t.mul(t)));
  // fluffy fur wanders (as before)
  const wander = mx_noise_vec3(r.bp.mul(40)).mul(r.fluff).mul(len).mul(t).mul(0.8);
  const m = new MeshStandardNodeMaterial();
  m.positionNode = positionLocal.add(rise).add(along).add(sag).add(wander).add(cross(n, gs).mul(wave(t)));

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
  const cellF = cB.w.toVar();
  // the lattice: cells scaled to the region's fur length; offset keeps ids clear of zero; a little noise breaks up moiré
  const P = bpV.div(cellF).add(1000).add(wobble.mul(1.5)).toVar();
  const flat = slide.div(cellF).toVar();
  const axis = flat.mul(min(1, float(MAX_STEP).div(max(length(flat), 1e-6)))).toVar();
  // cells per pixel: far off a strand is thinner than a pixel and the coat would sparkle, so strands widen to stay about
  // 1.5 pixels wide (and the shading across and along them flattens, below), and the coat reads as a soft, even nap
  const px = length(fwidth(bpV)).div(cellF).mul(0.5).toVar();
  const far = smoothstep(0.25, 1, px).toVar();
  const rad = radius, gShare = guard, gLen = guardLen, clumpK = min(clump.mul(t), 0.6).toVar();
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
  const rg = max(rad.mul(1.2).mul(float(1).sub(t.mul(0.6))), min(px.mul(MIN_WIDTH / GUARD_CELL), 0.45)).mul(smoothstep(0, 0.08, gOwn.sub(t))).mul(select(hg.lessThan(gShare), float(1), float(0)));
  const gs1 = strand(rg.toVar(), segDist(G.sub(og), jitterOf(sg), axis.div(GUARD_CELL), restN).toVar(), hg);
  const alphaG = gs1.alpha;
  // where a guard hair is drawn: they catch the light more (the strand lighting gives them their own sheen)
  const isGuard = alphaG.greaterThan(alphaU).toVar('isGuard');
  const tone = select(isGuard, gs1.tone, select(u1.alpha.greaterThan(u2.alpha), u1.tone, u2.tone));
  m.userData.shellTop = shellTop(pack);

  m.opacityNode = select(varying(len).greaterThan(0.0005), clamp(max(alphaU, alphaG), 0, 1), float(0));
  m.alphaTest = 0.5; // with MSAA, alpha to coverage turns the test into a smooth, one-pixel edge; without it, a plain cut
  m.alphaToCoverage = true;
  // fur is darker near the skin (self-shadowing), lighter at the tips
  m.colorNode = varying(markedColor(r)).mul(mix(mix(float(0.6), float(1), smoothstep(0, 1, t)).mul(tone), float(FAR_SHADE), far));
  m.roughnessNode = select(isGuard, float(0.8), float(0.95));
  return m;
}

/** Layers of shells over the body that, seen together, look like soft fur (all in one `furMaterial`). */
export function createFurShells(base: SkinnedMesh<BufferGeometry, Material>, material: Material | null, count: number): SkinnedMesh<BufferGeometry, Material>[] {
  if (count <= 0 || !material) return [];
  const offsets = furShellOffsets(count, (material.userData.shellTop as number | undefined) ?? 1);
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
