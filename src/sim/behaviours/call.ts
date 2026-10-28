import { MEDIUM, type Agent } from '../types';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';

/** A calling bout lasts this many animal seconds, in calls of CALL s every PULSE s. */
const BOUT = 10, PULSE = 2.5, CALL = 1.2;
/** Callers of its kind within this many metres make a chorus (at least CHORUS of them). */
const NEAR = 80, CHORUS = 2;

/** Calling where it is (the frogs at dusk), a call every few seconds; two or more calling together are a chorus. */
export function call(a: Agent, _t: Traits, s: SimCtx): void {
  s.stop(a);
  const time = s.t - a.since;
  s.pose(a, 0, 0);
  a.pose.calling = time % PULSE < CALL ? 1 : 0;
  if (time === 0) {
    const chorus = s.mates(a, NEAR, (b) => b === a || b.doing === 'call');
    if (chorus.length >= CHORUS) s.moment('chorus', a, chorus, MEDIUM);
  }
  if (time >= BOUT) s.done(a);
}
