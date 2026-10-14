import { describe, expect, it } from 'vitest';
import { createSkinMaterial, packUniforms, reliefKind } from '../../src/skin/material';
import { packRegions } from '../../src/skin/patterns';
import { quadruped } from '../fixtures/recipes';

describe('reliefKind', () => {
  it('gives scales and shells cells, feathers ripples, the rest a fine grain', () => {
    expect(reliefKind('scales')).toBe('cells');
    expect(reliefKind('shell')).toBe('cells');
    expect(reliefKind('feathers')).toBe('ripple');
    expect(reliefKind('fur')).toBe('grain');
    expect(reliefKind('skin')).toBe('grain');
    expect(reliefKind('slime')).toBe('grain');
  });
});

describe('createSkinMaterial', () => {
  it('darkens its ambient light by the cavity', () => {
    expect(createSkinMaterial(packRegions(quadruped, ['body', 'tail'])).aoNode).not.toBeNull();
  });
});

describe('packUniforms', () => {
  it('marks smooth-feather regions beside the belly flag (colA.w = belly + 2 × feathers)', () => {
    const feathered = { ...quadruped, skin: { ...quadruped.skin, regions: quadruped.skin.regions.map((r) => (r.covering === 'fur' ? { ...r, covering: 'feathers' as const, coat: 'smooth' as const } : r)) } };
    const w = (u: ReturnType<typeof packUniforms>, i: number) => (u.colA.array[i] as { w: number }).w;
    const f = packUniforms(packRegions(feathered, ['body', 'tail']));
    expect(w(f, 0)).toBe(1 + 2); // a belly, and feathers
    expect(w(f, 1)).toBe(0); // the scaly tail
    expect(w(packUniforms(packRegions(quadruped, ['body', 'tail'])), 0)).toBe(1); // fur: the belly only
  });
});
