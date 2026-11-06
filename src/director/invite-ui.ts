/**
 * The invitation card on the screen: a frame round the peek's picture (which the post pipeline draws into the canvas
 * underneath, at the same place), the moment's line under it, then the hint ("X Go there" or "F Go there"). It fades in
 * and out (valley.css's `.invite`); the words stay while it fades out.
 */
import type { PeekRect } from '../render/peek';
import { h } from '../shared/dom';
import type { Story } from './types';

/** The card's frame round the picture (CSS px): valley.css's `.invite-pic` border. */
const FRAME_PX = 5;

/** The card, added to `ui` (see the file's note). */
export function inviteCard(ui: HTMLElement): { show(s: Story | null, line: string, hint: string, rect: PeekRect): void } {
  const pic = h('div', { class: 'invite-pic' }), text = h('span', { class: 'invite-line' }), hint = h('span', { class: 'invite-hint' });
  const el = h('div', { class: 'invite', role: 'status' }, pic, h('div', { class: 'invite-text' }, text, hint));
  ui.append(el);
  let place = '';
  return {
    /** Show the card for `s` with `line` and `hint`, framing the picture at `rect`; null lets it fade out. */
    show(s, line, hintText, rect) {
      if (s) {
        if (text.textContent !== line) text.textContent = line;
        if (hint.textContent !== hintText) hint.textContent = hintText;
        const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (key !== place) {
          place = key;
          Object.assign(el.style, { left: `${rect.x - FRAME_PX}px`, top: `${rect.y - FRAME_PX}px`, width: `${rect.w + 2 * FRAME_PX}px` });
          pic.style.height = `${rect.h}px`;
        }
      }
      el.classList.toggle('in', !!s);
    },
  };
}
