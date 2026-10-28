import type { Agent, SimState } from './types';

/** At most this many catches in the whole valley in a valley day. */
export const CATCHES_PER_DAY = 3;

/**
 * The valley-wide limit on hunts, kept in the simulation's state (`state` is changed in place): one chase at a time in
 * the whole valley, a few catches a valley day, and no predator catching twice in a day. A day is a whole valley day
 * (`Math.floor(hours / 24)`); the day's count starts again the first time a new day is asked about.
 */
export class Governor {
  constructor(private state: SimState['governor']) {}

  /** The hunter whose chase is under way, if any. */
  get chase(): string | null {
    return this.state.chase;
  }

  /**
   * Whether `hunter` may start a chase: no other chase under way. Once the day's catches are used up, chases still happen
   * but end in escapes (`mayCatch` holds the ceiling).
   */
  mayChase(hunter: Agent, day: number): boolean {
    this.today(day);
    return this.state.chase === null || this.state.chase === hunter.id;
  }

  /** `hunter`'s chase is under way. */
  startChase(hunter: Agent): void {
    this.state.chase = hunter.id;
  }

  /** `hunter`'s chase is over (another may start). */
  endChase(hunter: Agent): void {
    if (this.state.chase === hunter.id) this.state.chase = null;
  }

  /** Whether `hunter` may catch its prey: the day's catches not used up, and it has not already caught today. */
  mayCatch(hunter: Agent, day: number): boolean {
    this.today(day);
    return this.state.catches < CATCHES_PER_DAY && hunter.fedDay !== day;
  }

  /** `hunter` has caught its prey today. */
  caught(hunter: Agent, day: number): void {
    this.today(day);
    this.state.catches++;
    hunter.fedDay = day;
  }

  /** A new day: the catches count from nothing again. */
  private today(day: number) {
    if (day === this.state.day) return;
    this.state.day = day;
    this.state.catches = 0;
  }
}
