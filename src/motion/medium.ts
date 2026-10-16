import type { Recipe } from '../recipe/schema';

/** What a body can do in the world, from its recipe and how many wings and legs it ended up with. */
export function moveTraits(recipe: Recipe, wings: number, legs: number) {
  const hab = recipe.mind.habitat;
  const canFly = wings > 0 && (recipe.motion.gait === 'fly' || recipe.motion.gait === 'hover' || hab.includes('air'));
  const swimmer = recipe.motion.gait === 'swim' || (legs === 0 && hab.includes('water'));
  const floater = !swimmer && legs > 0 && hab.includes('water');
  return { canFly, swimmer, floater };
}

/** Which medium a recipe lives in, the way native homes are written: swimmers (and legged fliers that take to water, like the duck) → water, other fliers → air, else land. */
export function mediumOf(recipe: Recipe): 'land' | 'water' | 'air' {
  const count = (role: string) => recipe.parts.filter((p) => p.role === role).length;
  const { canFly, swimmer, floater } = moveTraits(recipe, count('wing'), count('leg'));
  return swimmer || (floater && canFly) ? 'water' : canFly ? 'air' : 'land';
}
