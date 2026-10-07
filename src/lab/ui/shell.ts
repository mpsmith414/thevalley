import type { KidCards } from '../../designer/types';
import type { Action } from '../../motion/actions';
import { clear, h } from './dom';

export const ACTION_BUTTONS: { action: Action; label: string; icon: string }[] = [
  { action: 'wander', label: 'Wander', icon: '🌿' },
  { action: 'walk', label: 'Walk', icon: '🚶' },
  { action: 'run', label: 'Run', icon: '🏃' },
  { action: 'eat', label: 'Eat', icon: '🌱' },
  { action: 'drink', label: 'Drink', icon: '💧' },
  { action: 'sleep', label: 'Sleep', icon: '😴' },
  { action: 'call', label: 'Call', icon: '📣' },
];

export type ShellHandlers = {
  act(a: Action): void;
  newCreature(): void;
  gallery(): void;
  change(): void;
};

/** The always-there parts of the lab: title, cards strip, action bar, message toast, and a layer for panels. */
export function createShell(root: HTMLElement, on: ShellHandlers) {
  const toastEl = h('div', { class: 'toast', role: 'status' });
  const cardsEl = h('div', { class: 'cards' });
  const actionButtons = ACTION_BUTTONS.map((b) =>
    h('button', { class: 'act', 'data-focus': true, 'data-action': b.action, onclick: () => on.act(b.action) }, h('span', { class: 'icon' }, b.icon), b.label),
  );
  const bar = h('nav', { class: 'bar' },
    h('div', { class: 'acts' }, ...actionButtons),
    h('div', { class: 'tools' },
      h('button', { class: 'tool primary', 'data-focus': true, onclick: on.newCreature }, h('span', { class: 'icon' }, '✨'), 'New creature'),
      h('button', { class: 'tool', 'data-focus': true, onclick: on.change }, h('span', { class: 'icon' }, '✏️'), 'Change it'),
      h('button', { class: 'tool', 'data-focus': true, onclick: on.gallery }, h('span', { class: 'icon' }, '🖼️'), 'Gallery'),
    ),
  );
  const layer = h('div', { class: 'layers' });
  root.append(h('div', { class: 'title' }, 'Creature Lab'), toastEl, h('div', { class: 'bottom' }, cardsEl, bar), layer);

  let toastTimer = 0;
  return {
    bar,
    layer,
    /** Show a friendly message for a few seconds. */
    toast(text: string, ms = 4500) {
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
    },
    setCards(cards: KidCards) {
      clear(cardsEl).append(
        h('div', { class: 'name' }, cards.name),
        ...([['Eats', cards.eats], ['Speed', cards.speed], ['Mood', cards.mood], ['Special', cards.special]] as const).map(([k, v]) =>
          h('div', { class: 'card' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)),
        ),
      );
    },
    setAction(a: Action) {
      actionButtons.forEach((b) => b.classList.toggle('on', b.dataset.action === a));
    },
  };
}

export type Shell = ReturnType<typeof createShell>;

/** A centred panel on the layer; close() removes it. The topmost open panel takes the controller. */
export function openPanel(layer: HTMLElement, title: string, ...content: (Node | string)[]) {
  const closeBtn = h('button', { class: 'close', 'data-focus': true, 'aria-label': 'Close' }, '✕');
  const panel = h('section', { class: 'panel', role: 'dialog', 'aria-label': title }, h('header', {}, h('h2', {}, title), closeBtn), h('div', { class: 'body' }, ...content));
  const scrim = h('div', { class: 'scrim' }, panel);
  layer.append(scrim);
  const close = () => scrim.remove();
  closeBtn.addEventListener('click', close);
  return { panel, body: panel.querySelector<HTMLElement>('.body')!, close, closeBtn };
}
