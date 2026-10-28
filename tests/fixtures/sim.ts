import { CAST } from '../../src/cast';
import { HOMES } from '../../src/sim/homes';
import type { SpeciesDef } from '../../src/sim/types';

/** The valley's natives as the simulation takes them: one def per home, named by the species' kid card. */
export function nativeDefs(): SpeciesDef[] {
  return HOMES.map((home) => {
    const c = CAST.find((m) => m.recipe.id === home.species)!;
    return { id: home.species, name: c.cards.name, recipe: c.recipe, home, target: home.count, released: false };
  });
}
