import { inferCoat } from '../recipe/hints';
import type { Coat, Region } from '../recipe/schema';

/** How a coat word draws in the fur shells (see `furMaterial`). Tuned by eye. */
export type CoatLook = {
  lean: number; // 0 stands up … 1 lies flat along the groom
  density: number; // strand cells per fur length (scales the cell size down)
  radius: number; // strand radius as a fraction of its cell (0..0.5)
  guard: number; // share of guard-hair cells (0 none … 1 every guard cell)
  guardLen: number; // guard hair length × fur length
  clump: number; // 0..1 how much strand tips gather to clump centres
  crimp: number; // 0..1 wave amplitude along the strand
  sheen: number; // specular strength for the strand lighting
  droop: number; // gravity sag × fur length
};

export const COAT_LOOK: Record<Coat, CoatLook> = {
  sleek: { lean: 0.85, density: 1.3, radius: 0.32, guard: 0.15, guardLen: 1.1, clump: 0, crimp: 0, sheen: 0.8, droop: 0.1 },
  soft: { lean: 0.55, density: 1.1, radius: 0.36, guard: 0.35, guardLen: 1.2, clump: 0.25, crimp: 0, sheen: 0.5, droop: 0.2 },
  shaggy: { lean: 0.45, density: 0.8, radius: 0.38, guard: 0.6, guardLen: 1.3, clump: 0.55, crimp: 0.15, sheen: 0.45, droop: 0.5 },
  woolly: { lean: 0.15, density: 1.6, radius: 0.42, guard: 0, guardLen: 1, clump: 0.35, crimp: 0.8, sheen: 0.15, droop: 0.1 },
  bristly: { lean: 0.25, density: 0.6, radius: 0.3, guard: 0.7, guardLen: 1.2, clump: 0, crimp: 0, sheen: 0.25, droop: 0 },
  smooth: { lean: 0.9, density: 1, radius: 0.3, guard: 0, guardLen: 1, clump: 0, crimp: 0, sheen: 0.6, droop: 0 },
  downy: { lean: 0.3, density: 1.4, radius: 0.4, guard: 0, guardLen: 1, clump: 0.4, crimp: 0.3, sheen: 0.2, droop: 0.15 },
};

const MIN_CELL = 0.0004, MAX_CELL = 0.0025;

/**
 * The strand cell size (m): clamp(furLength / (density × 8.3), 0.4 mm, 2.5 mm), about 0.12 × length at density 1, so
 * strands scale with the animal (a deer's 12 mm coat gets ~1.1 mm strands, not the old fixed 3 mm studs). 0.4 mm for
 * length ≤ 0.
 */
export function strandCell(furLength: number, density: number): number {
  if (!(furLength > 0)) return MIN_CELL;
  return Math.min(MAX_CELL, Math.max(MIN_CELL, furLength / (density * 8.3)));
}

/** The coat a region shows (its own, or inferred), or null for regions without hair or feathers. */
export function regionCoat(r: Region): Coat | null {
  if (r.covering !== 'fur' && r.covering !== 'feathers') return null;
  return r.coat ?? inferCoat(r);
}
