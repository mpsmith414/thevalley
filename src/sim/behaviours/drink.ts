import { MEDIUM, type Agent, type Pt } from '../types';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';

/** Walking to the bank (speed fraction); there within AT m; it has drunk its fill at this thirst. */
const TRAVEL = 0.25, AT = 0.6, SATED = 0.05;
/** Group-mates lapping within this many metres make a moment. */
const GROUP_NEAR = 40, GROUP = 2;

/**
 * Drinking at the nearest bank (today's `drink`; the bank beside its leader's, when it follows one; a hunter's away from its
 * prey's homes and cover): it walks (or flies, then lands) there and, arriving from the land, stands facing the water,
 * head down, lapping until its thirst is gone.
 * A water bird on the water drinks where it is. A group drinking together is a moment. With no water within reach it
 * does without.
 */
export function drink(a: Agent, t: Traits, s: SimCtx): void {
  const m = a.motion;
  const lapping = a.pose.mouth === 'lap';
  if (!lapping && !(t.floater && s.world.isWater(m.x, m.z))) {
    if (!a.place) {
      const keep = s.keepOff(a), bank = (p: Pt) => s.places.bank(p, keep);
      a.place = s.beside(a, bank) ?? s.apart(a, bank, bank);
    }
    if (!a.place) {
      a.needs.thirst = 0;
      return s.done(a);
    }
    if (!s.at(a, a.place, AT)) {
      s.go(a, t, a.place, TRAVEL);
      s.pose(a, 0, 0);
      return;
    }
  }
  s.stop(a);
  s.pose(a, 1, 0, 'lap');
  if (!lapping && a.group) {
    const herd = s.mates(a, GROUP_NEAR, (b) => b === a || (b.doing === 'drink' && b.pose.mouth === 'lap'));
    if (herd.length >= GROUP) s.moment('drink', a, herd, MEDIUM);
  }
  if (a.needs.thirst <= SATED) s.done(a);
}
