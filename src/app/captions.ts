import { h } from '../shared/dom';
import { HIGH, MEDIUM, type Moment } from '../sim/types';

/** A caption shows this long (real seconds, fading in and out within it), the next waits this long from its start, and a moment waits at most STALE_S. */
export const SHOW_S = 8, GAP_S = 25, STALE_S = 30;
/** At most this many moments wait their turn. */
const QUEUED = 3;

/**
 * Which moment is captioned when: one at a time for `show` seconds, at least `gap` seconds from one's start to the next's,
 * moments waiting longer than `stale` dropped, at most three waiting (the least interesting dropped first). Times are real seconds.
 */
export class CaptionQueue {
  private waiting: { m: Moment; at: number }[] = [];
  private shown: { m: Moment; since: number } | null = null;
  private lastStart = -Infinity;
  private readonly show: number;
  private readonly gap: number;
  private readonly stale: number;
  private readonly min: number;

  constructor(opts: { show?: number; gap?: number; stale?: number; min?: number } = {}) {
    this.show = opts.show ?? SHOW_S;
    this.gap = opts.gap ?? GAP_S;
    this.stale = opts.stale ?? STALE_S;
    this.min = opts.min ?? MEDIUM;
  }

  /** A moment to caption, offered once as it happens: below the minimum interest it is ignored, a high one goes ahead of the rest. */
  offer(m: Moment, nowReal: number): void {
    if (m.interest < this.min) return;
    const item = { m, at: nowReal };
    if (m.interest >= HIGH) {
      const first = this.waiting.findIndex((w) => w.m.interest < HIGH); // after the high ones already waiting
      this.waiting.splice(first < 0 ? this.waiting.length : first, 0, item);
    } else this.waiting.push(item);
    if (this.waiting.length > QUEUED) {
      const least = Math.min(...this.waiting.map((w) => w.m.interest));
      this.waiting.splice(this.waiting.findIndex((w) => w.m.interest === least), 1); // the oldest of the least interesting
    }
  }

  /** The caption to show now (null: none). While `blocked` the shown one is hidden for good and nothing new starts. */
  update(nowReal: number, blocked: boolean): Moment | null {
    this.waiting = this.waiting.filter((w) => nowReal - w.at <= this.stale);
    if (this.shown && (blocked || nowReal - this.shown.since >= this.show)) this.shown = null;
    if (!blocked && !this.shown && this.waiting.length && nowReal - this.lastStart >= this.gap) {
      this.shown = { m: this.waiting.shift()!.m, since: nowReal };
      this.lastStart = nowReal;
    }
    return this.shown?.m ?? null;
  }

  /** The caption showing now. */
  get showing(): Moment | null {
    return this.shown?.m ?? null;
  }
}

/** How far (px) the caption sits above its usual place: the join card's height while the card shows. */
export const captionLift = (card: { hidden: boolean | string; offsetHeight: number } | null): number => (card && !card.hidden ? card.offsetHeight : 0);

/** The caption on the screen: one quiet line at the bottom centre with its hint, fading in and out (CSS), above the join card when it shows. */
export function captionView(ui: HTMLElement): { show(m: Moment | null, hint: string): void } {
  const text = h('span', { class: 'caption-text' }), hint = h('span', { class: 'caption-hint' });
  const el = h('div', { class: 'caption', role: 'status' }, text, hint);
  ui.append(el);
  let id = 0, lift = '';
  return {
    /** Show `m` with `hint` beside it, or let the last one fade out (its words stay while it does). */
    show(m, hintText) {
      if (m) {
        if (m.id !== id) text.textContent = m.text;
        id = m.id;
        if (hint.textContent !== hintText) hint.textContent = hintText;
        const px = `${captionLift(ui.querySelector<HTMLElement>('.join-card'))}px`;
        if (px !== lift) el.style.setProperty('--caption-lift', (lift = px));
      }
      el.classList.toggle('in', !!m);
    },
  };
}
