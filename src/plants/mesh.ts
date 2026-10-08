/** Mesh-building helpers shared by the plant forms: a growable vertex buffer, tubes, leaf cards and small vector maths. */
import { type Vec3, v3, add, sub, scale, dot, cross, norm, len } from '../util/vec';
import type { PlantMesh } from './generator';

export type Material = PlantMesh['groups'][number]['material'];
/** Per-vertex extras: wind weight (0 base … 1 tips), branch level, isLeaf, ambient occlusion. */
export type Info = [number, number, number, number];

/** Rotates `v` about the unit axis `k` by `a` radians (Rodrigues). */
export function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}
/** Any unit vector perpendicular to the unit vector `d`. */
export const perpendicular = (d: Vec3) => norm(cross(d, Math.abs(d.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)));

/** Growable mesh with material groups; `begin` a group, add geometry, and `build` typed arrays at the end. */
export class MeshBuilder {
  private p: number[] = []; private n: number[] = []; private uv: number[] = []; private inf: number[] = []; private idx: number[] = [];
  private groups: PlantMesh['groups'] = [];
  get tris() { return this.idx.length / 3; }
  get vertices() { return this.p.length / 3; }

  begin(material: Material) {
    this.end();
    this.groups.push({ start: this.idx.length, count: 0, material });
  }
  private end() {
    const g = this.groups[this.groups.length - 1];
    if (g) g.count = this.idx.length - g.start;
  }
  vert(p: Vec3, n: Vec3, u: number, v: number, info: Info): number {
    this.p.push(p.x, p.y, p.z);
    this.n.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.inf.push(info[0], info[1], info[2], info[3]);
    return this.p.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  /** Reads back vertex `i`'s position. */
  pos(i: number): Vec3 { return v3(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]); }

  build(): PlantMesh {
    this.end();
    return {
      positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv),
      info: new Float32Array(this.inf), indices: new Uint32Array(this.idx), groups: this.groups.filter((g) => g.count > 0),
    };
  }
}

/** Shading of a vertex: its wind weight and ambient occlusion, from where it sits and how far out the plant it is. */
export type Shade = (p: Vec3, reach: number) => [number, number];

/**
 * A tube along `path` with `radii`, `sides` around. Smooth normals; `u` runs around (0..1), `v` = length in metres / 2.
 * `reach(i)` is the plant-relative reach (0 trunk … 1 tips) of ring `i`. Optional flat caps close the ends.
 */
export function tube(mb: MeshBuilder, path: Vec3[], radii: number[], sides: number, level: number, shade: Shade,
  reach: (i: number) => number, caps: { start?: boolean; end?: boolean } = {}) {
  const rings: number[] = [];
  let side = perpendicular(norm(sub(path[1], path[0]))), along = 0;
  for (let i = 0; i < path.length; i++) {
    const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    side = norm(sub(side, scale(t, dot(side, t))), perpendicular(t)); // parallel transport
    const bi = cross(t, side);
    if (i > 0) along += len(sub(path[i], path[i - 1]));
    rings.push(mb.vertices);
    for (let j = 0; j <= sides; j++) {
      const a = (2 * Math.PI * j) / sides, d = add(scale(side, Math.cos(a)), scale(bi, Math.sin(a)));
      const p = add(path[i], scale(d, radii[i]));
      const [w, ao] = shade(p, reach(i));
      mb.vert(p, d, j / sides, along / 2, [w, level, 0, ao]);
    }
  }
  for (let i = 0; i + 1 < path.length; i++)
    for (let j = 0; j < sides; j++) {
      const a = rings[i] + j, b = rings[i + 1] + j;
      mb.quad(a, a + 1, b + 1, b);
    }
  const cap = (i: number, out: Vec3) => {
    const c = mb.vertices, [w, ao] = shade(path[i], reach(i)), base = rings[i];
    mb.vert(path[i], out, 0.5, 0.5, [w, level, 0, ao]);
    const ring: number[] = [];
    for (let j = 0; j < sides; j++) {
      const q = mb.pos(base + j), a = (2 * Math.PI * j) / sides;
      ring.push(mb.vert(q, out, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), [w, level, 0, ao]));
    }
    for (let j = 0; j < sides; j++) {
      const a = ring[j], b = ring[(j + 1) % sides];
      if (dot(out, sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)])) > 0) mb.tri(c, a, b);
      else mb.tri(c, b, a);
    }
  };
  const n = path.length - 1;
  if (caps.start) cap(0, norm(sub(path[0], path[1])));
  if (caps.end) cap(n, norm(sub(path[n], path[n - 1])));
}

/** A leaf card placed on a twig: base point, unit `axis` (base → tip), unit face `normal`, `size` (m) and plant-relative reach. */
export type Card = { p: Vec3; axis: Vec3; normal: Vec3; size: number; reach: number; level: number };

/**
 * One leaf card: a single quad (broad) or two crossed quads (needle), mapping the full 0..1 UV square with `v` = 0 at
 * the base. Vertex normals blend the face normal 50/50 with `outward(p)` so crowns shade like volumes.
 */
export function card(mb: MeshBuilder, c: Card, crossed: boolean, outward: (p: Vec3) => Vec3, shade: Shade) {
  const quad = (n: Vec3) => {
    const side = scale(norm(cross(c.axis, n)), c.size / 2), tip = scale(c.axis, c.size), ids: number[] = [];
    const corners: [Vec3, number, number][] = [
      [sub(c.p, side), 0, 0], [add(c.p, side), 1, 0], [add(add(c.p, side), tip), 1, 1], [add(sub(c.p, side), tip), 0, 1],
    ];
    for (const [p, u, v] of corners) {
      const o = outward(p), face = dot(n, o) < 0 ? scale(n, -1) : n;
      const [w, ao] = shade(p, Math.min(1, c.reach + 0.15 * v));
      ids.push(mb.vert(p, norm(add(face, o), face), u, v, [w, c.level, 1, ao]));
    }
    mb.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  quad(c.normal);
  if (crossed) quad(norm(cross(c.axis, c.normal)));
}

/** Picks `n` of `count` items evenly (deterministic, keeps the first). */
export function evenly<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]);
  return out;
}

/**
 * Merges cards into `n` clumps (consecutive cards, which sit on the same or neighbouring twigs): each clump sits at
 * its members' mean base, faces their mean normal, and is scaled to keep the covered area (x2 for groups of four).
 */
export function mergeCards(cards: Card[], n: number): Card[] {
  if (n <= 0 || !cards.length) return [];
  n = Math.min(n, cards.length);
  const out: Card[] = [], g = cards.length / n;
  for (let k = 0; k < n; k++) {
    const grp = cards.slice(Math.floor(k * g), Math.floor((k + 1) * g));
    const sum = (f: (c: Card) => Vec3) => grp.reduce((s, c) => add(s, f(c)), v3());
    const m = grp.length, axis = norm(sum((c) => c.axis), grp[0].axis);
    const normal = norm(sub(sum((c) => c.normal), scale(axis, dot(sum((c) => c.normal), axis))), grp[0].normal);
    out.push({
      p: scale(sum((c) => c.p), 1 / m), axis, normal, size: (grp.reduce((s, c) => s + c.size, 0) / m) * Math.sqrt(g),
      reach: grp.reduce((s, c) => s + c.reach, 0) / m, level: grp[0].level,
    });
  }
  return out;
}

/** Crown ellipsoid (centre height `yc`, radii `rx` across and `ry` up) giving outward directions and AO for foliage. */
export function crown(yc: number, rx: number, ry: number) {
  const e = (p: Vec3) => v3(p.x / rx, (p.y - yc) / ry, p.z / rx);
  return {
    outward: (p: Vec3) => norm(e(p), v3(0, 1, 0)),
    /** 0 at the centre, 1 on the surface. */
    depth: (p: Vec3) => len(e(p)),
  };
}
