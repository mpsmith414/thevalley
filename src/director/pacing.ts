/** When the narrator may speak: sparingly, never over herself, and never late. */
import type { LineCue } from './planner';
import type { LineBeat } from './types';

/** Seconds of quiet between one line's end and the next line's start. */
export const GAP_S = 20;
/** A hunt moves fast, so its lines need only this long a pause after the last line. */
export const HUNT_GAP_S = 4;
/** A cue not started this many seconds after it was asked for is dropped. */
export const STALE_S = 4;

/** The beats of a hunt. */
const HUNT: readonly LineBeat[] = ['creep', 'chase', 'catch', 'escape', 'dive'];

/** Holds the lines the planner asks for and lets one go at a time when the quiet is long enough. Time is real seconds. */
export class Pacer {
  private queue: { cue: LineCue; at: number }[] = [];
  private freeAt = -Infinity;

  /** The planner wants this line spoken, as of `now`. */
  want(cue: LineCue, now: number): void { this.queue.push({ cue, at: now }); }

  /** The cue to speak now, if any: nothing while speaking or too soon after the last line; stale cues are dropped. */
  next(now: number, speaking: boolean): LineCue | null {
    this.queue = this.queue.filter((q) => now - q.at <= STALE_S);
    if (speaking) return null;
    const i = this.queue.findIndex((q) => now >= this.freeAt + (HUNT.includes(q.cue.beat) ? HUNT_GAP_S : GAP_S));
    return i < 0 ? null : this.queue.splice(i, 1)[0].cue;
  }

  /** A line has been spoken from `now` and lasts `seconds`. */
  spoke(now: number, seconds: number): void { this.freeAt = now + seconds; }
}
