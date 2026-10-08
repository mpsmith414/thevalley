import { describe, it, expect } from 'vitest';
import { PLANT_KINDS, VARIANTS, SPECIES, TREE_KINDS, type PlantKind, type SiteInfo } from '../../src/plants/species';
import { buildPlant, buildAllPlants, TRI_BUDGET, type PlantMesh, type PlantModel } from '../../src/plants/generator';
import { hashNumbers } from '../../src/util/hash';

const SEED = 1234;
const all = buildAllPlants(SEED);
const others = [7, 20261007].map(buildAllPlants);
const form = (k: PlantKind) => SPECIES[k].spec.form;
const tris = (m: PlantMesh) => m.indices.length / 3;
const models = (k: PlantKind) => all.filter((m) => m.kind === k);
const isYoung = (m: PlantModel) => m.variant < 2;
const LIVING: PlantKind[] = PLANT_KINDS.filter((k) => ['tree', 'shrub', 'fern'].includes(form(k)));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

describe('buildAllPlants', () => {
  it('returns 11 x 6 models in the documented order', () => {
    expect(all.length).toBe(PLANT_KINDS.length * VARIANTS);
    expect(all.length).toBe(66);
    all.forEach((m, i) => {
      expect(m.kind).toBe(PLANT_KINDS[Math.floor(i / VARIANTS)]);
      expect(m.variant).toBe(i % VARIANTS);
    });
  });

  it('builds every kind and variant with two non-empty LODs', () => {
    for (const m of all) {
      expect(m.lods.length).toBe(2);
      for (const l of m.lods) expect(tris(l)).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);
      expect(m.radius).toBeGreaterThan(0);
    }
  });

  it('produces finite geometry with matching attribute lengths', () => {
    for (const m of all) for (const l of m.lods) {
      const n = l.positions.length / 3;
      expect(l.normals.length).toBe(n * 3);
      expect(l.uvs.length).toBe(n * 2);
      expect(l.info.length).toBe(n * 4);
      for (const a of [l.positions, l.normals, l.uvs, l.info]) expect(a.every(Number.isFinite)).toBe(true);
      let bad = 0;
      for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(l.normals[i * 3], l.normals[i * 3 + 1], l.normals[i * 3 + 2]) - 1) > 1e-3) bad++;
      expect(bad, `${m.kind}/${m.variant} non-unit normals`).toBe(0);
    }
  });

  it('keeps indices in range and groups covering them, bark first', () => {
    for (const m of all) for (const l of m.lods) {
      const n = l.positions.length / 3;
      expect(l.indices.length % 3).toBe(0);
      expect(l.indices.every((i) => i < n)).toBe(true);
      let at = 0;
      for (const g of l.groups) {
        expect(g.start).toBe(at);
        at += g.count;
      }
      expect(at).toBe(l.indices.length);
      const mats = l.groups.map((g) => g.material);
      const f = form(m.kind);
      if (f === 'tree' || f === 'shrub') expect(mats).toEqual(l === m.lods[0] ? ['bark', 'leaf'] : mats.length === 1 ? ['bark'] : ['bark', 'leaf']);
      if (f === 'fern') expect(mats).toEqual(['leaf']);
      if (f === 'rock') expect(mats).toEqual(['rock']);
      if (f === 'log' || f === 'stump') expect(mats).toEqual(['bark']);
    }
  });

  it('marks leaf vertices with info.z = 1 and bark with 0', () => {
    for (const m of all) for (const l of m.lods) for (const g of l.groups) {
      const want = g.material === 'leaf' ? 1 : 0;
      let bad = 0;
      for (let i = g.start; i < g.start + g.count; i++) if (l.info[l.indices[i] * 4 + 2] !== want) bad++;
      expect(bad, `${m.kind}/${m.variant} ${g.material}`).toBe(0);
    }
  });

  it('stays within TRI_BUDGET at each LOD, and LOD1 is lighter than LOD0, over several seeds', () => {
    for (const m of [...all, ...others.flat()]) {
      const [b0, b1] = TRI_BUDGET[form(m.kind)];
      expect(tris(m.lods[0]), `${m.kind}/${m.variant} LOD0`).toBeLessThanOrEqual(b0);
      expect(tris(m.lods[1]), `${m.kind}/${m.variant} LOD1`).toBeLessThanOrEqual(b1);
      expect(tris(m.lods[1])).toBeLessThan(tris(m.lods[0]));
    }
  });

  it('is deterministic per (kind, variant, seed) and varies with the seed', () => {
    for (const k of PLANT_KINDS) for (const v of [0, 3]) {
      const a = buildPlant(k, v, SEED);
      expect(hashNumbers(a.lods[0].positions)).toBe(hashNumbers(all[PLANT_KINDS.indexOf(k) * VARIANTS + v].lods[0].positions));
      expect(hashNumbers(a.lods[1].positions)).toBe(hashNumbers(buildPlant(k, v, SEED).lods[1].positions));
      expect(hashNumbers(a.lods[0].positions)).not.toBe(hashNumbers(buildPlant(k, v, SEED + 1).lods[0].positions));
    }
  });

  it('makes variants of one kind differ from each other', () => {
    for (const k of PLANT_KINDS) {
      const hs = new Set(models(k).map((m) => hashNumbers(m.lods[0].positions)));
      expect(hs.size).toBe(VARIANTS);
    }
  });

  it('makes young variants shorter than mature ones', () => {
    for (const k of LIVING) {
      const ms = models(k);
      expect(mean(ms.filter(isYoung).map((m) => m.height)), k).toBeLessThan(mean(ms.filter((m) => !isYoung(m)).map((m) => m.height)));
    }
  });

  it('keeps height within the spec range (scaled for young)', () => {
    for (const m of all) {
      const s = SPECIES[m.kind].spec;
      if (s.form === 'tree' || s.form === 'shrub' || s.form === 'stump') {
        const [lo, hi] = s.height, young = isYoung(m) && s.form !== 'stump';
        expect(m.height, `${m.kind}/${m.variant}`).toBeGreaterThanOrEqual((young ? 0.45 * lo : lo) - 1e-3);
        expect(m.height, `${m.kind}/${m.variant}`).toBeLessThanOrEqual((young ? 0.6 * hi : hi) + 1e-3);
      }
      if (s.form === 'fern') expect(m.height).toBeLessThanOrEqual(s.length[1]);
      if (s.form === 'rock') expect(m.height).toBeLessThanOrEqual(s.size[1]);
    }
  });

  it('measures height and radius from the LOD0 geometry', () => {
    for (const m of all) {
      const p = m.lods[0].positions;
      let top = -Infinity, r = 0;
      for (let i = 0; i < p.length; i += 3) {
        top = Math.max(top, p[i + 1]);
        r = Math.max(r, Math.hypot(p[i], p[i + 2]));
      }
      expect(m.height).toBeCloseTo(top, 3);
      expect(m.radius).toBeCloseTo(r, 3);
    }
  });

  it('has info.x 0 at the trunk base and reaching >= 0.9 at the tips', () => {
    for (const m of all.filter((m) => LIVING.includes(m.kind))) for (const l of m.lods) {
      const p = l.positions, g = l.groups[0]; // trunk/stems (bark), or fronds for ferns; foliage may droop lower
      let low = Infinity, wLow = NaN, wMin = Infinity, wMax = -Infinity;
      for (let i = 0; i < p.length / 3; i++) (wMin = Math.min(wMin, l.info[i * 4])), (wMax = Math.max(wMax, l.info[i * 4]));
      expect(wMin).toBeGreaterThanOrEqual(0);
      expect(wMax).toBeLessThanOrEqual(1);
      for (let k = g.start; k < g.start + g.count; k++) {
        const i = l.indices[k];
        if (p[i * 3 + 1] < low) (low = p[i * 3 + 1]), (wLow = l.info[i * 4]);
      }
      expect(wLow, `${m.kind}/${m.variant}`).toBe(0);
      expect(wMax, `${m.kind}/${m.variant}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('gives trees darker AO in the crown centre than at the crown surface', () => {
    for (const k of TREE_KINDS) {
      const l = models(k)[3].lods[0];
      const aos: number[] = [];
      for (let i = 0; i < l.info.length / 4; i++) aos.push(l.info[i * 4 + 3]);
      expect(Math.min(...aos)).toBeLessThan(0.5);
      expect(Math.max(...aos)).toBeGreaterThan(0.9);
    }
  });

  it('maps every leaf card to the full 0..1 UV square', () => {
    for (const m of all) for (const l of m.lods) for (const g of l.groups.filter((g) => g.material === 'leaf')) {
      let uMin = 1, uMax = 0, vMin = 1, vMax = 0;
      for (let i = g.start; i < g.start + g.count; i++) {
        const j = l.indices[i];
        uMin = Math.min(uMin, l.uvs[j * 2]), uMax = Math.max(uMax, l.uvs[j * 2]);
        vMin = Math.min(vMin, l.uvs[j * 2 + 1]), vMax = Math.max(vMax, l.uvs[j * 2 + 1]);
      }
      expect([uMin, uMax, vMin, vMax]).toEqual([0, 1, 0, 1]);
    }
  });
});

describe('generator invariants over several seeds', () => {
  const every = [all, ...others].flat();

  it('winds every visible triangle to face the same way as its vertex normals', () => {
    for (const m of every) for (const l of m.lods) for (const g of l.groups) {
      const P = l.positions, N = l.normals;
      let bad = 0;
      for (let i = g.start; i < g.start + g.count; i += 3) {
        const [a, b, c] = [l.indices[i] * 3, l.indices[i + 1] * 3, l.indices[i + 2] * 3];
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        if (Math.hypot(fx, fy, fz) < 1e-12) continue; // degenerate: no facing to check
        // A boulder's squashed underside has small dimples whose smooth normals disagree; they are buried, so allowed.
        if (g.material === 'rock' && Math.max(P[a + 1], P[b + 1], P[c + 1]) < 0) continue;
        const d = fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]);
        if (!(d > 0)) bad++;
      }
      expect(bad, `${m.kind}/${m.variant} ${g.material} back-facing triangles`).toBe(0);
    }
  });

  it('keeps every tree and shrub vertex above y = -0.1', () => {
    for (const m of every.filter((m) => ['tree', 'shrub'].includes(form(m.kind)))) for (const l of m.lods) {
      let low = Infinity;
      for (let i = 1; i < l.positions.length; i += 3) low = Math.min(low, l.positions[i]);
      expect(low, `${m.kind}/${m.variant}`).toBeGreaterThanOrEqual(-0.1);
    }
  });

  it('gives ferns 6-14 fronds: 6-8 young, 8-14 mature', () => {
    for (const m of every.filter((m) => m.kind === 'fern')) {
      const fronds = m.lods[1].indices.length / 3 / 8; // LOD1: 4 rows x 1 quad per frond
      expect(Number.isInteger(fronds)).toBe(true);
      const [lo, hi] = isYoung(m) ? [6, 8] : [8, 14];
      expect(fronds, `fern/${m.variant}`).toBeGreaterThanOrEqual(lo);
      expect(fronds, `fern/${m.variant}`).toBeLessThanOrEqual(hi);
    }
  });
});

describe('SPECIES scatter rules', () => {
  const site = (o: Partial<SiteInfo> = {}, b: Partial<SiteInfo['b']> = {}): SiteInfo => ({
    b: { forest: 1, meadow: 0, rock: 0, shore: 0, beach: 0, ...b }, slope: 10, moisture: 0.3, waterDepth: 0, wet: false, edge: 0, northness: 0, ...o,
  });

  it('returns suitability in [0, 1]', () => {
    const sites = [site(), site({ moisture: 1, edge: 1, northness: 1 }, { rock: 1, shore: 1, meadow: 1 }), site({ slope: 0, moisture: 0, northness: -1 })];
    for (const k of PLANT_KINDS) for (const s of sites) {
      const v = SPECIES[k].scatter.suit(s);
      expect(v, k).toBeGreaterThanOrEqual(0);
      expect(v, k).toBeLessThanOrEqual(1);
    }
  });

  it('never grows anything in water, wet ground or on cliffs', () => {
    const lush = { forest: 1, meadow: 1, rock: 1, shore: 1, beach: 1 };
    for (const k of PLANT_KINDS) {
      expect(SPECIES[k].scatter.suit(site({ wet: true, moisture: 0.8, edge: 1 }, lush)), k).toBe(0);
      expect(SPECIES[k].scatter.suit(site({ waterDepth: 0.2, moisture: 0.8, edge: 1 }, lush)), k).toBe(0);
      expect(SPECIES[k].scatter.suit(site({ slope: 56, moisture: 0.8, edge: 1 }, lush)), k).toBe(0);
    }
    expect(SPECIES.pine.scatter.suit(site({ slope: 50 }))).toBe(0);
    expect(SPECIES.boulder.scatter.suit(site({ slope: 50 }))).toBeGreaterThan(0);
  });

  it('follows the table on a few spot checks', () => {
    expect(SPECIES.pine.scatter.suit(site({ moisture: 0.5 }))).toBeCloseTo(0.7);
    expect(SPECIES.pine.scatter.suit(site({ slope: 36 }))).toBe(0);
    expect(SPECIES.spruce.scatter.suit(site({ northness: 1, moisture: 0.6 }))).toBeCloseTo(1);
    expect(SPECIES.alder.scatter.suit(site({ moisture: 0.5 }))).toBe(0);
    expect(SPECIES.alder.scatter.suit(site({ moisture: 0.7 }))).toBeCloseTo(0.7);
    expect(SPECIES.birch.scatter.suit(site({}, { forest: 0, meadow: 1 }))).toBeCloseTo(0.15);
    expect(SPECIES.boulder.scatter.suit(site({}, { forest: 0, rock: 0 }))).toBeCloseTo(15 / 95);
    expect(SPECIES.boulder.scatter.suit(site({}, { forest: 0, rock: 1 }))).toBeCloseTo(1);
    expect(SPECIES.boulder.scatter.perHa).toBe(95);
  });

  it('sets a trunk obstacle radius for every tree', () => {
    for (const k of TREE_KINDS) expect(SPECIES[k].scatter.trunk).toBeGreaterThan(0);
  });
});
