import { describe, expect, it } from 'vitest';
import { buildBody, individualVariation } from '../../src/builder/build';
import { buildSkeleton } from '../../src/builder/skeleton';
import { skinWeights } from '../../src/builder/weights';
import { hashNumbers } from '../../src/util/hash';
import { lerp } from '../../src/util/vec';
import { biped, bird, blob, hexapod, quadruped, snake } from '../fixtures/recipes';
import { topology } from '../fixtures/mesh';

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
      expect(b.lods[0].positions.length).toBeGreaterThan(b.lods[1].positions.length);
      expect(b.lods[1].positions.length).toBeGreaterThan(b.lods[2].positions.length);
      expect(b.lods[0].positions.length / 3).toBeLessThanOrEqual(120_000);
      for (const p of b.lods[0].positions) expect(Number.isFinite(p)).toBe(true);
      const { edges } = topology(b.lods[0]);
      const open = [...edges.values()].filter((c) => c !== 2).length;
      expect(open / edges.size).toBeLessThan(0.002); // essentially watertight
    }
  });

  it('is deterministic', () => {
    expect(hashNumbers(buildBody(quadruped, [1]).lods[0].positions)).toBe(hashNumbers(buildBody(quadruped, [1]).lods[0].positions));
  });

  it('builds the full-detail body in under 3 seconds', () => {
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
