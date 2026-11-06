import { captionLift } from '../app/captions';
import { h } from '../shared/dom';

/** How long (seconds) a line stays up when it is not spoken: 3 s and 0.3 s a word. */
export const wordsOnlySeconds = (text: string): number => 3 + 0.3 * text.trim().split(/\s+/).filter(Boolean).length;

/** The narrator's subtitle: the caption's place and look, fading in and out, lifted above the join card when it shows. */
export function subtitleView(ui: HTMLElement): { show(text: string | null): void } {
  const text = h('span', { class: 'caption-text' });
  const el = h('div', { class: 'caption subtitle', role: 'status' }, text);
  ui.append(el);
  let lift = '';
  return {
    /** Show `t`, or let the last one fade out (its words stay while it does). */
    show(t) {
      if (t !== null) {
        if (text.textContent !== t) text.textContent = t;
        const px = `${captionLift(ui.querySelector<HTMLElement>('.join-card'))}px`;
        if (px !== lift) el.style.setProperty('--caption-lift', (lift = px));
      }
      el.classList.toggle('in', t !== null);
    },
  };
}
