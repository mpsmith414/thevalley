/**
 * Ground cover, placed on the GPU: dense grass near the camera, drifts of wildflowers in the meadow, reeds and cattails in
 * the shallows and lily pads on the lake. Each layer is one instanced draw over a fixed set of ring offsets (`ringLayout`)
 * around the camera, snapped to the layer's coarsest spacing (`snapToCell`), so every instance sits on a world lattice point
 * and keeps its place, size and look (all hashed from that point) as the camera moves. The vertex shader reads the height,
 * biome and water maps, folds away the instances that do not belong (wrong ground, out of view, too far), and sways the
 * rest in the shared wind. Ground cover receives shadows but casts none.
 *
 * Rings without pops: the spacings double ring to ring, so a ring's lattice is every other point of the ring inside it. A
 * point's "level" is the coarsest lattice it lies on; it is drawn out to that level's ring radius, and shrinks to nothing
 * over the last 20% of it (by its distance from the camera, not the snapped centre, so the snap never shows). As the finer
 * points shrink away, the coarser ones widen (grass clumps double in width per level) to keep the cover.
 */
import {
  BufferAttribute, BufferGeometry, DataArrayTexture, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector2, Vector3,
  type Camera, type Node,
} from 'three/webgpu';
import {
  Fn, If, abs, attribute, bitOr, bitXor, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dFdx, dFdy, dot, float,
  floor, int, ivec2, log2, max, mix, mod, mx_noise_float, positionGeometry, positionWorld, pow, round, select, shiftLeft, shiftRight,
  sin, smoothstep, texture, uint, uniform, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import type { WorldQuality } from '../world/quality';
import { LAKE_CALM, REED_CALM, type ValleyTextures } from '../world/textures';
import { gradedAverage, macroTintNode, type GroundSets } from '../world/ground';
import { mulberry32, between } from '../util/rng';
import { FLOWER_CARDS, cardTextures } from './cards';
import type { PlantLight } from './material';
import { h32Node, windNodes, type WindUniforms } from './wind';

/** The camera layer the ground cover draws on (not in any shadow cascade or the lake's mirror). */
export const GROUND_COVER_LAYER = 5;

// ---------- pure helpers ----------

/**
 * Each layer's ring spacings (m), finest first. They must double ring to ring (`spacingsDouble`): then the camera snapped to
 * the coarsest spacing plus any ring's offset lies on the finest lattice, which the shader hashes and reads levels from.
 */
export const COVER_SPACINGS = { grass: [0.35, 0.7, 1.4], flowers: [0.9, 1.8], reeds: [0.6], lilies: [1.5] } as const;

/** Whether each spacing is exactly twice the one before. */
export const spacingsDouble = (s: readonly number[]): boolean => s.every((v, k) => k === 0 || v === s[k - 1] * 2);

/** How many lattice points each ring holds: ring k has spacing `spacings[k]` and covers radii [radii[k−1], radii[k]). */
export function ringCounts(spacings: readonly number[], radii: readonly number[]): number[] {
  return ringsOf(spacings, radii).map((r) => r.length / 2);
}

/**
 * Local (x, z) offsets for a layer's rings, ring by ring, nearest first within a ring (so a draw runs roughly front to back).
 * Ring k is the lattice of spacing `spacings[k]` between radii[k−1] (inclusive; 0 for the first) and radii[k]: the rings
 * never overlap, and a ring whose radius does not exceed the last one's is empty.
 */
export function ringLayout(spacings: readonly number[], radii: readonly number[]): Float32Array {
  const rings = ringsOf(spacings, radii), out = new Float32Array(rings.reduce((n, r) => n + r.length, 0));
  let o = 0;
  for (const r of rings) { out.set(r, o); o += r.length; }
  return out;
}

function ringsOf(spacings: readonly number[], radii: readonly number[]): number[][] {
  let inner = 0;
  return spacings.map((s, k) => {
    const outer = radii[k], pts: [number, number, number][] = [];
    if (outer > inner) {
      const n = Math.ceil(outer / s);
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const x = i * s, z = j * s, d = Math.hypot(x, z);
        if (d >= inner && d < outer) pts.push([x, z, d]);
      }
      inner = outer;
    }
    return pts.sort((a, b) => a[2] - b[2]).flatMap(([x, z]) => [x, z]);
  });
}

/** The camera's position snapped to the nearest multiple of `cell` (a lattice point every layer's rings line up on). */
export const snapToCell = (cam: { x: number; z: number }, cell: number): { x: number; z: number } =>
  ({ x: Math.round(cam.x / cell) * cell + 0, z: Math.round(cam.z / cell) * cell + 0 });

// ---------- textures ----------

/** Paint every wildflower card (`FLOWER_CARDS` order) at `size` px into one array texture (sRGB, alpha for the cut-out). */
export async function loadFlowerCards(size: number): Promise<DataArrayTexture> {
  const px = size * size * 4, data = new Uint8Array(px * FLOWER_CARDS.length);
  for (const [i, c] of FLOWER_CARDS.entries()) {
    const { color, height } = await cardTextures(c, size);
    data.set((color.image as { data: Uint8Array }).data, i * px);
    color.dispose(); height.dispose();
  }
  const t = new DataArrayTexture(data, size, size, FLOWER_CARDS.length);
  t.format = RGBAFormat; t.type = UnsignedByteType; t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---------- geometry (made once, in metres; a clump's height is 1 and scaled in the shader) ----------

type Arrays = Record<string, { data: number[]; size: number }>;
function geometry(a: Arrays, index: number[]): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, { data, size }] of Object.entries(a)) g.setAttribute(name, new BufferAttribute(new Float32Array(data), size));
  g.setIndex(index);
  return g;
}

/**
 * A strip blade: pairs of vertices up the centreline `at(t)` (height fraction t) with half-width `w(t)` across `face`, and a
 * tip. `position` is the centreline at a clump height of 1; `gb` the root (x, z, metres) and the offset across the blade.
 */
function blade(a: Arrays, idx: number[], root: [number, number], at: (t: number) => [number, number, number], w: (t: number) => number,
  face: number, ts: number[], extra: number[]) {
  const base = a.position.data.length / 3, fx = Math.cos(face), fz = Math.sin(face);
  for (const t of ts) for (const side of [-1, 1]) {
    a.position.data.push(...at(t));
    a.gb.data.push(root[0], root[1], side * w(t) * fx, side * w(t) * fz);
    a.extra?.data.push(...extra);
  }
  a.position.data.push(...at(1));
  a.gb.data.push(root[0], root[1], 0, 0);
  a.extra?.data.push(...extra);
  for (let i = 0; i < ts.length - 1; i++) {
    const v = base + 2 * i;
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const v = base + 2 * (ts.length - 1);
  idx.push(v, v + 1, v + 2);
}

/** Nine blades (7 vertices each) leaning out from roots within 0.1 m, of height 0.55–1 of the clump's. */
function grassGeometry(): BufferGeometry {
  const rng = mulberry32(0x67a55), a: Arrays = { position: { data: [], size: 3 }, gb: { data: [], size: 4 } }, idx: number[] = [];
  for (let b = 0; b < 9; b++) {
    const ang = b * 2.39996 + between(rng, -0.3, 0.3), r = 0.1 * Math.sqrt((b + 0.5) / 9);
    const la = ang + between(rng, -0.6, 0.6), lean = between(rng, 0.12, 0.4), hb = between(rng, 0.55, 1), w = between(rng, 0.009, 0.015);
    blade(a, idx, [Math.cos(ang) * r, Math.sin(ang) * r],
      (t) => [Math.cos(la) * lean * t ** 1.6 * hb, hb * t, Math.sin(la) * lean * t ** 1.6 * hb],
      (t) => w * (1 - t ** 1.2), la + Math.PI / 2 + between(rng, -0.4, 0.4), [0, 0.35, 0.7], []);
  }
  return geometry(a, idx);
}

/** The flower card: two crossed unit squares standing on the ground. */
function flowerGeometry(): BufferGeometry {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const b = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { pos.push((u - 0.5) * ax, v, (u - 0.5) * az); uvs.push(u, v); }
    idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  return geometry({ position: { data: pos, size: 3 }, uv: { data: uvs, size: 2 } }, idx);
}

/** Up to ten reed blades (parts 0–9) and two cattails (parts 10, 11: a stalk, kind 1, and a brown head, kind 2). */
function reedGeometry(): BufferGeometry {
  const rng = mulberry32(0x4eed5);
  const a: Arrays = { position: { data: [], size: 3 }, gb: { data: [], size: 4 }, extra: { data: [], size: 2 } }, idx: number[] = [];
  for (let b = 0; b < 10; b++) {
    const ang = b * 2.39996, r = 0.09 * Math.sqrt((b + 0.5) / 10), la = ang + between(rng, -0.5, 0.5);
    const lean = between(rng, 0.03, 0.14), hb = between(rng, 0.7, 1), w = between(rng, 0.008, 0.012);
    blade(a, idx, [Math.cos(ang) * r, Math.sin(ang) * r], (t) => [Math.cos(la) * lean * t ** 2 * hb, hb * t, Math.sin(la) * lean * t ** 2 * hb],
      (t) => w * (1 - t ** 2), la + Math.PI / 2, [0, 0.5], [b, 0]);
  }
  for (let k = 0; k < 2; k++) {
    const ang = 1 + k * 3, r = 0.05, root: [number, number] = [Math.cos(ang) * r, Math.sin(ang) * r], top = between(rng, 0.92, 1), head = [0.72, 0.86];
    blade(a, idx, root, (t) => [0, top * t, 0], () => 0.003, ang, [0, 0.7], [10 + k, 1]);
    const base = a.position.data.length / 3;
    for (const y of head) for (let s = 0; s < 6; s++) {
      const q = (s / 6) * Math.PI * 2;
      a.position.data.push(0, y * top, 0);
      a.gb.data.push(root[0], root[1], Math.cos(q) * 0.022, Math.sin(q) * 0.022);
      a.extra.data.push(10 + k, 2);
    }
    for (let s = 0; s < 6; s++) {
      const p = base + s, q = base + ((s + 1) % 6);
      idx.push(p, q, p + 6, q, q + 6, p + 6);
    }
  }
  return geometry(a, idx);
}

/**
 * A colony of five lily pads (parts 0–4: notched discs, `ll` = disc u, v, part, kind 0) and one water lily on the first
 * (part 5: eight outer and eight inner white petals, kind 1, round a yellow centre, kind 2). Metres, lying at y = 0.
 */
function lilyGeometry(): BufferGeometry {
  const rng = mulberry32(0x1111e5), pos: number[] = [], ll: number[] = [], idx: number[] = [];
  const NOTCH = 0.35, SEG = 12;
  for (let j = 0; j < 5; j++) {
    const ox = j ? Math.cos(j * 2.4) * between(rng, 0.35, 0.65) : 0, oz = j ? Math.sin(j * 2.4) * between(rng, 0.35, 0.65) : 0;
    const r = between(rng, 0.16, 0.28), turn = between(rng, 0, Math.PI * 2), c = pos.length / 3;
    pos.push(ox, 0, oz); ll.push(0, 0, j, 0);
    for (let s = 0; s <= SEG; s++) {
      const q = NOTCH / 2 + ((Math.PI * 2 - NOTCH) * s) / SEG, u = Math.cos(q), v = Math.sin(q);
      pos.push(ox + Math.cos(q + turn) * r, 0, oz + Math.sin(q + turn) * r); ll.push(u, v, j, 0);
      if (s) idx.push(c, c + s + 1, c + s);
    }
  }
  const petals = (n: number, r0: number, r1: number, lift: number, wid: number, turn: number) => {
    for (let s = 0; s < n; s++) {
      const q = turn + (s / n) * Math.PI * 2, b = pos.length / 3, cx = Math.cos(q), cz = Math.sin(q), px = -cz * wid, pz = cx * wid;
      pos.push(cx * r0 + px, 0.012, cz * r0 + pz, cx * r0 - px, 0.012, cz * r0 - pz, cx * r1, 0.012 + lift, cz * r1);
      ll.push(0, 0, 5, 1, 0, 0, 5, 1, 0, 1, 5, 1);
      idx.push(b, b + 1, b + 2);
    }
  };
  petals(8, 0.015, 0.085, 0.035, 0.02, 0);
  petals(8, 0.012, 0.06, 0.055, 0.016, Math.PI / 8);
  const c = pos.length / 3;
  pos.push(0, 0.05, 0); ll.push(0, 0, 5, 2);
  for (let s = 0; s < 6; s++) {
    const q = (s / 6) * Math.PI * 2;
    pos.push(Math.cos(q) * 0.018, 0.03, Math.sin(q) * 0.018); ll.push(0, 0, 5, 2);
    idx.push(c, c + 1 + ((s + 1) % 6), c + 1 + s);
  }
  return geometry({ position: { data: pos, size: 3 }, ll: { data: ll, size: 4 } }, idx);
}

// ---------- shader helpers ----------

const U = (n: number) => uint(n);
/** The wind's lowbias32, as a rendering-only hash of a lattice point. */
const hashU = h32Node;
/** A uniform random number in [0, 1) for lattice hash `h`, stream `k`. */
const rnd = (h: Node<'uint'>, k: number) => float(shiftRight(hashU(bitXor(h, U((k * 0x9e3779b9) >>> 0))), U(8))).div(16777216);
/** Perlin noise remapped to about 0..1. */
const noise01 = (p: Node<'vec2'>) => mx_noise_float(p).mul(0.5).add(0.5);
/** Turn `v` about +y by the angle with cosine `c` and sine `s`. */
const turnY = (v: Node<'vec3'>, c: Node<'float'>, s: Node<'float'>) => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));

type Rings = { spacings: number[]; radii: number[] };

/** One ground cover layer: its rings, the uniform its centre snaps to, and the mesh. */
type Layer = { name: string; rings: Rings; cell: number; reach: number; centre: Node<'vec2'> & { value: Vector2 }; mesh: Mesh; water?: 'reeds' | 'lake' };

export type GroundCover = {
  object: Group;
  /** Follow the camera: snap each layer's rings and hide the layers with nothing to draw (too high, no water near). */
  update(camera: Camera): void;
  /**
   * Make every layer drawable while `fn` starts a compile (which must gather what it compiles before it returns, as
   * `compileTogether` does), so none compiles mid-flight; the layers are back as they were when this returns.
   */
  compile<T>(fn: () => T): T;
  /** Instances per layer, for checking. */
  stats(): Record<string, { instances: number; visible: boolean }>;
  dispose(): void;
};

/** What the ground cover looks like beyond the textures: the ground's colours, the plants' key light and the flower cards. */
export type GroundCoverLook = { ground: GroundSets; light: PlantLight; flowers: DataArrayTexture };

/**
 * The ground cover for quality `q`: grass (spacing 0.35 m to 15 m, 0.7 m to 35 m, 1.4 m to `grassRadius`), flowers (0.9 m to
 * 25 m, 1.8 m to `grassRadius·0.8`), reeds (0.6 m to 40 m) and lily pads (1.5 m to 60 m). Every layer's density is times
 * `grassDensity`.
 */
export function createGroundCover(tex: ValleyTextures, wind: WindUniforms, q: WorldQuality, look: GroundCoverLook): GroundCover {
  const { gust } = windNodes(wind);
  const eye = uniform(new Vector3()) as Node<'vec3'> & { value: Vector3 };
  const half = tex.size / 2, R = q.grassRadius, density = q.grassDensity;
  const object = new Group();
  object.name = 'ground-cover';
  const layers: Layer[] = [];
  const along = vec3(wind.dir.x, 0, wind.dir.y);
  const viewDir = positionWorld.sub(cameraPosition).normalize();
  const shine = max(dot(viewDir, look.light.keyDir), 0); // light through a blade, seen from its shade side

  /** Water level (the highest of the four nearest map nodes, so the shore cells count as water) at `xz`, −1000 where dry. */
  const waterLevel = (xz: Node<'vec2'>) => {
    const m = tex.mapGrid, f = clamp(xz.add(half).div(tex.size / (m - 1)), 0, m - 2), i0 = floor(f);
    const wt = texture(tex.waterTex), lv = (dx: number, dz: number) => wt.load(ivec2(int(i0.x).add(dx), int(i0.y).add(dz))).r;
    return max(max(lv(0, 0), lv(1, 0)), max(lv(0, 1), lv(1, 1)));
  };

  /**
   * The instance's lattice point and what follows from it (inside a shader function): the jittered world base on the ground,
   * its random streams, its distance from the camera, and its `fade` (1 → 0 over the last 20% of its level's ring) and
   * `widen` (2× per finer level that has faded away). `salt` keeps the layers' streams apart.
   */
  const instance = (rings: Rings, centre: Node<'vec2'>, salt: number) => {
    if (!spacingsDouble(rings.spacings)) throw new Error(`ground cover spacings must double ring to ring: ${rings.spacings}`);
    const s0 = rings.spacings[0], slop = Math.max(...rings.spacings) * Math.SQRT1_2 + 0.05;
    const radii = rings.radii.filter((r, k) => r > (k ? rings.radii[k - 1] : 0)), top = radii.length - 1;
    const p = centre.add(attribute('off', 'vec2') as Node<'vec2'>);
    const idx = round(p.div(s0)).toVar();
    const h = hashU(bitOr(uint(int(idx.x).add(16384)), shiftLeft(uint(int(idx.y).add(16384)), U(15))) as Node<'uint'>);
    const hs = bitXor(h, U(salt)).toVar() as unknown as Node<'uint'>;
    // the point's level: how many times its index halves evenly (on the 2·s0 lattice, the 4·s0 lattice, …)
    const even = (n: number) => abs(mod(idx, 2 ** n)).lessThan(0.5);
    let level: Node<'float'> = float(0);
    for (let n = 1; n <= top; n++) level = level.add(select(even(n).x.and(even(n).y), float(1), float(0)));
    const lvl = level.toVar();
    const spacing = float(s0).mul(pow(float(2), lvl));
    const xz = p.add(vec2(rnd(hs, 1), rnd(hs, 2)).sub(0.5).mul(spacing).mul(0.9)).toVar();
    const y = tex.heightAtNode(xz).toVar();
    const base = vec3(xz.x, y, xz.y).toVar();
    const d = base.sub(eye).length().toVar();
    const vis = (l: number) => float(1).sub(smoothstep(radii[l] * 0.8, radii[l] - slop, d));
    let fade: Node<'float'> = vis(top), widen: Node<'float'> = float(1);
    for (let l = top - 1; l >= 0; l--) {
      const v = vis(l);
      fade = select(lvl.lessThan(l + 0.5), v, fade);
      widen = widen.mul(select(lvl.greaterThan(l + 0.5), float(2).sub(v), float(1)));
    }
    return { xz, y, base, d, hs, fade: fade.toVar(), widen: widen.toVar(), r: (k: number) => rnd(hs, k) };
  };

  /** Inside the view (with a margin of `r` metres) for a base point `c`. */
  const inView = (c: Node<'vec3'>, r: Node<'float'>) => {
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(c, 1))), m = r.mul(2);
    return clip.w.greaterThan(m.negate()).and(abs(clip.x).lessThan(clip.w.add(m))).and(abs(clip.y).lessThan(clip.w.add(m)));
  };
  const biomes = (xz: Node<'vec2'>) => {
    const uvm = tex.mapUv(xz);
    return { a: texture(tex.biomeA, uvm).level(float(0)), b: texture(tex.biomeB, uvm).level(float(0)) };
  };

  const addLayer = (name: string, rings: Rings, geo: BufferGeometry, mat: MeshStandardNodeMaterial, centre: Layer['centre'], water?: Layer['water']) => {
    const offsets = ringLayout(rings.spacings, rings.radii), g = new InstancedBufferGeometry();
    for (const [k, v] of Object.entries(geo.attributes)) g.setAttribute(k, v);
    g.setIndex(geo.index);
    g.setAttribute('off', new InstancedBufferAttribute(offsets, 2));
    g.instanceCount = offsets.length / 2;
    const mesh = new Mesh(g, mat);
    mesh.name = `ground-cover-${name}`;
    mesh.frustumCulled = false; // placed in the shader
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = -1; // before the ground: its costly shading is then hidden behind the grass by the depth test
    mesh.layers.set(GROUND_COVER_LAYER);
    object.add(mesh);
    const reach = Math.max(...rings.radii);
    layers.push({ name, rings, cell: Math.max(...rings.spacings), reach, centre, mesh, water });
  };
  const material = (n: string, side = DoubleSide) => {
    const m = new MeshStandardNodeMaterial({ metalness: 0, side });
    m.name = n;
    return m;
  };
  /** A world normal into view space, for `normalNode` (the same on both faces: no black backs). */
  const viewNormal = (n: Node<'vec3'>) => cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();

  // ---------- grass ----------
  {
    const rings = { spacings: [...COVER_SPACINGS.grass], radii: [15, 35, R].map((r) => Math.min(r, R)) };
    const centre = uniform(new Vector2()) as Layer['centre'];
    const meadowC = vec3(...gradedAverage(look.ground, 'meadow')), forestC = meadowC.mul(vec3(0.72, 0.86, 0.62)), shoreC = meadowC.mul(vec3(0.85, 1.04, 0.8));
    const vCol = varyingProperty('vec3', 'vGrassColour'), vN = varyingProperty('vec3', 'vGrassNormal'), vT = varyingProperty('float', 'vGrassTip');
    const gb = attribute('gb', 'vec4') as Node<'vec4'>, c = positionGeometry;
    const mat = material('grass');
    mat.positionNode = Fn(() => {
      const it = instance(rings, centre, 0x9a55), out = it.base.toVar();
      vCol.assign(vec3(0)); vN.assign(vec3(0, 1, 0)); vT.assign(float(0));
      const { a, b } = biomes(it.xz);
      const meadow = a.g, forest = a.r, shore = b.r;
      const want = clamp(meadow.add(forest.mul(0.35)).add(shore.mul(0.4)), 0, 1)
        .mul(float(1).sub(smoothstep(0.4, 0.6, a.b))) // not on rock
        .mul(float(1).sub(smoothstep(-0.12, -0.04, waterLevel(it.xz).sub(it.y)))) // not in or at the water
        .mul(density);
      const r0 = it.r(0), size = clamp(want.sub(r0).div(0.15), 0, 1).mul(it.fade).toVar();
      const patch = noise01(it.xz.div(9)).toVar(); // taller and shorter swathes
      const lush = meadow.div(meadow.add(forest.mul(0.35)).add(shore.mul(0.4)).add(1e-3));
      const H = mix(mix(0.1, 0.25, it.r(3)), mix(0.25, 0.7, it.r(3)), lush).mul(patch.mul(0.7).add(0.65)).mul(size).toVar();
      If(size.greaterThan(0.01).and(inView(it.base, H.add(0.3))), () => {
        const W = it.widen.mul(size).mul(it.r(4).mul(0.4).add(0.8));
        const yaw = it.r(5).mul(Math.PI * 2), cy = cos(yaw), sy = sin(yaw);
        const local = turnY(vec3(gb.x.mul(W).add(c.x.mul(H)).add(gb.z.mul(W)), c.y.mul(H), gb.y.mul(W).add(c.z.mul(H)).add(gb.w.mul(W))), cy, sy);
        // wind: a bend that grows with the gusts, a slow wave rolling downwind, and each blade's own flutter
        const g = gust(it.xz), str = wind.strength;
        const wave = sin(wind.time.mul(2.1).sub(dot(it.xz, wind.dir).mul(0.45)).add(it.r(6))).mul(str).mul(g.add(0.5)).mul(0.18);
        const bend = str.mul(g.mul(1.1).add(0.25)).add(wave).add(0.08);
        const t = c.y, flutter = sin(wind.time.mul(it.r(7).mul(3).add(5)).add(gb.x.mul(60)).add(gb.y.mul(40))).mul(0.06).mul(g.add(0.3)).mul(t);
        const side = vec3(wind.dir.y.negate(), 0, wind.dir.x);
        const sway = along.mul(bend.mul(t).mul(t).mul(H).mul(0.6)).add(side.mul(flutter.mul(H)));
        out.assign(it.base.add(local).add(sway).sub(vec3(0, bend.mul(bend).mul(t).mul(t).mul(H).mul(0.12), 0)));
        // colour: the meadow's own (graded and tinted as the ground, so it carries on where the grass ends), shady forest
        // grass and lush shore grass; dark at the roots, light and a little straw-coloured at the tips
        const wsum = meadow.add(forest.mul(0.35)).add(shore.mul(0.4)).add(1e-3);
        const tone = meadowC.mul(meadow).add(forestC.mul(forest.mul(0.35))).add(shoreC.mul(shore.mul(0.4))).div(wsum).mul(macroTintNode(it.xz));
        const straw = mix(vec3(1), vec3(1.25, 1.1, 0.6), smoothstep(0.55, 0.85, patch).mul(lush).mul(t).mul(0.7));
        const grade = mix(0.5, 1.7, pow(t, 0.8)).mul(it.r(8).mul(0.24).add(0.88));
        // a gust lays the blades over and they silver (their paler, glossier sides turn up): the gusts show as bright swathes
        // rolling downwind across the meadow
        const silver = smoothstep(0.25, 0.85, bend).mul(t).mul(0.45).add(1);
        vCol.assign(tone.mul(straw).mul(grade).mul(silver));
        // normals mostly up (the meadow shades as a soft lawn), tipped out of the clump and with the bend
        const out2 = turnY(vec3(gb.x, 0, gb.y), cy, sy).mul(3.5);
        vN.assign(vec3(0, 1, 0).add(out2.mul(0.35)).add(along.mul(bend.mul(t))).normalize());
        vT.assign(t);
      });
      return out;
    })();
    mat.colorNode = vec4(vCol, 1);
    mat.normalNode = viewNormal(vN.normalize());
    mat.roughnessNode = float(0.85);
    mat.emissiveNode = vCol.mul(look.light.key).mul(shine.mul(vT).mul(0.3));
    addLayer('grass', rings, grassGeometry(), mat, centre);
  }

  // ---------- wildflowers ----------
  {
    const rings = { spacings: [...COVER_SPACINGS.flowers], radii: [25, R * 0.8].map((r) => Math.min(r, R * 0.8)) };
    const centre = uniform(new Vector2()) as Layer['centre'];
    const vSp = varyingProperty('float', 'vFlowerKind'), vN = varyingProperty('vec3', 'vFlowerNormal');
    // heights (m) per card, FLOWER_CARDS order: lupine, daisy, fireweed, harebell
    const H0 = [0.55, 0.3, 0.75, 0.25], H1 = [0.85, 0.45, 1.1, 0.4];
    const mat = material('flowers');
    mat.positionNode = Fn(() => {
      const it = instance(rings, centre, 0xf10e), out = it.base.toVar();
      vSp.assign(float(0)); vN.assign(vec3(0, 1, 0));
      const { a } = biomes(it.xz);
      const drift = smoothstep(0.35, 0.6, noise01(it.xz.div(25)));
      const dry = float(1).sub(smoothstep(-0.12, -0.04, waterLevel(it.xz).sub(it.y)));
      const want = a.g.mul(drift).mul(dry).mul(density).mul(0.85);
      const size = clamp(want.sub(it.r(0)).div(0.12), 0, 1).mul(it.fade).toVar();
      // a drift is mostly one or two kinds: a slow noise picks the kind, the instance's own roll mixes the edges
      const kind = floor(clamp(noise01(it.xz.div(45).add(31.7)).sub(0.5).mul(10).add(2).add(it.r(1).sub(0.5).mul(1.4)), 0, 3.999)).toVar();
      const pick = (v: number[]) => select(kind.lessThan(0.5), float(v[0]), select(kind.lessThan(1.5), float(v[1]), select(kind.lessThan(2.5), float(v[2]), float(v[3]))));
      const H = mix(pick(H0), pick(H1), it.r(2)).mul(size).toVar();
      If(size.greaterThan(0.01).and(inView(it.base, H)), () => {
        const yaw = it.r(3).mul(Math.PI * 2), cy = cos(yaw), sy = sin(yaw), p = positionGeometry;
        const local = turnY(p.mul(H), cy, sy);
        const g = gust(it.xz), str = wind.strength, t = p.y;
        const nod = sin(wind.time.mul(it.r(4).mul(1.5).add(2.2)).add(it.r(5).mul(6.28))).mul(0.05).mul(g.add(0.4));
        const bend = str.mul(g.mul(0.9).add(0.2)).add(nod);
        out.assign(it.base.add(local).add(along.mul(bend.mul(t).mul(t).mul(H).mul(0.5))).sub(vec3(0, 0.02, 0).mul(size)));
        vSp.assign(kind);
        vN.assign(vec3(local.x.div(max(H, 1e-3)).mul(0.6), 1, local.z.div(max(H, 1e-3)).mul(0.6)).normalize());
      });
      return out;
    })();
    const card = texture(look.flowers, uv()).depth(int(vSp.add(0.5)));
    // alpha keeps its cover down the mip chain, as the leaves'
    const dx = dFdx(uv()).mul(look.flowers.image.width), dy = dFdy(uv()).mul(look.flowers.image.width);
    const mip = max(log2(max(dot(dx, dx), dot(dy, dy))).mul(0.5), 0);
    mat.maskNode = card.a.mul(float(1).add(mip.mul(0.25))).greaterThan(0.5);
    const col = mix(vec3(card.rgb.dot(vec3(0.2126, 0.7152, 0.0722))), card.rgb, 0.85).mul(vec3(0.92, 0.92, 0.85)).toVar();
    mat.colorNode = vec4(col, 1);
    mat.normalNode = viewNormal(vN.normalize());
    mat.roughnessNode = float(0.8);
    mat.emissiveNode = col.mul(look.light.key).mul(shine.mul(0.3));
    addLayer('flowers', rings, flowerGeometry(), mat, centre);
  }

  // ---------- reeds and cattails ----------
  {
    const rings = { spacings: [...COVER_SPACINGS.reeds], radii: [40] };
    const centre = uniform(new Vector2()) as Layer['centre'];
    const vCol = varyingProperty('vec3', 'vReedColour'), vN = varyingProperty('vec3', 'vReedNormal');
    const gb = attribute('gb', 'vec4') as Node<'vec4'>, ex = attribute('extra', 'vec2') as Node<'vec2'>, c = positionGeometry;
    const mat = material('reeds');
    mat.positionNode = Fn(() => {
      const it = instance(rings, centre, 0x4eed), out = it.base.toVar();
      vCol.assign(vec3(0)); vN.assign(vec3(0, 1, 0));
      const depth = waterLevel(it.xz).sub(it.y).toVar();
      const calm = smoothstep(REED_CALM[0], REED_CALM[1], biomes(it.xz).b.b);
      const shallows = smoothstep(0.03, 0.1, depth).mul(float(1).sub(smoothstep(0.5, 0.62, depth)));
      const bed = smoothstep(0.32, 0.55, noise01(it.xz.div(16))).toVar();
      const want = calm.mul(shallows).mul(bed.mul(0.85).add(0.1)).mul(density);
      const size = clamp(want.sub(it.r(0)).div(0.15), 0, 1).mul(it.fade).toVar();
      // 6–10 blades, and a cattail on two clumps in five (a second on one in five)
      const blades = floor(it.r(1).mul(5)).add(6), cattails = select(it.r(2).lessThan(0.05), float(2), select(it.r(2).lessThan(0.18), float(1), float(0)));
      const part = ex.x, kind = ex.y;
      const keep = select(kind.lessThan(0.5), part.lessThan(blades), part.sub(10).lessThan(cattails));
      const H = depth.add(mix(0.7, 1.3, it.r(3)).mul(bed.mul(0.5).add(0.75))).mul(size).toVar();
      If(size.greaterThan(0.01).and(keep).and(inView(it.base, H)), () => {
        const yaw = it.r(4).mul(Math.PI * 2), cy = cos(yaw), sy = sin(yaw);
        const thick = max(it.d.div(12), 1).mul(size); // keep far blades a pixel wide
        const W = select(kind.greaterThan(1.5), size, thick);
        const local = turnY(vec3(gb.x.mul(size).add(c.x.mul(H)).add(gb.z.mul(W)), c.y.mul(H), gb.y.mul(size).add(c.z.mul(H)).add(gb.w.mul(W))), cy, sy);
        const g = gust(it.xz), str = wind.strength, t = c.y;
        const wave = sin(wind.time.mul(1.4).sub(dot(it.xz, wind.dir).mul(0.3)).add(it.r(5).mul(2))).mul(0.12).mul(g.add(0.5));
        const bend = str.mul(g.mul(1.3).add(0.35)).add(wave);
        const flutter = sin(wind.time.mul(it.r(6).mul(3).add(4)).add(part.mul(1.7))).mul(0.05).mul(g.add(0.3)).mul(select(kind.lessThan(0.5), float(1), float(0.3)));
        const side = vec3(wind.dir.y.negate(), 0, wind.dir.x);
        out.assign(it.base.add(local).add(along.mul(bend.mul(t).mul(t).mul(H).mul(0.35))).add(side.mul(flutter.mul(t).mul(H)))
          .sub(vec3(0, bend.mul(bend).mul(t).mul(t).mul(H).mul(0.06), 0)));
        const green = mix(vec3(0.035, 0.07, 0.018), vec3(0.13, 0.15, 0.045), pow(t, 1.5)).mul(it.r(7).mul(0.3).add(0.85));
        vCol.assign(select(kind.greaterThan(1.5), vec3(0.06, 0.03, 0.014), select(kind.greaterThan(0.5), vec3(0.06, 0.08, 0.025), green)));
        // tall, upright blades: lit from the side (out of the clump and a little up), not as a lawn
        const radial = turnY(vec3(gb.z, 0, gb.w), cy, sy).mul(45), outward = turnY(vec3(gb.x, 0, gb.y), cy, sy).mul(11);
        vN.assign(select(kind.greaterThan(1.5), radial.add(vec3(0, 0.3, 0)), outward.add(vec3(0, 0.45, 0)).add(radial.mul(0.3))).normalize());
      });
      return out;
    })();
    mat.colorNode = vec4(vCol, 1);
    mat.normalNode = viewNormal(vN.normalize());
    mat.roughnessNode = float(0.7);
    mat.emissiveNode = vCol.mul(look.light.key).mul(shine.mul(0.25));
    addLayer('reeds', rings, reedGeometry(), mat, centre, 'reeds');
  }

  // ---------- lily pads ----------
  {
    const rings = { spacings: [...COVER_SPACINGS.lilies], radii: [60] };
    const centre = uniform(new Vector2()) as Layer['centre'];
    const vLL = varyingProperty('vec4', 'vLily');
    const ll = attribute('ll', 'vec4') as Node<'vec4'>;
    const mat = material('lilies');
    mat.positionNode = Fn(() => {
      const it = instance(rings, centre, 0x1111), out = it.base.toVar();
      vLL.assign(vec4(0));
      const level = waterLevel(it.xz).toVar(), depth = level.sub(it.y);
      const lake = smoothstep(LAKE_CALM[0], LAKE_CALM[1], biomes(it.xz).b.b);
      const window = smoothstep(0.6, 0.8, depth).mul(float(1).sub(smoothstep(2.2, 2.5, depth)));
      const want = lake.mul(window).mul(smoothstep(0.42, 0.62, noise01(it.xz.div(22).add(7.7)))).mul(density);
      const size = clamp(want.sub(it.r(0)).div(0.2), 0, 1).mul(it.fade).toVar();
      const pads = floor(it.r(1).mul(4)).add(2), flower = it.r(2).lessThan(0.35);
      const part = ll.z;
      const keep = select(part.lessThan(4.5), part.lessThan(pads), flower);
      const S = it.r(3).mul(0.5).add(0.8).mul(size).toVar();
      If(size.greaterThan(0.01).and(keep).and(inView(vec3(it.xz.x, level, it.xz.y), S)), () => {
        const yaw = it.r(4).mul(Math.PI * 2), cy = cos(yaw), sy = sin(yaw);
        const local = turnY(positionGeometry.mul(S), cy, sy);
        // bobbing on the ripples: up and down, and a slow tilt, more in the wind
        const ph = it.r(5).mul(6.28).add(part.mul(1.3)), bob = wind.strength.add(0.3);
        const lift = sin(wind.time.mul(1.1).add(ph)).mul(0.006).mul(bob)
          .add(local.x.mul(sin(wind.time.mul(0.8).add(ph))).add(local.z.mul(cos(wind.time.mul(0.7).add(ph)))).mul(0.03).mul(bob));
        out.assign(vec3(it.xz.x, level.add(0.01).add(lift), it.xz.y).add(local));
        vLL.assign(ll);
      });
      return out;
    })();
    // the pad: dark glossy green, radial veins, a reddish rim; the flower white with a pink blush and a yellow heart
    const r = vec2(vLL.x, vLL.y).length(), ang = vLL.y.atan(vLL.x);
    const vein = smoothstep(0.85, 1, cos(ang.mul(13))).mul(smoothstep(0.1, 0.4, r)).mul(0.35);
    const pad = mix(vec3(0.03, 0.075, 0.015), vec3(0.06, 0.11, 0.025), smoothstep(0.2, 0.9, r)).mul(float(1).add(vein));
    const padC = mix(pad, vec3(0.12, 0.045, 0.02), smoothstep(0.88, 1, r));
    const petal = vec3(0.82, 0.78, 0.74);
    const col = select(vLL.w.greaterThan(1.5), vec3(0.85, 0.55, 0.06), select(vLL.w.greaterThan(0.5), petal, padC)).toVar();
    mat.colorNode = vec4(col, 1);
    mat.normalNode = viewNormal(vec3(0, 1, 0));
    mat.roughnessNode = select(vLL.w.greaterThan(0.5), float(0.7), float(0.62));
    mat.emissiveNode = select(vLL.w.greaterThan(0.5), col.mul(look.light.key).mul(shine.mul(0.3)), vec3(0));
    addLayer('lilies', rings, lilyGeometry(), mat, centre, 'lake');
  }

  // ---------- CPU side: where there is water near, and the ground under the camera ----------
  const CELL = 32, n = Math.ceil(tex.size / CELL), reedCell = new Uint8Array(n * n), lakeCell = new Uint8Array(n * n);
  {
    const m = tex.mapGrid, mc = tex.size / (m - 1), level = tex.waterTex.image.data as Float32Array, bb = tex.biomeB.image.data as Uint8Array;
    for (let iz = 0; iz < m; iz++) for (let ix = 0; ix < m; ix++) {
      const c = iz * m + ix;
      if (level[c] < -999) continue;
      const k = Math.min(n - 1, Math.floor((iz * mc) / CELL)) * n + Math.min(n - 1, Math.floor((ix * mc) / CELL)), calm = bb[c * 4 + 2];
      if (calm > REED_CALM[0] * 255) reedCell[k] = 1;
      if (calm > LAKE_CALM[0] * 255) lakeCell[k] = 1;
    }
  }
  const waterNear = (x: number, z: number, reach: number, cells: Uint8Array) => {
    const i0 = Math.max(0, Math.floor((x + half - reach) / CELL)), i1 = Math.min(n - 1, Math.floor((x + half + reach) / CELL));
    const j0 = Math.max(0, Math.floor((z + half - reach) / CELL)), j1 = Math.min(n - 1, Math.floor((z + half + reach) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cells[j * n + i]) return true;
    return false;
  };
  const heights = tex.heightTex.image.data as Float32Array;
  const groundAt = (x: number, z: number) => {
    const g = tex.grid, i = Math.min(g - 1, Math.max(0, Math.round((x + half) / tex.cell))), j = Math.min(g - 1, Math.max(0, Math.round((z + half) / tex.cell)));
    return heights[j * g + i];
  };

  let forced = false;
  return {
    object,
    update(camera) {
      const { x, y, z } = camera.position, above = y - groundAt(x, z);
      eye.value.copy(camera.position);
      for (const l of layers) {
        const s = snapToCell({ x, z }, l.cell);
        l.centre.value.set(s.x, s.z);
        let on = above < l.reach;
        if (l.water === 'reeds') on &&= waterNear(x, z, l.reach + 2, reedCell);
        if (l.water === 'lake') on &&= waterNear(x, z, l.reach + 2, lakeCell);
        l.mesh.visible = on || forced;
      }
    },
    compile(fn) {
      const was = layers.map((l) => l.mesh.visible);
      for (const l of layers) l.mesh.visible = true;
      try {
        return fn();
      } finally {
        layers.forEach((l, i) => (l.mesh.visible = was[i]));
      }
    },
    stats: () => Object.fromEntries(layers.map((l) => [l.name, { instances: (l.mesh.geometry as InstancedBufferGeometry).instanceCount, visible: l.mesh.visible }])),
    dispose() {
      for (const l of layers) { object.remove(l.mesh); l.mesh.geometry.dispose(); (l.mesh.material as MeshStandardNodeMaterial).dispose(); }
    },
  };
}
