/**
 * What the views put on the screen (DOM over the canvas, in `#ui`, in the captions' style): the name tag over the
 * highlighted animal in free flight with its `A Follow` hint, and while watching an animal the small card at the bottom
 * left (its name and what it is doing, the view, the sense) with the button hints, which fade 5 s after locking on or a press,
 * and the line that explains a sense the first time it is switched on. With Fear on, a soft red arc at the screen's edge
 * shows which way the danger is when it is out of view; with Hearing on, a pale blue one which way a sound is. Taking
 * the reins, the tag says whose they are ("You're the fox!") and the hints show the reins' buttons.
 */
import { h } from '../shared/dom';
import type { Doing } from '../sim/types';
import { SENSE_LABEL } from './senses';
import type { SenseName } from './types';
import type { Mode, ViewName } from './views';

/** What an animal is doing, in a few words for the card ("Deer · grazing"). */
export const DOING: Record<Doing, string> = {
  rest: 'resting', sleep: 'asleep', graze: 'grazing', forage: 'foraging', drink: 'drinking', walk: 'walking', watch: 'watching',
  call: 'calling', search: 'searching', stalk: 'stalking', chase: 'chasing', dive: 'diving', eat: 'eating', flee: 'running away',
  freeze: 'keeping still', hide: 'hiding', returning: 'going back to the earth', arrive: 'arriving', leave: 'off exploring',
};
/** The views' names on the card. */
const VIEWS: Record<ViewName, string> = { follow: 'Follow', close: 'Close', eyes: 'Eyes' };

/** The card's two lines: "Deer · grazing", and the view with the sense on ("Close · Smell"). */
export function cardLines(name: string, doing: Doing, view: ViewName, sense: SenseName | null): [string, string] {
  return [`${name} · ${DOING[doing]}`, sense ? `${VIEWS[view]} · ${SENSE_LABEL[sense]}` : VIEWS[view]];
}

/** The tag's hint for locking on: the controller's A, or the keyboard's Enter. */
export const followHint = (keys: boolean) => (keys ? 'Enter Follow' : 'A Follow');

/**
 * The button hints while watching an animal (`mode` locked or gliding there, or with the reins), for the controller or the
 * keyboard; with the reins, their buttons (spec section 7), flying up and down only for an animal that `flies`.
 */
export function hintsFor(mode: Mode, keys: boolean, flies = false): string {
  const [view, sense, take, back] = keys ? ['V', 'X', 'R', 'Backspace'] : ['Y', 'X', 'A', 'B'];
  if (mode !== 'reins') return `${view} View · ${sense} Sense · ${take} Take the reins · ${back} Let go`;
  const [go, run, act, fly] = keys ? ['WASD', 'Shift', 'Enter', 'E / Q'] : ['Left stick', 'RB', 'A', 'RT / LT'];
  return `${go} Go · ${run} Run · ${act} Do · ${flies ? `${fly} Fly up / down · ` : ''}${view} View · ${sense} Sense · ${back} Let go of the reins`;
}

/** What the tag says on taking the reins: "You're the fox!" (a native by its species), "You're Bramble!" (a released creature by its name). */
export const youAre = (name: string, native: boolean) => `You're ${native ? `the ${name.toLowerCase()}` : name}!`;

/** What the time keys say while the player steers (the clock holds at Normal). */
export const REINS_CLOCK_NOTE = 'The valley runs at normal speed while you steer';

/** The views' screen furniture, made once in `ui`. Each call changes the page only when what it shows changes. */
export type ViewsHud = {
  /** The tag at (`x`, `y`) px on the screen (the point above the animal), or hidden (null). */
  tag(at: { x: number; y: number } | null, name: string, hint: string): void;
  /** The card's lines, or hidden (null). */
  card(lines: [string, string] | null): void;
  /** The hints shown (a text) or faded out (null). */
  hints(text: string | null): void;
  /** The line explaining the sense just switched on (a text), or faded out (null). */
  senseLine(text: string | null): void;
  /** The soft arc at the screen's left or right edge, the way an out-of-view danger (red) or sound (pale blue) is, or none (null). */
  edgeArc(side: 'left' | 'right' | null, tone?: 'danger' | 'sound'): void;
};

export function viewsHud(ui: HTMLElement): ViewsHud {
  const tagName = h('span', { class: 'view-tag-name' }), tagHint = h('span', { class: 'view-tag-hint' });
  const tag = h('div', { class: 'view-tag', 'aria-hidden': 'true' }, tagName, tagHint);
  const line1 = h('span', { class: 'view-card-what' }), line2 = h('span', { class: 'view-card-view' });
  const hints = h('div', { class: 'view-hints' }), line = h('div', { class: 'view-sense-line' });
  const card = h('div', { class: 'view-card', role: 'status' }, line1, line2, line, hints);
  const arcs = { left: h('div', { class: 'view-arc left', 'aria-hidden': 'true' }), right: h('div', { class: 'view-arc right', 'aria-hidden': 'true' }) };
  ui.append(tag, card, arcs.left, arcs.right);
  const set = (el: HTMLElement, text: string) => void (el.textContent !== text && (el.textContent = text));
  let place = '';
  return {
    tag(at, name, hint) {
      tag.classList.toggle('in', !!at);
      if (!at) return;
      set(tagName, name);
      set(tagHint, hint);
      const p = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
      if (p !== place) tag.style.transform = place = p;
    },
    card(lines) {
      card.classList.toggle('in', !!lines);
      if (!lines) return;
      set(line1, lines[0]);
      set(line2, lines[1]);
    },
    hints(text) {
      hints.classList.toggle('in', !!text);
      if (text) set(hints, text);
    },
    senseLine(text) {
      line.classList.toggle('in', !!text);
      if (text) set(line, text);
    },
    edgeArc(side, tone = 'danger') {
      for (const s of ['left', 'right'] as const) {
        arcs[s].classList.toggle('in', side === s);
        if (side) arcs[s].classList.toggle('sound', tone === 'sound'); // an arc fading out keeps its colour
      }
    },
  };
}
