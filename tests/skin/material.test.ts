import { describe, expect, it } from 'vitest';
import { createSkinMaterial, reliefKind } from '../../src/skin/material';
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
