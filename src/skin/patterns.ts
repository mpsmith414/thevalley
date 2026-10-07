import { COVERINGS, MAX_REGIONS, PATTERNS, type Covering, type PatternKind, type Recipe } from '../recipe/schema';
import type { Vec3 } from '../util/vec';

/** All regions' skin settings as fixed-size arrays (8 slots), ready to become shader uniforms. */
export type RegionPack = {
  base: string[];
  belly: string[];
  hasBelly: number[];
  covering: number[]; // index into COVERINGS
  patKind: number[]; // index into PATTERNS, -1 for none
  patColor: string[];
  patScale: number[];
  patAmount: number[];
  patAlong: number[];
  furLength: number[];
  fluff: number[];
};

export function packRegions(recipe: Recipe, regions: string[]): RegionPack {
  const pack: RegionPack = {
    base: [], belly: [], hasBelly: [], covering: [], patKind: [], patColor: [], patScale: [], patAmount: [], patAlong: [], furLength: [], fluff: [],
  };
  for (let i = 0; i < MAX_REGIONS; i++) {
    const r = recipe.skin.regions.find((x) => x.id === regions[i]) ?? recipe.skin.regions[0];
    pack.base.push(r.color);
    pack.belly.push(r.belly ?? r.color);
    pack.hasBelly.push(r.belly ? 1 : 0);
    pack.covering.push(COVERINGS.indexOf(r.covering));
    pack.patKind.push(r.pattern ? PATTERNS.indexOf(r.pattern.kind) : -1);
    pack.patColor.push(r.pattern?.color ?? r.color);
    pack.patScale.push(r.pattern?.scale ?? 0.1);
    pack.patAmount.push(r.pattern?.amount ?? 0);
    pack.patAlong.push(r.pattern?.along ? 1 : 0);
    pack.furLength.push(r.covering === 'fur' || r.covering === 'feathers' ? r.furLength : 0);
    pack.fluff.push(r.fluff);
  }
  return pack;
}

/** How each covering catches the light. */
export const COVERING_LOOK: Record<Covering, { roughness: number; sheen: number; clearcoat: number; bump: number }> = {
  fur: { roughness: 0.95, sheen: 0.4, clearcoat: 0, bump: 0.15 },
  feathers: { roughness: 0.7, sheen: 0.3, clearcoat: 0, bump: 0.35 },
  scales: { roughness: 0.45, sheen: 0, clearcoat: 0.15, bump: 0.6 },
  skin: { roughness: 0.6, sheen: 0.05, clearcoat: 0, bump: 0.1 },
  shell: { roughness: 0.3, sheen: 0, clearcoat: 0.6, bump: 0.3 },
  slime: { roughness: 0.1, sheen: 0, clearcoat: 1, bump: 0.05 },
};

/**
 * CPU twin of the shader's deterministic patterns (stripes, rings, gradient), for tests and docs.
 * Returns how much of the pattern colour shows (0..1). Stripes here have no wobble.
 */
export function patternMaskCPU(kind: PatternKind, bodyPos: Vec3, partT: number, partS: number, scale: number, amount: number, along = false): number {
  switch (kind) {
    case 'stripes': {
      const coord = along ? bodyPos.y : bodyPos.z;
      return 0.5 + 0.5 * Math.sin((coord * 2 * Math.PI) / scale) < amount ? 1 : 0;
    }
    case 'rings':
      return ((partS / scale) % 1 + 1) % 1 < amount ? 1 : 0;
    case 'gradient':
      return partT * amount;
    default:
      throw new Error(`${kind} needs noise; it is shader-only`);
  }
}
