import { buildSkeleton } from '../builder/skeleton';
import { findLimbs } from '../motion/limbs';
import { moveTraits } from '../motion/medium';
import type { Recipe } from '../recipe/schema';
import type { Medium } from '../valley/types';

/** What the simulation needs to know about a kind of animal, read from its recipe once. */
export type Traits = { size: number; topSpeed: number; flySpeed: number; stamina: number; canFly: boolean; hover: boolean;
  swimmer: boolean; floater: boolean; medium: Medium; grazer: boolean; smallFood: boolean; prey: [number, number];
  social: Recipe['mind']['social']; activity: Recipe['mind']['activity']; jumpiness: number; boldness: number;
  senses: Recipe['mind']['senses']; freezes: boolean; burrower: boolean; bodyLength: number;
  /** A grazer that also eats leaves, so it feeds at the forest edge as well as in the meadow. */
  browser: boolean };

/** Plant foods that make an animal a grazer (grass and the like, not berries). */
const GRAZED = /grass|clover|flower|leaf|leaves|water plant|seed/i;
/** Plant foods found at the forest edge (leaves, shoots, acorns), not out in the meadow. */
const BROWSED = /leaf|leaves|shoot|twig|acorn/i;
/** A hunter whose biggest prey is at most this long (metres) lives on small things like bugs and fry. */
const SMALL_PREY = 0.1;
/** Skittish burrow dwellers up to this long (metres) freeze instead of bolting. */
const FREEZER_SIZE = 0.6;

/**
 * Traits from a recipe. `cap` is the speed cap of wherever it lives (the valley's 8; the lab's rig passes 3):
 * `topSpeed` is the ground top speed and `flySpeed` the flying one, as the rig's `topSpeed` works them out.
 * Body length and the wing and leg counts come from the same skeleton the rig measures (no meshing needed).
 */
export function traitsFor(recipe: Recipe, medium: Medium, cap = 8): Traits {
  const skeleton = buildSkeleton(recipe);
  const limbs = findLimbs(skeleton);
  const { canFly, swimmer, floater } = moveTraits(recipe, limbs.filter((l) => l.kind === 'wing').length, limbs.filter((l) => l.kind === 'leg').length);
  const { life, mind } = recipe;
  const size = Math.max(0.05, Math.min(8, life.sizeM));
  const anyPlant = mind.preyMax === 0 && mind.plants.some((p) => /^(any|all)\b|^plants?$/i.test(p));
  return {
    size,
    topSpeed: Math.max(0.3, Math.min(cap, life.topSpeed)),
    flySpeed: Math.min(life.topSpeed, cap * 1.6),
    stamina: life.stamina,
    canFly,
    hover: recipe.motion.gait === 'hover',
    swimmer,
    floater,
    medium,
    grazer: anyPlant || mind.plants.some((p) => GRAZED.test(p)),
    smallFood: mind.preyMax > 0 && mind.preyMax <= SMALL_PREY,
    prey: [mind.preyMin, mind.preyMax],
    social: mind.social,
    activity: mind.activity,
    jumpiness: mind.jumpiness,
    boldness: mind.boldness,
    senses: mind.senses,
    freezes: size <= FREEZER_SIZE && mind.habitat.includes('burrow') && mind.jumpiness >= 0.9,
    burrower: mind.habitat.includes('burrow'),
    bodyLength: Math.max(0.05, skeleton.max.z - skeleton.min.z),
    browser: anyPlant || mind.plants.some((p) => BROWSED.test(p)),
  };
}
