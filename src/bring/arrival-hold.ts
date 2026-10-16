/** The camera's hold on an arrival (spec §3.4, Rulings R6 and R17; arrival v2): glide, push-in, follow. */
import { HOLD_CAP } from './release';

/**
 * `glide`: the camera flies to the wide framing (and waits there while the family compiles); `push`: it pushes in while
 * the family walks into the picture; `follow`: it follows the lead as the family walks on into the valley.
 */
export type Phase = 'glide' | 'push' | 'follow';
/** Seconds the push-in takes; the follow starts once it is over and the lead walks on, or after PUSH_MAX s whatever. */
export const PUSH = 7, PUSH_MAX = 12;
/** Seconds the camera follows the lead. */
export const FOLLOW = 11;

type Hold = { id: string; phase: Phase; t: number; total: number; since: number; seen: boolean; looked: boolean };
/** What the hold asks of the valley each frame: is one of family `id` in the picture, and is its lead walking on? */
export type ArrivalLook = { inView(id: string): boolean; onward(id: string): boolean };

/**
 * The whole arrival sequence for family `id`, from the glide's start: it lasts at most HOLD_CAP s, and the player's
 * stick or mouse ends it at once, from any phase. Pure logic, stepped by the valley's frame.
 */
export class ArrivalHold {
  private h: Hold | null = null;
  private waiting: (() => void)[] = [];

  constructor(private readonly opts: { cap?: number; onSeen?(since: number, id: string): void } = {}) {}

  /** The glide to family `id`'s wide framing starts (ending any other hold). */
  begin(id: string): void {
    this.end();
    this.h = { id, phase: 'glide', t: 0, total: 0, since: 0, seen: false, looked: false };
  }

  /**
   * Family `id` is in the valley and the glide is over (`since` s ago): the push-in starts. False (and nothing starts)
   * unless this family's glide is the one on: the player took the camera meanwhile, or another glide replaced it.
   */
  start(id: string, since = 0): boolean {
    const h = this.h;
    if (!h || h.id !== id || h.phase !== 'glide') return false;
    Object.assign(h, { phase: 'push', t: 0, since });
    return true;
  }

  get active(): boolean {
    return this.h !== null;
  }

  /** The phase now (null when no arrival is on), the seconds into it, and whose arrival it is. */
  get phase(): Phase | null {
    return this.h?.phase ?? null;
  }

  get time(): number {
    return this.h?.t ?? 0;
  }

  get id(): string | null {
    return this.h?.id ?? null;
  }

  /**
   * One frame of `dt` s: the phase the camera is in, or null once the arrival is over. `look.inView(id)` reads the
   * residents' update bands, which are known only from the frame after the push starts; `moved` is the player taking
   * the camera.
   */
  frame(dt: number, look: ArrivalLook, moved: boolean): Phase | null {
    const h = this.h;
    if (!h) return null;
    h.total += dt;
    if (moved || h.total >= (this.opts.cap ?? HOLD_CAP) - 1e-9) return this.end(); // (frame times add up inexactly)
    if (h.phase === 'glide') return h.phase;
    h.t += dt;
    h.since += dt;
    if (!h.seen && h.looked && look.inView(h.id)) {
      h.seen = true;
      this.opts.onSeen?.(h.since, h.id);
    }
    h.looked = true;
    if (h.phase === 'push' && ((h.t >= PUSH - 1e-9 && look.onward(h.id)) || h.t >= PUSH_MAX - 1e-9)) Object.assign(h, { phase: 'follow', t: 0 });
    else if (h.phase === 'follow' && h.t >= FOLLOW - 1e-9) return this.end();
    return h.phase;
  }

  /** Stop (another glide, a jump, the player), and let whoever waits go on. Returns null (no phase). */
  end(): null {
    this.h = null;
    const w = this.waiting;
    this.waiting = [];
    w.forEach((go) => go());
    return null;
  }

  /** Resolves once no arrival is on (at once if there is none). */
  idle(): Promise<void> {
    return this.h ? new Promise((go) => this.waiting.push(go)) : Promise.resolve();
  }
}
