import { describe, expect, it } from 'vitest';
import { COATS } from '../../src/recipe/schema';
import { SkinnedMesh, BufferGeometry, MeshStandardMaterial, Skeleton } from 'three/webgpu';
import { createFurShells, furMaterial, furShellOffsets, packCoat, shellTop } from '../../src/skin/fur';
import { COAT_LOOK, featherCell, strandCell } from '../../src/skin/coat';
import { FurLightingModel } from '../../src/skin/fur-light';
import { packRegions } from '../../src/skin/patterns';
import { blob, quadruped } from '../fixtures/recipes';

/** The quadruped with its fur turned to smooth feathers (and, with `tail`, a scaly tail kept). */
const feathered = { ...quadruped, skin: { ...quadruped.skin, regions: quadruped.skin.regions.map((r) => (r.covering === 'fur' ? { ...r, covering: 'feathers' as const, coat: 'smooth' as const } : r)) } };

describe('furShellOffsets', () => {
  it('rises to the fur length, packed closer near the skin', () => {
    const o = furShellOffsets(16, 0.04);
    expect(o).toHaveLength(16);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
    expect(o[15]).toBeCloseTo(0.04, 10);
    expect(o[1] - o[0]).toBeLessThan(o[15] - o[14]);
  });
});

describe('furMaterial', () => {
  it('is null when no region has fur', () => {
    const bare = { ...blob, skin: { ...blob.skin, regions: blob.skin.regions.map((r) => ({ ...r, covering: 'skin' as const, furLength: 0, coat: null })) } };
    expect(furMaterial(packRegions(bare, bare.skin.regions.map((r) => r.id)))).toBeNull();
  });

  it('cuts strands with a plain alpha test (alpha to coverage turned partly covered pixels grey)', () => {
    const m = furMaterial(packRegions(quadruped, ['body', 'tail']));
    expect(m).not.toBeNull();
    expect(m!.alphaToCoverage).toBe(false);
    expect(m!.alphaTest).toBe(0.5);
  });

  it('is lit as strands, with the ambient light × the cavity', () => {
    const m = furMaterial(packRegions(quadruped, ['body', 'tail']))!;
    expect(m.setupLightingModel()).toBeInstanceOf(FurLightingModel);
    expect(m.aoNode).not.toBeNull();
  });

  it('looks its received shadows up out from the body (so the backlit rim clears the body shadow edge)', () => {
    expect(furMaterial(packRegions(quadruped, ['body', 'tail']))!.receivedShadowPositionNode).not.toBeNull();
  });
});

describe('packRegions coat', () => {
  it('puts each region coat index in the pack (-1 for scales)', () => {
    const p = packRegions(quadruped, ['body', 'tail']);
    expect(p.coat).toHaveLength(8);
    expect(p.coat[0]).toBe(COATS.indexOf('soft')); // 2 cm fur, fluff 0.3
    expect(p.coat[1]).toBe(-1);
  });
});

describe('packCoat', () => {
  it('packs each region coat in three vec4s (cell from strandCell, then the sheen), then the eyes', () => {
    const p = packRegions(quadruped, ['body', 'tail']);
    const v = packCoat(p, [{ bone: 0, centre: { x: 0.1, y: 0.2, z: 0.3 }, dir: { x: 0, y: 0, z: 1 }, r: 0.01 }]);
    expect(v).toHaveLength(8 * 3 + 4);
    const soft = COAT_LOOK.soft;
    expect(v[0].toArray()).toEqual([soft.lean, soft.radius, soft.guard, soft.guardLen]);
    expect(v[1].w).toBeCloseTo(strandCell(0.02, soft.density), 10);
    expect(v[2].x).toBe(soft.sheen);
    expect(v[5].x).toBe(0); // scales: no coat, no sheen
    expect(v[24].toArray()).toEqual([0.1, 0.2, 0.3, 0.01]);
    expect(v[25].w).toBe(0); // no second eye
  });

  it('the shells reach the longest guard hairs (1 fur length without any)', () => {
    expect(shellTop(packRegions(quadruped, ['body', 'tail']))).toBe(COAT_LOOK.soft.guardLen);
    const woolly = { ...quadruped, skin: { ...quadruped.skin, regions: quadruped.skin.regions.map((r) => ({ ...r, coat: r.covering === 'fur' ? ('woolly' as const) : null })) } };
    expect(shellTop(packRegions(woolly, ['body', 'tail']))).toBe(1);
  });
});

describe('feather mode', () => {
  it('packs the feather flag and the feather cell beside the sheen, for smooth feathers only', () => {
    const v = packCoat(packRegions(feathered, ['body', 'tail']));
    expect(v[2].toArray()).toEqual([COAT_LOOK.smooth.sheen, 1, featherCell(0.02), 0]);
    expect(v[5].y).toBe(0); // scales
    expect(packCoat(packRegions(quadruped, ['body', 'tail']))[2].y).toBe(0); // fur
  });

  it('a coat of only feathers gets only the lowest shell (the feathers draw on no other)', () => {
    const base = new SkinnedMesh<BufferGeometry, MeshStandardMaterial>(new BufferGeometry(), new MeshStandardMaterial());
    base.bind(new Skeleton([]));
    const m = furMaterial(packRegions(feathered, ['body', 'tail']))!;
    for (const count of [8, 16, 24]) {
      const shells = createFurShells(base, m, count);
      expect(shells.length).toBe(1);
      expect(shells[0].userData.shellT).toBe(furShellOffsets(count)[0]);
      expect(shells[0].userData.shellPrev).toBe(0); // the shell the feather branch draws on
    }
    // fur anywhere on the body keeps every shell
    expect(createFurShells(base, furMaterial(packRegions(quadruped, ['body', 'tail']))!, 16).length).toBe(16);
  });
});
