/**
 * The Eyes view's lenses: how an animal's own senses (its recipe's `mind.senses`) and the light change the picture when
 * you see through its eyes. Only the numbers live here (pure, tested); `src/render/lens.ts` draws them and the views'
 * wiring eases them in and out.
 */
import type { Recipe } from '../recipe/schema';

/**
 * One animal's way of seeing, as strengths for the picture: `hfov` the camera's horizontal field of view (degrees);
 * `barrel` the gentle bulge of a wide view (the share the middle swells by, at most 0.06; the corners stay put);
 * `sideBlur` how soft the sides go (0..1); `soften` weak sight's light blur away from the centre (0..1); `sharpen` keen
 * sight's crispness (0..1); `colour` its colour range; `night` how far into its night sight the picture is (0 by day, or
 * for an animal without good night sight; 1 at deep night); `exposure` the lift (or, for poor night sight, the drop) in
 * stops; `grain` the night grain's size (a share of full brightness); `underwater` 1 with the eye under the water.
 */
export type Lens = {
  hfov: number; barrel: number; sideBlur: number; soften: number; sharpen: number; colour: 'muted' | 'normal' | 'vivid';
  night: number; exposure: number; grain: number; underwater: number;
};

/** Our own sight: the free camera's width (55° vertical is about 88° across at 16:9) and nothing else. */
export const NO_LENS: Lens = { hfov: 88, barrel: 0, sideBlur: 0, soften: 0, sharpen: 0, colour: 'normal', night: 0, exposure: 0, grain: 0, underwater: 0 };

/** The width: 88° for a 270° field of view, 0.4° more per degree more, within 70°–115°. */
const HFOV = { base: 88, at: 270, per: 0.4, min: 70, max: 115 };
/** Keen sight (acuity from KEEN up to 1) narrows the view by up to NARROW° and sharpens it. */
const KEEN = 0.85, NARROW = 15;
/** Weak sight (acuity under WEAK) softens the picture, fully at acuity WEAK − WEAK_SPAN. */
const WEAK = 0.4, WEAK_SPAN = 0.2;
/** Past WIDE° the edges bend (up to BARREL at the widest) and blur toward the sides. */
const WIDE = 90, BARREL = 0.06;
/** Good night sight (from GOOD_NIGHT) sees up to LIFT stops brighter times its night sight; poor (under POOR_NIGHT) up to DROP stops darker. */
const GOOD_NIGHT = 0.7, LIFT = 1.5, POOR_NIGHT = 0.4, DROP = 1;
/** The night grain at deep night: 2.5% of full brightness. */
const GRAIN = 0.025;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * The lens for an animal with `senses`, in `light` (the simulation's `daylight`: 1 by day, 0 at deep night), with its
 * eye `underwater` or not. Prey with eyes on the sides of their heads see wider than we do, hunters narrower; keen sight
 * narrows further and sharpens, weak sight softens; night sight shows at dusk and night, never by day.
 */
export function lensFor(senses: Recipe['mind']['senses'], light: number, underwater: boolean): Lens {
  const keen = clamp((senses.acuity - KEEN) / (1 - KEEN), 0, 1);
  const hfov = clamp(HFOV.base + (senses.fov - HFOV.at) * HFOV.per, HFOV.min, HFOV.max) - NARROW * keen;
  const wide = clamp((hfov - WIDE) / (HFOV.max - WIDE), 0, 1);
  const dark = 1 - clamp(light, 0, 1), sight = senses.night, good = sight >= GOOD_NIGHT;
  const exposure = good ? LIFT * sight * dark : sight < POOR_NIGHT ? -DROP * ((POOR_NIGHT - sight) / POOR_NIGHT) * dark : 0;
  const night = good ? dark : 0;
  return {
    hfov, barrel: BARREL * wide, sideBlur: wide, soften: clamp((WEAK - senses.acuity) / WEAK_SPAN, 0, 1), sharpen: keen,
    colour: senses.colour, night, exposure: exposure || 0, grain: GRAIN * night, underwater: underwater ? 1 : 0,
  };
}
