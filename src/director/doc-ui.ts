/**
 * The documentary's screen furniture: slim letterbox bars (to about 2:1, so everyone can see it is the documentary), the
 * small "The Valley" title with the time of day as a lower third, the hint that says how to take over, and the dip
 * through black between far-apart scenes.
 */
import { h } from '../shared/dom';

/**
 * What the documentary shows on the screen: the bars, the lower-third title, the hint, and the dip through black (fading
 * in, or black at once when `now`; it always fades out).
 */
export type DocUi = { bars(on: boolean): void; title(text: string | null): void; hint(text: string | null): void; dip(on: boolean, now?: boolean): void };

/** The part of the valley's day an hour falls in, for the title ("Morning in the valley"). */
export function partOfDay(hour: number): string {
  const t = ((hour % 24) + 24) % 24;
  if (t < 4) return 'Night';
  if (t < 7) return 'Dawn';
  if (t < 11) return 'Morning';
  if (t < 14) return 'Midday';
  if (t < 17) return 'Afternoon';
  if (t < 21) return 'Evening';
  return 'Night';
}

/** The documentary's furniture in `ui` (under everything else there, so the subtitles and the join card stay on top). */
export function docUi(ui: HTMLElement): DocUi {
  const top = h('div', { class: 'doc-bar top' }), bottom = h('div', { class: 'doc-bar bottom' });
  const dip = h('div', { class: 'doc-dip' });
  const text = h('span', { class: 'doc-title-text' });
  const title = h('div', { class: 'doc-title' }, h('span', { class: 'doc-title-kicker' }, 'The Valley'), text);
  const hint = h('div', { class: 'doc-hint', role: 'status' });
  ui.prepend(dip, top, bottom, title, hint);
  const fade = (el: HTMLElement, t: string | null, into: HTMLElement = el) => {
    if (t !== null) into.textContent = t;
    el.classList.toggle('in', t !== null);
  };
  return {
    bars: (on) => (top.classList.toggle('in', on), void bottom.classList.toggle('in', on)),
    title: (t) => fade(title, t, text),
    hint: (t) => fade(hint, t),
    // the class that drops the fade is set in the same change as `in`, so the black comes with no transition
    dip: (on, now = false) => (dip.classList.toggle('now', on && now), void dip.classList.toggle('in', on)),
  };
}
