/**
 * The Valley's ground: six CC0 photo texture sets (meadow, forest floor, granite, moss, sand, mud) blended by the biome maps.
 * Each kind of map is one array texture (a layer per set), so the whole ground costs two texture bindings.
 */
import {
  DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardNodeMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  UnsignedByteType, type Node, type NodeBuilder,
} from 'three/webgpu';
import {
  Fn, If, abs, cameraPosition, cameraViewMatrix, clamp, color, dFdx, dFdy, diffuseColor, float, floor, fract, int, ivec2, max, mix,
  mx_noise_float, normalize, positionWorld, pow, round, select, sin, smoothstep, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import type { Tier } from '../render/quality';
import { WORLD_QUALITY } from './quality';
import type { ValleyTextures } from './textures';

/** The ground sets, in layer order. */
export const GROUND_SETS = ['meadow', 'forest', 'granite', 'moss', 'sand', 'mud'] as const;
export type GroundSetName = (typeof GROUND_SETS)[number];
/** Stand-in colours (the old debug colours) for a set whose files fail to load. */
const FLAT: Record<GroundSetName, [number, number, number]> = {
  meadow: [122, 154, 69], forest: [47, 74, 38], granite: [138, 138, 132], moss: [70, 96, 44], sand: [216, 201, 160], mud: [107, 90, 64],
};

/**
 * The loaded ground: per layer, `albedo` holds the diffuse colour (sRGB) with roughness in alpha; `normal` the GL normal map.
 * `average` is each set's mean colour (linear) and roughness: what its texture blurs to far away.
 */
export type GroundSets = {
  size: number; albedo: DataArrayTexture; normal: DataArrayTexture; average: Record<GroundSetName, [number, number, number, number]>;
  missing: GroundSetName[];
};

const toLinear = (b: number) => (b / 255) ** 2.2;
/** Mean linear colour and roughness of RGBA bytes (sRGB diffuse in RGB, roughness in A), from a sparse sample. */
function mean(d: Uint8Array, from: number, to: number): [number, number, number, number] {
  const m = [0, 0, 0, 0];
  let n = 0;
  for (let p = from; p < to; p += 4 * 37) {
    m[0] += toLinear(d[p]); m[1] += toLinear(d[p + 1]); m[2] += toLinear(d[p + 2]); m[3] += d[p + 3] / 255;
    n++;
  }
  return [m[0] / n, m[1] / n, m[2] / n, m[3] / n];
}

/** Fetch an image file (the dev server answers a missing file with HTML, so check the type). */
async function download(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`${url}: ${res.status}`);
  return res.blob();
}

/** Decode a JPG into RGBA bytes at the canvas's size, rows flipped so the image's top lands at v = 1 (three's convention). */
async function pixels(blob: Blob, g: OffscreenCanvasRenderingContext2D): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'flipY' });
  const { width, height } = g.canvas;
  g.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return g.getImageData(0, 0, width, height).data;
}

function arrayTexture(data: Uint8Array, size: number, layers: number, srgb: boolean): DataArrayTexture {
  const t = new DataArrayTexture(data, size, size, layers);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  t.onUpdate = () => ((t.image as { data: Uint8Array | null }).data = null); // uploaded: let the CPU copy go
  return t;
}

/**
 * Load the ground sets for `tier` (2k or 1k files) into two array textures. The files download in parallel but decode one at
 * a time, each straight into its layer, so only one image's pixels live beside the two arrays (decoding all 18 at once peaked
 * near 500 MB). A set whose files fail falls back to a flat colour (and a warning), so the valley always renders.
 */
export async function loadGroundSets(tier: Tier, base = `${import.meta.env.BASE_URL}assets/textures/ground`): Promise<GroundSets> {
  const size = WORLD_QUALITY[tier].textureSize, res = size === 2048 ? '2k' : '1k', px = size * size * 4, n = GROUND_SETS.length;
  const albedo = new Uint8Array(px * n), normal = new Uint8Array(px * n), missing: GroundSetName[] = [];
  const files = GROUND_SETS.map((name) => (['diff', 'nor_gl', 'rough'] as const).map((m) => download(`${base}/${name}_${m}_${res}.jpg`)));
  for (const f of files.flat()) f.catch(() => {}); // a failure is handled when its set comes up, not reported as unhandled first
  const g = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
  for (const [i, name] of GROUND_SETS.entries()) {
    const at = i * px, [diff, nor, rough] = files[i];
    try {
      const d = await pixels(await diff, g);
      for (let p = 0; p < px; p += 4) { albedo[at + p] = d[p]; albedo[at + p + 1] = d[p + 1]; albedo[at + p + 2] = d[p + 2]; }
      const r = await pixels(await rough, g);
      for (let p = 3; p < px; p += 4) albedo[at + p] = r[p - 3];
      normal.set(await pixels(await nor, g), at);
    } catch (e) {
      console.warn(`ground set "${name}" failed to load; using a flat colour`, e);
      missing.push(name);
      const [cr, cg, cb] = FLAT[name];
      for (let p = 0; p < px; p += 4) {
        albedo[at + p] = cr; albedo[at + p + 1] = cg; albedo[at + p + 2] = cb; albedo[at + p + 3] = 235;
        normal[at + p] = 128; normal[at + p + 1] = 128; normal[at + p + 2] = 255; normal[at + p + 3] = 255;
      }
    }
  }
  g.canvas.width = g.canvas.height = 0; // let the canvas's backing store go now, not at the next collection
  const average = Object.fromEntries(GROUND_SETS.map((s, i) => [s, mean(albedo, i * px, (i + 1) * px)])) as GroundSets['average'];
  return { size, albedo: arrayTexture(albedo, size, n, true), normal: arrayTexture(normal, size, n, false), average, missing };
}

/** Metres per tile of each set. Against tiling, the tile is shifted by an offset that changes over about `BIG` metres. */
const TILE: Record<GroundSetName, number> = { meadow: 4, forest: 4, granite: 6, moss: 3, sand: 4, mud: 4 };
const BIG = 23;
/** Per-set colour grading (rgb gain, then saturation), so the photos sit together as one northern valley. */
const GRADE: Record<GroundSetName, [number, number, number, number]> = {
  meadow: [0.95, 1, 0.92, 0.95], forest: [0.5, 0.48, 0.38, 0.6], granite: [0.48, 0.48, 0.47, 0.8], moss: [0.52, 0.56, 0.4, 0.75],
  sand: [0.98, 0.92, 0.8, 0.9], mud: [0.85, 0.85, 0.85, 1],
};
/** Weights below this skip their set's samples. */
const SKIP = 0.02;
/**
 * Between `FAR0` and `FAR1` metres the photo textures fade to each set's average colour; beyond, they are not sampled at all
 * (no tile pattern can show, and most of a wide view costs no texture reads). Detail normals end at `NORMALS` metres.
 */
const FAR0 = 160, FAR1 = 420, NORMALS = 200;
const layer = (s: GroundSetName) => int(GROUND_SETS.indexOf(s));
type Grad = [Node<'vec2'>, Node<'vec2'>];

/**
 * Fractal noise in about [-1, 1]. Perlin noise is exactly zero on its lattice, so with whole-number octave ratios every octave
 * crosses zero at the same points and thresholded patches line up in a grid: each octave is turned and scaled by 2.13 instead.
 */
function fbm(p: Node<'vec2'>, octaves = 2): Node<'float'> {
  let sum: Node<'float'> = float(0), amp = 1, norm = 0, q = p;
  for (let i = 0; i < octaves; i++) {
    sum = sum.add(mx_noise_float(q.add(vec2(17.3 * i, 5.1 * i))).mul(amp));
    norm += amp;
    amp *= 0.5;
    q = vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8))).mul(2.13); // turned about 37°
  }
  return sum.div(norm * 0.6);
}

/**
 * A standard material whose colour comes from `groundColorNode` instead of `colorNode`. The shadow pass reads `colorNode.a`
 * (for alpha), so with the ground in `colorNode` every shadow cascade ran the whole ground shader.
 */
class GroundMaterial extends MeshStandardNodeMaterial {
  groundColorNode: Node<'vec3'> | null = null;
  setupDiffuseColor(builder: NodeBuilder) {
    super.setupDiffuseColor(builder);
    if (this.groundColorNode) diffuseColor.rgb.assign(this.groundColorNode);
  }
}

/**
 * The biome-blended ground: weights from `biomeA`/`biomeB`, moss on rock tops and in damp forest, planar sets with
 * anti-tiling, triplanar granite, macro tint, cavity, wet margins by the water, and detail normals whiteout-blended into the
 * terrain normal. Sets whose weight is near zero are not sampled, and far ground uses each set's average colour. Low tier
 * skips the detail normals and the second (anti-tiling) sample. The water is tinted until the lake gets its own surface.
 */
export function createGroundMaterial(tex: ValleyTextures, sets: GroundSets, tier: Tier): MeshStandardNodeMaterial {
  const low = tier === 'low';
  const xz = positionWorld.xz, y = positionWorld.y, p = positionWorld;
  const nt = texture(tex.normalTex, tex.worldToUv(xz));
  const uv = tex.mapUv(xz), biomeA = texture(tex.biomeA, uv), biomeB = texture(tex.biomeB, uv);
  const PLANAR = ['meadow', 'forest', 'moss', 'sand', 'mud'] as const;
  const k = (s: GroundSetName) => 1 / TILE[s], kg = k('granite');
  const avg = (s: GroundSetName) => vec4(...sets.average[s]);
  const sample = (arr: DataArrayTexture, s: GroundSetName, u: Node<'vec2'>, du: Grad) => texture(arr, u).depth(layer(s)).grad(du[0], du[1]);

  /**
   * Everything the branches share, made into variables at the top of a shader function. Inside a branch, derivatives are
   * undefined, and three declares a shared value where it is first used, so a value first used in one set's branch would be
   * missing in the next set's. Includes the set weights (with moss), the planar gradients and granite's triplanar frames.
   */
  const frame = () => {
    const gx = dFdx(xz).toVar(), gy = dFdy(xz).toVar(), px = dFdx(p).toVar(), py = dFdy(p).toVar();
    const footprint = max(gx.length(), gy.length()).toVar(), dist = p.sub(cameraPosition).length().toVar();
    const a = biomeA.toVar(), b = biomeB.toVar(), N = normalize(nt.rgb.mul(2).sub(1)).toVar();
    // Ragged patches, `period` metres across (`bias` above 0 makes them fewer), faded to their average where a pixel covers
    // too much of them to show, so they never shimmer.
    const patches = (period: number, bias: number, edge: number, mean: number) => {
      const n = fbm(xz.div(period).add(period * 7.3)).mul(0.5).add(0.5), mid = 0.5 + bias;
      return mix(smoothstep(mid - edge, mid + edge, n), mean, smoothstep(period * 0.02, period * 0.08, footprint));
    };
    // moss on flat-ish rock tops, and on half the forest floor (more where it is damp). (Not inside an `If`: three then mixed
    // up the branch's variables with the surface function's, and stretches of rock lost their texture.)
    const mossRock = a.b.mul(smoothstep(0.55, 0.75, N.y)).mul(patches(9, 0.06, 0.04, 0.35)).toVar();
    const mossForest = a.r.mul(patches(14, -0.03, 0.12, 0.55)).mul(mix(0.5, 0.9, smoothstep(0.3, 0.8, b.g))).toVar();
    const w: Record<GroundSetName, Node<'float'>> = {
      meadow: a.g, forest: a.r.sub(mossForest), granite: a.b.sub(mossRock), moss: mossRock.add(mossForest), sand: a.a, mud: b.r,
    };
    // Anti-tiling (after Inigo Quilez): a slow noise picks one of eight shifted copies of the tile, blending each into the
    // next, so neighbouring stretches of ground never show the same repeat.
    const l = mx_noise_float(xz.div(BIG)).mul(0.5).add(0.5).mul(8).toVar(), ia = floor(l);
    const offA = sin(vec2(3, 7).mul(ia)).toVar(), offB = sin(vec2(3, 7).mul(ia.add(1))).toVar(), f = fract(l).toVar();
    const bw = pow(abs(N), vec3(4)).toVar();
    bw.divAssign(bw.x.add(bw.y).add(bw.z));
    return {
      N, dist, w, offA, offB, f,
      grads: (s: GroundSetName): Grad => [gx.mul(k(s)), gy.mul(k(s))],
      tri: [
        { u: p.zy.mul(kg), g: [px.zy.mul(kg), py.zy.mul(kg)] as Grad, w: bw.x },
        { u: p.xz.mul(kg), g: [px.xz.mul(kg), py.xz.mul(kg)] as Grad, w: bw.y },
        { u: p.xy.mul(kg), g: [px.xy.mul(kg), py.xy.mul(kg)] as Grad, w: bw.z },
      ],
    };
  };

  const grade = (c: Node<'vec3'>, s: GroundSetName) => {
    const g = GRADE[s], tinted = c.mul(vec3(g[0], g[1], g[2]));
    return mix(vec3(tinted.dot(vec3(0.2126, 0.7152, 0.0722))), tinted, g[3]);
  };
  /** Albedo (rgb) and roughness (a), sampling only the sets with weight, and only near enough to tell. */
  const surface = Fn(() => {
    const { dist, w, grads, tri, offA, offB, f } = frame(), acc = vec4(0).toVar(), total = float(0).toVar();
    const far = smoothstep(FAR0, FAR1, dist).toVar();
    const add = (s: GroundSetName, sampled: () => Node<'vec4'>) => {
      If(w[s].greaterThan(SKIP), () => {
        const c = avg(s).toVar();
        If(dist.lessThan(FAR1), () => { // a fresh test per set: a shared one is declared inside the first set's branch
          c.assign(mix(sampled(), c, far));
        });
        acc.addAssign(vec4(grade(c.rgb, s), c.a).mul(w[s]));
        total.addAssign(w[s]);
      });
    };
    for (const s of PLANAR) add(s, () => {
      const u = xz.mul(k(s)), ca = sample(sets.albedo, s, low ? u : u.add(offA), grads(s));
      if (low) return ca;
      const cb = sample(sets.albedo, s, u.add(offB), grads(s));
      return mix(ca, cb, smoothstep(0.2, 0.8, f.sub(ca.rgb.sub(cb.rgb).dot(vec3(0.1)))));
    });
    // granite: triplanar, so cliffs stay crisp instead of smearing
    add('granite', () => tri.reduce<Node<'vec4'>>((sum, t) => sum.add(sample(sets.albedo, 'granite', t.u, t.g).mul(t.w)), vec4(0)));
    return acc.div(max(total, 1e-4));
  });

  /** The terrain normal with each set's detail normal whiteout-blended in (world space), out to `NORMALS` metres. */
  const detailNormal = Fn(() => {
    const { N, dist, w, grads, tri, offA, offB, f } = frame(), out = N.toVar();
    If(dist.lessThan(NORMALS), () => {
      const detail = float(1).sub(smoothstep(NORMALS * 0.3, NORMALS, dist)).toVar(), acc = vec3(0).toVar(), total = float(0).toVar();
      for (const s of PLANAR) {
        If(w[s].greaterThan(SKIP), () => {
          const u = xz.mul(k(s)).add(select(f.greaterThan(0.5), offB, offA)); // the copy that dominates the colour
          const d = sample(sets.normal, s, u, grads(s)).rgb.mul(2).sub(1);
          // u runs along +x and v along +z
          acc.addAssign(vec3(N.x.add(d.x.mul(detail)), N.y.mul(mix(1, d.z, detail)), N.z.add(d.y.mul(detail))).mul(w[s]));
          total.addAssign(w[s]);
        });
      }
      If(w.granite.greaterThan(SKIP), () => {
        // whiteout per projection (after Ben Golus), swizzled back into world space
        const t = tri.map((t) => sample(sets.normal, 'granite', t.u, t.g).rgb.mul(2).sub(1).mul(vec3(detail, detail, 1)));
        const nx = vec3(t[0].xy.add(N.zy), abs(t[0].z).mul(N.x)), ny = vec3(t[1].xy.add(N.xz), abs(t[1].z).mul(N.y));
        const nz = vec3(t[2].xy.add(N.xy), abs(t[2].z).mul(N.z));
        acc.addAssign(nx.zyx.mul(tri[0].w).add(ny.xzy.mul(tri[1].w)).add(nz.mul(tri[2].w)).mul(w.granite));
        total.addAssign(w.granite);
      });
      out.assign(normalize(acc.add(N.mul(max(float(SKIP).sub(total), 0))))); // nothing sampled: the terrain normal
    });
    return out;
  });

  const surf = surface() as Node<'vec4'>;
  const normal = low ? normalize(nt.rgb.mul(2).sub(1)) : (detailNormal() as Node<'vec3'>);

  // ---------- large-scale life: macro tint, cavity, wet margins ----------
  const macro = fbm(xz.div(160)), hue = mx_noise_float(xz.div(240).add(57.3));
  let colour: Node<'vec3'> = surf.rgb.mul(float(1).add(macro.mul(0.1)));
  colour = colour.mul(vec3(float(1).add(hue.mul(0.04)), 1, float(1).sub(hue.mul(0.04))));
  colour = colour.mul(clamp(float(1).sub(nt.a.sub(0.5).mul(1.6)), 0.75, 1)); // 128 is flat; hollows hold more, so darker
  const wet = smoothstep(0.76, 0.9, biomeB.g); // fully wet within about 4 m of the water, dry by 11 m (moisture = e^(−d/40))
  colour = colour.mul(mix(1, 0.6, wet));
  // Dry ground is never glossy. Wet ground is smoother, but not so smooth that the sky's sheen at a low angle outshines the
  // darkening (at 0.35 the wet band read lighter than the dry sand).
  let roughness: Node<'float'> = mix(mix(0.75, 1, surf.a), 0.55, wet);
  // under water: the lake's own colour, deeper is bluer (until the water surface arrives)
  const m = tex.mapGrid, node = clamp(round(xz.add(tex.size / 2).div(tex.size / (m - 1))), 0, m - 1);
  const level = texture(tex.waterTex).load(ivec2(int(node.x), int(node.y))).r, depth = level.sub(y);
  const under = step(0.02, depth).mul(mix(0.35, 0.9, smoothstep(0, 4, depth)));
  colour = mix(colour, color('#1d4a5e'), under);
  roughness = mix(roughness, 0.9, step(0.02, depth)); // the stand-in lake bed stays matt, without the shore's sheen

  const mat = new GroundMaterial({ metalness: 0 });
  mat.groundColorNode = colour;
  mat.roughnessNode = roughness;
  mat.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();
  return mat;
}
