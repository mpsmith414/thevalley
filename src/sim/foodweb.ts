import type { Traits } from './traits';

/** Whether the hunter takes this prey: the right size, never another hunter, and only swimmers reach swimmers. */
export function canHunt(hunter: Traits, prey: Traits, preyIsHunter = false): boolean {
  if (preyIsHunter || hunter.prey[1] <= 0) return false;
  if (prey.size < hunter.prey[0] || prey.size > hunter.prey[1]) return false;
  return !prey.swimmer || hunter.swimmer;
}

/** Whether any of the others is something it could hunt (a duck's bugs are not among them). */
export function isHunter(t: Traits, others: Traits[]): boolean {
  return others.some((o) => o !== t && canHunt(t, o, false));
}
