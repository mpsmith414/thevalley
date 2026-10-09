import { describe, expect, it } from 'vitest';
import { buildBody, individualVariation, snapToSurface, type BuildTimes } from '../../src/builder/build';
import { buildSkeleton } from '../../src/builder/skeleton';
import { skinWeights } from '../../src/builder/weights';
import { hashNumbers } from '../../src/util/hash';
import { lerp } from '../../src/util/vec';
import { fox } from '../../src/cast/fox';
import { hawk } from '../../src/cast/hawk';
import { trout } from '../../src/cast/trout';
import { biped, bird, blob, hexapod, quadruped, snake } from '../fixtures/recipes';
import { minValence, topology, unitNormals } from '../fixtures/mesh';

describe('skin weights', () => {
  const body = buildBody(quadruped, [1]);
  const lod = body.lods[0];
  const bones = body.skeleton.bones;
  const n = lod.positions.length / 3;

  it('are 4 per vertex, valid and summing to 1', () => {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += lod.skinWeight[v * 4 + k];
        expect(lod.skinIndex[v * 4 + k]).toBeLessThan(bones.length);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('let the middle of a lower leg follow that leg only', () => {
    const shin = bones.findIndex((b) => b.name === 'shin_f');
    const mid = lerp(bones[shin].start, bones[shin].end, 0.5);
    const p = new Float32Array([mid.x + bones[shin].r0 * 0.8, mid.y, mid.z]);
    const s = skinWeights(p, body.skeleton, body.regions);
    expect(s.skinIndex[0]).toBe(shin);
    expect(s.skinWeight[0]).toBeGreaterThanOrEqual(0.85);
  });

  it('never let one side pull on the other side’s legs', () => {
    const side = (i: number) => (bones[i].role === 'leg' || bones[i].role === 'foot' ? Math.sign(bones[i].end.x) : 0);
    for (let v = 0; v < n; v++) {
      const main = lod.skinIndex[v * 4];
      if (side(main) === 0) continue;
      for (let k = 1; k < 4; k++)
        if (lod.skinWeight[v * 4 + k] > 0) expect(side(lod.skinIndex[v * 4 + k])).not.toBe(-side(main));
    }
  });
});

describe('buildBody', () => {
  it('makes three levels of detail, each closed', () => {
    for (const r of [quadruped, snake, hexapod, blob, biped, bird]) {
      const b = buildBody(r);
      expect(b.lods).toHaveLength(3);
      const tris = b.lods.map((l) => l.indices.length / 3);
      expect(tris[0]).toBeGreaterThan(tris[1]);
      expect(tris[1]).toBeGreaterThan(tris[2]);
      expect(Math.abs(tris[1] / (tris[0] / 4) - 1)).toBeLessThan(0.3);
      expect(Math.abs(tris[2] / (tris[0] / 16) - 1)).toBeLessThan(0.4);
      expect(b.lods[0].positions.length / 3).toBeLessThanOrEqual(120_000);
      for (const l of b.lods) {
        for (const p of l.positions) expect(Number.isFinite(p)).toBe(true);
        expect(unitNormals(l.normals)).toBe(true);
        expect(minValence(l)).toBeGreaterThanOrEqual(3);
        const { edges } = topology(l);
        expect([...edges.values()].every((c) => c === 2)).toBe(true); // closed
      }
    }
  }, 60_000); // six bodies sampled finely and simplified to three levels: several seconds each when every test file runs at once

  it('gives a fold of back-to-back triangles a unit normal', () => {
    const fold = () => ({ p: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 1]) });
    const flatField = fold(); // no gradient at all: straight up
    expect([...snapToSurface(() => 0, flatField.p, flatField.i, 0.01, 0.01).normals]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const slab = fold(); // a weak gradient along -x still beats nothing
    const n = snapToSurface((x) => -0.1 * x, slab.p, slab.i, 0.01, 0.01).normals;
    for (let v = 0; v < 9; v += 3) expect([n[v], n[v + 1], n[v + 2]].map((c) => Math.round(c * 1e6) / 1e6)).toEqual([-1, 0, 0]);
  });

  it('keeps thin parts sound: small snaps, unit normals that agree with their triangles, no flaps', () => {
    for (const r of [trout, hawk]) {
      const times: BuildTimes = { sample: 0, mesh: 0, weigh: 0, simplify: 0, snap: 0, skin: 0, rawVertices: 0, maxSnap: 0 };
      const lods = buildBody(r, [0, 1, 2], times).lods;
      expect(times.maxSnap).toBeLessThanOrEqual(1 + 1e-9); // at most one fine cell
      for (const l of lods) {
        expect(unitNormals(l.normals)).toBe(true);
        expect(minValence(l)).toBeGreaterThanOrEqual(3); // no back-to-back fin flaps
      }
      const { positions: P, normals: N, indices: I } = lods[0];
      let flipped = 0; // triangles whose face opposes all three of their vertex normals
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        if ([a, b, c].every((o) => fx * N[o] + fy * N[o + 1] + fz * N[o + 2] < 0)) flipped++;
      }
      expect(flipped / (I.length / 3)).toBeLessThanOrEqual(0.0005); // measured: trout 3 of 13358, hawk 0
    }
  }, 20_000);

  describe('the fox at full detail', () => {
    const body = buildBody(fox, [0]);
    const lod = body.lods[0];
    const bones = body.skeleton.bones;

    it('has a denser face than flank', () => {
      // per group: vertices / (sum of incident triangle areas / 3)
      const area = new Float64Array(lod.positions.length / 3);
      const P = lod.positions, I = lod.indices;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const s = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 / 3;
        area[I[t]] += s; area[I[t + 1]] += s; area[I[t + 2]] += s;
      }
      const density = (roles: string[]) => {
        let n = 0, a = 0;
        for (let v = 0; v < area.length; v++) if (roles.includes(bones[lod.boneOf[v]].role)) { n++; a += area[v]; }
        return n / a;
      };
      expect(density(['head', 'mouth'])).toBeGreaterThan(2.5 * density(['torso']));
    });

    it('stays near today’s triangle budget', () => {
      const target = 1.2 * 2 * 9560; // today's fox: 9560 vertices at 110 cells
      expect(Math.abs(lod.indices.length / 3 / target - 1)).toBeLessThan(0.25);
    });
  });

  it('is deterministic', () => {
    expect(hashNumbers(buildBody(quadruped, [1]).lods[0].positions)).toBe(hashNumbers(buildBody(quadruped, [1]).lods[0].positions));
  }, 20_000);

  it('gives one level alone exactly as the full set does', () => {
    const two = buildBody(quadruped, [2]).lods[0], full = buildBody(quadruped).lods[2];
    expect(hashNumbers(two.positions)).toBe(hashNumbers(full.positions));
    expect(hashNumbers(two.indices)).toBe(hashNumbers(full.indices));
  }, 20_000);

  // Wall-clock: flaky on a busy machine, so only with PERF=1 (body build times: npx tsx tools/perf.ts).
  it.skipIf(!process.env.PERF)('builds the full-detail body in under 3 seconds', () => {
    const t0 = performance.now();
    buildBody(quadruped, [0]);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('individualVariation', () => {
  const sk = buildSkeleton(quadruped);
  const parts = sk.bones.map((b) => b.partId);

  it('is the identity for seed 0 and deterministic otherwise', () => {
    const id = individualVariation(quadruped, 0, parts.length, parts);
    expect(id.boneScale.every((s) => s === 1)).toBe(true);
    expect(individualVariation(quadruped, 5, parts.length, parts)).toEqual(individualVariation(quadruped, 5, parts.length, parts));
  });

  it('stays within the inherited spread and keeps mirrored pairs equal', () => {
    const spread = quadruped.inheritance.find((t) => t.path === 'life.sizeM')!.spread;
    for (let seed = 1; seed < 50; seed++) {
      const v = individualVariation(quadruped, seed, parts.length, parts);
      for (const s of v.boneScale) expect(Math.abs(s - 1)).toBeLessThanOrEqual((1 + spread) * (1 + spread / 2) - 1 + 1e-9);
      sk.bones.forEach((b, i) => {
        if (b.mirrored) expect(v.boneScale[i]).toBe(v.boneScale[sk.bones.findIndex((o) => o.partId === b.partId)]);
      });
    }
  });
});
