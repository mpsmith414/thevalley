import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { boneFlows } from '../../src/builder/groom';
import { buildSkeleton } from '../../src/builder/skeleton';
import { CAST } from '../../src/cast';
import { blob, snake } from '../fixtures/recipes';

const deer = CAST.find((c) => c.recipe.id === 'deer')!.recipe;
const at = (a: Float32Array, v: number, n = 4) => ({ x: a[v * n], y: a[v * n + 1], z: a[v * n + 2] });

describe('groom', () => {
  it('flows tail-wards on the torso, down the legs, back from the nose; none on eyes', () => {
    const sk = buildSkeleton(deer), f = boneFlows(sk);
    sk.bones.forEach((b, i) => {
      if (b.role === 'torso') expect(f[i].z).toBeLessThan(-0.7);
      if (b.role === 'leg' || b.role === 'foot') expect(f[i].y).toBeLessThan(-0.3);
      if (b.role === 'head' || b.role === 'mouth') expect(f[i].z).toBeLessThan(0);
      if (b.role === 'eye') expect(Math.hypot(f[i].x, f[i].y, f[i].z)).toBe(0);
    });
  });
  const body = buildBody(deer, [1]), lod = body.lods[0];
  const n = lod.positions.length / 3;
  it('is a unit tangent everywhere except on the eyes', () => {
    let bad = 0;
    for (let v = 0; v < n; v++) {
      const g = at(lod.groom, v), nn = at(lod.normals, v, 3), l = Math.hypot(g.x, g.y, g.z);
      if (l === 0) { if (body.skeleton.bones[lod.boneOf[v]].role !== 'eye') bad++; continue; }
      if (Math.abs(l - 1) > 1e-3 || Math.abs(g.x * nn.x + g.y * nn.y + g.z * nn.z) > 0.05) bad++;
    }
    expect(bad).toBe(0);
  });
  it('points tail-wards on the flanks and down the legs', () => {
    let flank = 0, flankN = 0, leg = 0, legN = 0;
    for (let v = 0; v < n; v++) {
      const role = body.skeleton.bones[lod.boneOf[v]].role, g = at(lod.groom, v);
      if (role === 'torso' && Math.abs(lod.normals[v * 3]) > 0.7) { flank += -g.z; flankN++; }
      if (role === 'leg') { leg += -g.y; legN++; }
    }
    expect(flank / flankN).toBeGreaterThan(0.7);
    expect(leg / legN).toBeGreaterThan(0.7);
  });
  it('turns smoothly: neighbours agree within 15 degrees on average', () => {
    let sum = 0, cnt = 0;
    const I = lod.indices;
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = at(lod.groom, I[t + k]), b = at(lod.groom, I[t + ((k + 1) % 3)]);
      const la = Math.hypot(a.x, a.y, a.z), lb = Math.hypot(b.x, b.y, b.z);
      if (!la || !lb) continue;
      sum += Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb))); cnt++;
    }
    expect(sum / cnt).toBeLessThan((15 * Math.PI) / 180);
  });
  it('is finite and deterministic on odd bodies', () => {
    for (const r of [blob, snake]) {
      const body = buildBody(r, [2]), a = body.lods[0].groom, b = buildBody(r, [2]).lods[0].groom;
      expect(a.every(Number.isFinite)).toBe(true);
      // every non-eye vertex has a unit direction (an all-zero array fails here)
      for (let v = 0; v < a.length / 4; v++) {
        if (body.skeleton.bones[body.lods[0].boneOf[v]].role !== 'eye') expect(Math.hypot(a[v * 4], a[v * 4 + 1], a[v * 4 + 2])).toBeCloseTo(1, 3);
      }
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});
