/**
 * The Valley's vegetation, drawn instanced by tile: each 64 m tile is in a band (near, mid, far, none) per class of plant
 * (trees, shrubs, props), and every (kind, variant, LOD) model is one instanced mesh holding the plants of the tiles drawn
 * at that LOD. Bands are recomputed as the camera moves; only the LODs whose tiles changed are refilled (typed-array copies).
 */
import {
  Box3, BufferAttribute, DynamicDrawUsage, Frustum, Group, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute,
  Matrix4, Mesh, Sphere, Vector3, type Camera,
} from 'three/webgpu';
import { PLANT_KINDS, TREE_KINDS, VARIANTS, type PlantKind } from '../plants/species';
import { withKind, type PlantMaterials } from '../plants/material';
import type { PlantMesh, PlantModelSet } from '../plants/generator';
import { INSTANCE_STRIDE, TILE_SIZE, WORLD_SIZE, type TileData, type ValleyData } from '../valley/types';
import type { WorldQuality } from './quality';

export type Band = 'near' | 'mid' | 'far' | 'none';
export type PlantClass = 'tree' | 'shrub' | 'prop';
const BANDS: readonly Band[] = ['near', 'mid', 'far', 'none'];
/** A tile's centre is at most this far from any of its points (half its diagonal, rounded up), in metres. */
export const TILE_RADIUS = 45;
/** Floats per instance on the GPU: i0 = x, y, z, yaw · i1 = scale, leanX, leanZ, tint · i2 = age, health, phase, model height. */
export const GPU_STRIDE = 12;
/** Props are near within this many metres. */
const PROP_NEAR = 50;
/** Hysteresis: a tile leaves its band outward only this far (×) past the band's edge. */
const GRACE = 1.1;
/** Tiles are kept if their box meets the view frustum grown by this many metres (so shadows cast from just off-screen stay). */
const FRUSTUM_MARGIN = 40;
/** Re-band at least this often (s), and sooner when the camera moves this far (m) or turns this much (degrees). */
const EVERY = 0.2, MOVE = 8, TURN = 10;
/**
 * How far (m) mid trees are kept: `midTree`, plus the most the camera can move between refills. The plant materials dither a
 * mid tree out over the 10 m before `midTree` as its impostor dithers in (see `fade.ts`), so past `midTree` the mid
 * meshes draw nothing; the margin only makes sure that a tree the camera has come closer to since the last refill is there.
 */
export const midTreeReach = (q: WorldQuality) => q.midTree + MOVE;
/** Head room over the tallest plant for a tile's box (m). */
const TALLEST = 30;
/** Near tiles are re-split between the near and mid meshes, instance by instance, after the camera moves this far (m). */
const SPLIT_MOVE = 4;
/**
 * The layers the near and mid meshes are on, so each view can pick them: the main camera draws both, the shadow cascades
 * and the lake's mirror choose (see main.ts).
 */
export const NEAR_LAYER = 1, MID_LAYER = 2;
/** Mid *trees* are also on this layer, so the nearest shadow cascade can draw them (and not the mid shrubs, logs and stumps). */
export const MID_TREE_LAYER = 3;
/** Kinds whose mid meshes cast no shadow: shrubs and small dead wood, too small to see from the mid band. */
const MID_NO_SHADOW = new Set<PlantKind>(['juniper', 'blueberry', 'fern', 'log', 'stump']);
/**
 * The mid band draws three models per kind (one young, two mature), each plant rescaled to its own height: half the draws.
 * The far trees' impostors are baked from the same three.
 */
export const MID_VARIANTS = [1, 1, 3, 3, 5, 5];

/**
 * Which LODs (near, mid) to refill when a tile of one class goes from drawn band `was` to `now`. The mid meshes also hold the
 * far part of near tiles (the per-instance split), so a tile entering or leaving `near` changes the mid meshes as well.
 */
export function lodsToRefill(was: Band, now: Band): [boolean, boolean] {
  if (was === now) return [false, false];
  const touched = (l: number) => LODS[l] === was || LODS[l] === now;
  return [touched(0), touched(1) || was === 'near' || now === 'near'];
}

const SHRUBS: PlantKind[] = ['juniper', 'blueberry', 'fern'];
export const classOf = (kind: PlantKind): PlantClass => (TREE_KINDS.includes(kind) ? 'tree' : SHRUBS.includes(kind) ? 'shrub' : 'prop');

/** The outer edges of the near, mid and far bands for `kind`'s class (props have no far band). */
function edges(kind: PlantKind, q: WorldQuality): [number, number, number] {
  switch (classOf(kind)) {
    case 'tree': return [q.nearTree, q.midTree, q.viewDistance];
    case 'shrub': return [q.nearShrub, q.midShrub, q.shrubCull];
    case 'prop': return [PROP_NEAR, q.propCull, q.propCull];
  }
}

/**
 * The band `kind` is in at `distance` metres. Trees: near < nearTree, mid < midTree, far < viewDistance; shrubs: nearShrub,
 * midShrub, shrubCull; props: near < 50, mid < propCull. With the previous band `prev`, a plant stays in that band until it
 * is 10% past its outer edge (moving in, the plain thresholds apply), so tiles do not flicker between LODs at an edge.
 */
export function bandFor(kind: PlantKind, distance: number, q: WorldQuality, prev?: Band): Band {
  const e = edges(kind, q);
  let i = 0;
  while (i < 3 && distance >= e[i]) i++;
  const p = prev ? BANDS.indexOf(prev) : 3;
  if (p < i && p < 3 && distance < e[p] * GRACE) return prev!;
  return BANDS[i];
}

/**
 * Distance (m) from `cam` to tile (tx, tz): from the tile's centre less `TILE_RADIUS` (never below 0), combined with the
 * height of the camera above (or below) the tile's ground range `y0`..`y1`, if given.
 */
export function tileDistance(cam: { x: number; y: number; z: number }, tx: number, tz: number, y0?: number, y1 = y0): number {
  const cx = -WORLD_SIZE / 2 + (tx + 0.5) * TILE_SIZE, cz = -WORLD_SIZE / 2 + (tz + 0.5) * TILE_SIZE;
  const h = Math.max(0, Math.hypot(cam.x - cx, cam.z - cz) - TILE_RADIUS);
  const v = y0 === undefined ? 0 : Math.max(0, y0 - cam.y, cam.y - (y1 ?? y0));
  return Math.hypot(h, v);
}

/** Density thinning (see `WorldQuality`): true when instance `index` of its tile, with `tint`, is left out at `density`. */
export const thinned = (tint: number, index: number, density: number): boolean => {
  const f = tint * 43758.5453 + index * 0.618;
  return f - Math.floor(f) >= density;
};

/** Instances for one model, packed for the GPU (`GPU_STRIDE` floats each), with the box their bases span. */
export type Bucket = { data: Float32Array; count: number; box: Float64Array /*minX, minY, minZ, maxX, maxY, maxZ*/ };
const newBucket = (): Bucket => ({ data: new Float32Array(16 * GPU_STRIDE), count: 0, box: new Float64Array(6) });

/**
 * Gather, into one bucket per model (index `kind·VARIANTS + variant`), the instances of `kinds` (indices into PLANT_KINDS)
 * from the tiles whose band in `bands` (one per tile) is `want`, thinned by `density[kind]`. Each instance is the tile's
 * stored data, then a phase (0..2π, from its position) and its model's height (`heights[model]`, default 0). `out` is
 * reused (its buckets for `kinds` are emptied first and grow by doubling).
 * With `split` (the camera and an edge, m), near tiles are split instance by instance: only plants within `edge` of the
 * camera are near, and the rest join the mid band (a near tile reaches up to 90 m past its band's edge); mid plants
 * `far` or more from the camera are left out.
 * With `remap` (variant → variant), plants are drawn with another variant's model, scaled to keep their own height (fewer
 * meshes, so fewer draw calls, where the difference cannot be seen).
 */
export function collectInstances(tiles: readonly TileData[], bands: readonly Band[], want: Band,
  o: { kinds: readonly number[]; density: readonly number[]; heights?: readonly number[]; split?: { x: number; y: number; z: number; edge: number; far?: number };
    remap?: readonly number[] },
  out?: Bucket[]): Bucket[] {
  const buckets = out ?? Array.from({ length: PLANT_KINDS.length * VARIANTS }, newBucket);
  const take = new Uint8Array(PLANT_KINDS.length);
  for (const k of o.kinds) {
    take[k] = 1;
    for (let v = 0; v < VARIANTS; v++) {
      const b = buckets[k * VARIANTS + v];
      b.count = 0;
      b.box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    }
  }
  const sp = o.split, e2 = sp ? sp.edge * sp.edge : 0, f2 = sp?.far ? sp.far * sp.far : Infinity;
  for (let t = 0; t < tiles.length; t++) {
    // 0: take all; 1: only those within the edge; −1: only those beyond it (and, in the mid band, all short of `far`)
    const part = bands[t] === want ? (sp && want === 'near' ? 1 : sp && want === 'mid' ? -1 : 0)
      : sp && want === 'mid' && bands[t] === 'near' ? -1 : NaN;
    if (part !== part) continue;
    const { kind, variant, data } = tiles[t].plants;
    for (let i = 0; i < kind.length; i++) {
      const k = kind[i];
      if (!take[k]) continue;
      const s = i * INSTANCE_STRIDE;
      if (part) {
        const dx = data[s] - sp!.x, dy = data[s + 1] - sp!.y, dz = data[s + 2] - sp!.z, d2 = dx * dx + dy * dy + dz * dz;
        if ((d2 < e2) !== (part > 0) || d2 >= f2) continue;
      }
      if (thinned(data[s + 7], i, o.density[k])) continue;
      const own = k * VARIANTS + variant[i], m = o.remap ? k * VARIANTS + o.remap[variant[i]] : own, b = buckets[m];
      if ((b.count + 1) * GPU_STRIDE > b.data.length) {
        const grown = new Float32Array(b.data.length * 2);
        grown.set(b.data);
        b.data = grown;
      }
      const d = b.data, at = b.count * GPU_STRIDE, x = data[s], y = data[s + 1], z = data[s + 2];
      for (let f = 0; f < INSTANCE_STRIDE; f++) d[at + f] = data[s + f];
      const ph = x * 0.1317 + z * 0.2713;
      d[at + INSTANCE_STRIDE] = (ph - Math.floor(ph)) * 2 * Math.PI;
      d[at + INSTANCE_STRIDE + 1] = o.heights?.[m] ?? 0;
      if (m !== own && o.heights) d[at + 4] *= o.heights[own] / o.heights[m];
      const box = b.box;
      if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (z < box[2]) box[2] = z;
      if (x > box[3]) box[3] = x; if (y > box[4]) box[4] = y; if (z > box[5]) box[5] = z;
      b.count++;
    }
  }
  return buckets;
}

/**
 * One model at one LOD: a mesh per material group (bark, leaf or rock), sharing the vertex attributes and the instance
 * buffer. (Not one mesh with groups: the shadow pass draws every group with the same override material, and its swapping
 * the groups' position nodes made three rebuild those render objects every frame.)
 */
type Draw = { parts: { mesh: Mesh; geo: InstancedBufferGeometry }[]; buf: InstancedInterleavedBuffer | null; reach: number; height: number };

/** Geometries for each of `m`'s groups, sharing its attributes and index; each draws its own range. `info.z` carries the kind. */
function groupGeometries(m: PlantMesh, kind: PlantKind): InstancedBufferGeometry[] {
  const attrs = {
    position: new BufferAttribute(m.positions, 3), normal: new BufferAttribute(m.normals, 3), uv: new BufferAttribute(m.uvs, 2),
    info: new BufferAttribute(withKind(m.info, kind), 4),
  };
  const index = new BufferAttribute(m.indices, 1);
  return m.groups.map((grp) => {
    const g = new InstancedBufferGeometry();
    for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
    g.setIndex(index);
    g.setDrawRange(grp.start, grp.count);
    g.instanceCount = 0;
    return g;
  });
}

/** `materials.get(kind, group)`, or a clear error when the model has a group the kind has no material for. */
function checked(materials: PlantMaterials, kind: PlantKind, group: 'bark' | 'leaf' | 'rock') {
  const m = materials.get(kind, group);
  if (!m) throw new Error(`no ${group} material for plant kind "${kind}" (its model has a ${group} group)`);
  return m;
}

const CLASSES: PlantClass[] = ['tree', 'shrub', 'prop'];
const LODS: Band[] = ['near', 'mid'];

/**
 * The vegetation of the whole Valley. `update(camera, dt)` re-bands the tiles (every 0.2 s, or sooner after a move of
 * 8 m or a turn of 10°), keeping only tiles whose box meets the frustum (grown by 40 m), and refills the LODs that changed.
 * As the camera moves (every 4 m), plants are also split by their own distance: near tiles hand their plants past the
 * near edge to the mid meshes, and mid plants end at the band's far edge, since a tile reaches up to 90 m past its band.
 * Far trees are the impostors' (`impostor.ts`): mid trees are kept to `midTreeReach` and dithered out before `midTree`
 * by their materials. Far shrubs (midShrub to shrubCull) use their mid mesh. The mid band draws three models per kind
 * (`MID_VARIANTS`).
 * Near meshes are on `NEAR_LAYER`, mid meshes on `MID_LAYER` (mid trees also on `MID_TREE_LAYER`); mid shrubs, logs and
 * stumps cast no shadow.
 */
export class VegetationTiles {
  readonly object = new Group();
  private readonly tiles: TileData[];
  private readonly boxes: Box3[] = [];
  private readonly band: Band[][] = CLASSES.map(() => []);
  private readonly drawn: Band[][] = CLASSES.map(() => []);
  private readonly buckets: Bucket[][];
  private readonly draws: (Draw | null)[][];
  private readonly heights: number[];
  private readonly density: number[];
  private readonly kindsOf: Record<PlantClass, number[]>;
  private since = Infinity;
  private readonly splitPos = new Vector3(Infinity, 0, 0);
  private readonly lastPos = new Vector3(Infinity, 0, 0);
  private readonly lastDir = new Vector3();
  private readonly frustum = new Frustum();
  private readonly m4 = new Matrix4();
  private readonly v = new Vector3();
  private readonly box = new Box3();

  constructor(data: ValleyData, models: PlantModelSet, materials: PlantMaterials, private readonly q: WorldQuality) {
    this.object.name = 'vegetation';
    this.tiles = data.tiles;
    this.heights = models.map((m) => m.height);
    this.density = PLANT_KINDS.map((k) => ({ tree: q.treeDensity, shrub: q.shrubDensity, prop: 1 })[classOf(k)]);
    this.kindsOf = { tree: [], shrub: [], prop: [] };
    PLANT_KINDS.forEach((k, i) => this.kindsOf[classOf(k)].push(i));
    for (const t of this.tiles) {
      const d = t.plants.data;
      let y0 = Infinity, y1 = -Infinity;
      for (let s = 1; s < d.length; s += INSTANCE_STRIDE) (y0 = Math.min(y0, d[s])), (y1 = Math.max(y1, d[s]));
      const x0 = -WORLD_SIZE / 2 + t.tx * TILE_SIZE, z0 = -WORLD_SIZE / 2 + t.tz * TILE_SIZE;
      this.boxes.push(y0 > y1 ? new Box3() : new Box3(new Vector3(x0, y0, z0), new Vector3(x0 + TILE_SIZE, y1 + TALLEST, z0 + TILE_SIZE)));
      for (const b of [...this.band, ...this.drawn]) b.push('none');
    }
    this.buckets = LODS.map(() => Array.from({ length: PLANT_KINDS.length * VARIANTS }, newBucket));
    this.draws = LODS.map((_, lod) => models.map((model, mi) => {
      const kind = PLANT_KINDS[Math.floor(mi / VARIANTS)], pm = model.lods[lod];
      if (!pm.indices.length || (lod === 1 && MID_VARIANTS[model.variant] !== model.variant)) return null; // folded away
      const geos = groupGeometries(pm, kind);
      const parts = pm.groups.map((grp, gi) => {
        const mesh = new Mesh(geos[gi], checked(materials, kind, grp.material));
        mesh.name = `${kind}-${model.variant}-${LODS[lod]}-${grp.material}`;
        mesh.receiveShadow = true;
        mesh.castShadow = lod === 0 || !MID_NO_SHADOW.has(kind);
        mesh.layers.set(lod === 0 ? NEAR_LAYER : MID_LAYER);
        if (lod === 1 && TREE_KINDS.includes(kind)) mesh.layers.enable(MID_TREE_LAYER);
        mesh.visible = false;
        this.object.add(mesh);
        return { mesh, geo: geos[gi] };
      });
      return { parts, buf: null, reach: model.radius, height: model.height };
    }));
  }

  /** Re-band and refill if due. Returns true when anything was refilled. */
  update(camera: Camera, dt: number): boolean {
    this.since += dt;
    const p = camera.position, dir = camera.getWorldDirection(this.v);
    const turned = this.lastDir.lengthSq() ? (Math.acos(Math.min(1, dir.dot(this.lastDir))) * 180) / Math.PI : Infinity;
    if (this.since < EVERY && p.distanceTo(this.lastPos) < MOVE && turned < TURN) return false;
    this.since = 0;
    this.lastPos.copy(p);
    this.lastDir.copy(dir);

    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const dirty = CLASSES.map(() => [false, false]);
    const rep: Record<PlantClass, PlantKind> = { tree: 'pine', shrub: 'blueberry', prop: 'boulder' };
    for (let t = 0; t < this.tiles.length; t++) {
      const b = this.boxes[t];
      const seen = !b.isEmpty() && this.frustum.intersectsBox(this.box.copy(b).expandByScalar(FRUSTUM_MARGIN));
      const d = seen ? tileDistance(p, this.tiles[t].tx, this.tiles[t].tz, b.min.y, b.max.y - TALLEST) : Infinity;
      CLASSES.forEach((c, ci) => {
        const band = seen ? bandFor(rep[c], d, this.q, this.band[ci][t]) : 'none';
        this.band[ci][t] = band;
        const drawn: Band = band === 'far' ? (c === 'shrub' || (c === 'tree' && d < midTreeReach(this.q)) ? 'mid' : 'none') : band;
        const was = this.drawn[ci][t];
        if (drawn === was) return;
        lodsToRefill(was, drawn).forEach((d, l) => { if (d) dirty[ci][l] = true; });
        this.drawn[ci][t] = drawn;
      });
    }
    // tiles hold plants up to 90 m past a band's edge: re-split near and mid by each plant's own distance as the camera moves
    if (p.distanceTo(this.splitPos) >= SPLIT_MOVE) {
      this.splitPos.copy(p);
      CLASSES.forEach((_, ci) => { dirty[ci][1] = true; if (this.drawn[ci].includes('near')) dirty[ci][0] = true; });
    }
    let any = false;
    CLASSES.forEach((c, ci) => LODS.forEach((lodBand, lod) => {
      if (!dirty[ci][lod]) return;
      any = true;
      const kinds = this.kindsOf[c], e = edges(rep[c], this.q);
      const split = { x: p.x, y: p.y, z: p.z, edge: e[0], far: c === 'tree' ? midTreeReach(this.q) : e[2] };
      collectInstances(this.tiles, this.drawn[ci], lodBand, { kinds, density: this.density, heights: this.heights, split,
        remap: lod ? MID_VARIANTS : undefined }, this.buckets[lod]);
      for (const k of kinds) for (let v = 0; v < VARIANTS; v++) this.upload(lod, k * VARIANTS + v);
    }));
    return any;
  }

  /** Hand a refilled bucket to its mesh: a new buffer if it grew, else just the filled range; the bounds; the count. */
  private upload(lod: number, mi: number) {
    const draw = this.draws[lod][mi], b = this.buckets[lod][mi];
    if (!draw) return;
    for (const { geo, mesh } of draw.parts) {
      geo.instanceCount = b.count;
      mesh.visible = b.count > 0;
    }
    if (!b.count) return;
    if (!draw.buf || draw.buf.array !== b.data) this.attach(draw, b.data); // a new (or grown) buffer: same layout, same pipeline
    const buf = draw.buf!;
    buf.clearUpdateRanges();
    buf.addUpdateRange(0, b.count * GPU_STRIDE);
    buf.needsUpdate = true;
    const [x0, y0, z0, x1, y1, z1] = b.box, r = draw.reach * 1.2 + 1, h = draw.height * 1.2;
    for (const { geo } of draw.parts) {
      const s = (geo.boundingSphere ??= new Sphere());
      s.center.set((x0 + x1) / 2, (y0 + y1 + h) / 2, (z0 + z1) / 2);
      s.radius = Math.hypot(x1 - x0 + 2 * r, y1 - y0 + h, z1 - z0 + 2 * r) / 2;
    }
  }

  /**
   * Point every part of `draw` at a new instance buffer over `data`. The replaced buffer is not disposed by hand: three 0.186
   * has no `dispose` for an `InterleavedBuffer` (the renderer frees a geometry's buffers only when the geometry is disposed:
   * Geometries.js still says "once we support BufferAttribute.dispose()"), and disposing the part's geometry would also
   * destroy the position, normal, uv and index buffers its sibling parts share. The old attribute is unreachable once
   * replaced (the renderer keys its GPU data by weak reference), so the buffer is freed with it. Buckets only double, so the
   * most that is ever replaced is the final size again (`dispose()` frees the last ones).
   */
  private attach(draw: Draw, data: Float32Array) {
    const buf = (draw.buf = new InstancedInterleavedBuffer(data, GPU_STRIDE, 1).setUsage(DynamicDrawUsage));
    const attrs = [0, 1, 2].map((i) => new InterleavedBufferAttribute(buf, 4, i * 4));
    for (const { geo } of draw.parts) attrs.forEach((a, i) => geo.setAttribute(`i${i}`, a));
  }

  /**
   * Start `compile` with every plant mesh drawable, so no material compiles mid-flight the first time its plants come into
   * view. `compile` must gather what it compiles before it returns (as `compileTogether` does): the meshes are back as they
   * were when this returns, so it is safe while the live loop runs. Meshes with nothing in them get a placeholder buffer.
   */
  compile<T>(compile: () => T): T {
    this.draws.forEach((d, lod) => d.forEach((draw, mi) => { if (draw && !draw.buf) this.attach(draw, this.buckets[lod][mi].data); }));
    const parts = this.draws.flat().flatMap((d) => d?.parts ?? []);
    const was = parts.map(({ mesh, geo }) => [mesh.visible, geo.instanceCount] as const);
    for (const { mesh, geo } of parts) {
      mesh.visible = true;
      mesh.frustumCulled = false;
      geo.instanceCount = Math.max(1, geo.instanceCount);
    }
    try {
      return compile();
    } finally {
      parts.forEach(({ mesh, geo }, i) => {
        mesh.visible = was[i][0];
        geo.instanceCount = was[i][1];
        mesh.frustumCulled = true;
      });
    }
  }

  /**
   * Free the geometries (and with them their GPU vertex, index and instance buffers) and take the meshes out of the scene.
   * The materials are shared and belong to whoever made them.
   */
  dispose() {
    for (const draw of this.draws.flat()) {
      if (!draw) continue;
      for (const { mesh, geo } of draw.parts) {
        this.object.remove(mesh);
        geo.dispose();
      }
      draw.parts.length = 0;
      draw.buf = null;
    }
  }

  /** Counts for checking: instances drawn per LOD, meshes visible, and tiles per drawn band per class. */
  stats() {
    const inst = LODS.map((_, l) => this.buckets[l].reduce((s, b, mi) => s + (this.draws[l][mi] ? b.count : 0), 0));
    const meshes = this.object.children.filter((c) => c.visible).length;
    const tiles = Object.fromEntries(CLASSES.map((c, ci) => [c, Object.fromEntries(LODS.map((b) => [b, this.drawn[ci].filter((x) => x === b).length]))]));
    return { near: inst[0], mid: inst[1], meshes, tiles };
  }
}
