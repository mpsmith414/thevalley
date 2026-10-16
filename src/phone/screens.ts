import { BADGES, type Maker, type StepMsg } from '../bring/protocol';
import { h } from '../shared/dom';
import type { PhoneState } from './state';

/** One screen per `Screen`, in the spec §2's words. Pure DOM builders: `main.ts` owns the state and the relay. */

export type View = {
  state: PhoneState;
  /** The picked photo or drawing as a data URL, for the thumbnail. */
  thumb: string | null;
  /** The join screen asks for the TV's code only when the address did not bring one. */
  needCode: boolean;
  /** A short friendly line under the main button ("Hmm, I can't open that picture. Try another!"). */
  hint?: string;
  /** A request is on its way: the main button waits. */
  busy?: boolean;
  /** A tweak was sent and the TV is changing the creature. */
  tweaking?: boolean;
};

export type Handlers = {
  join(name: string, badge: string, code: string): void;
  photo(file: File): void;
  draw(): void;
  dropPicture(): void;
  words(text: string): void;
  bring(): void;
  leaveLine(): void;
  tweak(words: string): void;
  release(): void;
  startAgain(): void;
  again(): void;
};

export const CHIPS = ['Bigger!', 'Fluffier!', 'More colourful!'] as const;
const WORDS_MAX = 500;
const NAME_MAX = 12;

const hero = (emoji: string) => h('div', { class: 'hero', 'aria-hidden': 'true' }, emoji);
const title = (text: string) => h('h1', {}, text);
const hintLine = (v: View) => (v.hint ? h('p', { class: 'hint', role: 'status' }, v.hint) : null);
const big = (text: string, onclick: () => void, extra = '') => h('button', { class: `big ${extra}`.trim(), onclick }, text);
const who = (m: Maker | null) => (m ? h('div', { class: 'who' }, h('span', { class: 'who-badge' }, m.badge), m.name) : null);
/** A screen: content that scrolls, and an optional bar pinned to the bottom for the one big button. */
const page = (cls: string, body: (Node | null | false)[], bar?: (Node | null | false)[]) =>
  h('main', { class: `screen ${cls}` }, h('div', { class: 'body' }, ...body), bar ? h('div', { class: 'bar' }, ...bar) : null);
/** A screen that is just a picture, a sentence and maybe one button. */
const message = (cls: string, emoji: string, text: string, button?: [string, () => void], sub?: string) =>
  page(`message ${cls}`, [hero(emoji), title(text), sub ? h('p', { class: 'sub' }, sub) : null], button ? [big(button[0], button[1])] : undefined);

function join(v: View, on: Handlers): HTMLElement {
  const m = v.state.maker;
  let badge = m?.badge ?? BADGES[Math.floor(Math.random() * BADGES.length)];
  const name = h('input', { class: 'field', type: 'text', maxlength: NAME_MAX, autocomplete: 'nickname', placeholder: 'Your name', 'aria-label': "What's your name?", value: m?.name ?? '' });
  const code = v.needCode
    ? h('input', { class: 'field code', type: 'text', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: '????', 'aria-label': 'The code on the TV' })
    : null;
  const badges = BADGES.map((b) => h('button', {
    class: `badge${b === badge ? ' on' : ''}`, 'aria-label': `Badge ${b}`, 'aria-pressed': String(b === badge),
    onclick: (e) => {
      badge = b;
      for (const el of grid.children) { el.classList.toggle('on', el === e.currentTarget); el.setAttribute('aria-pressed', String(el === e.currentTarget)); }
    },
  }, b));
  const grid = h('div', { class: 'badges' }, ...badges);
  const go = big(v.busy ? 'Joining…' : "Let's go!", () => on.join(name.value.trim(), badge, code?.value ?? ''));
  go.disabled = !!v.busy;
  return page('join', [
    hero('🌿'),
    h('label', { class: 'label' }, "What's your name?", name),
    h('div', { class: 'label' }, 'Pick your animal'),
    grid,
    code && h('label', { class: 'label' }, 'The code on the TV', code),
  ], [hintLine(v), go]);
}

function make(v: View, on: Handlers): HTMLElement {
  const { draft } = v.state;
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file' });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) on.photo(f); file.value = ''; });
  const words = h('textarea', { class: 'field words', maxlength: WORDS_MAX, rows: 3, placeholder: 'Tap 🎤 on your keyboard to talk', 'aria-label': 'Tell me about it' });
  words.value = draft.words;
  const go = big(v.busy ? 'Sending…' : '✨ Bring it to life!', on.bring, 'go');
  const can = () => !v.busy && (draft.hasImage || words.value.trim().length > 0);
  go.disabled = !can();
  // typing does not rebuild the screen (that would drop the keyboard); only the button follows it
  words.addEventListener('input', () => { on.words(words.value); go.disabled = !can(); });

  const picture = v.thumb
    ? h('div', { class: 'picked' },
      h('img', { class: 'thumb', src: v.thumb, alt: 'Your picture' }),
      h('button', { class: 'small', onclick: on.dropPicture }, 'Use a different one'))
    : h('div', { class: 'choices' },
      h('button', { class: 'choice', onclick: () => file.click() }, h('span', { class: 'emoji' }, '📷'), 'Photo of a drawing'),
      h('button', { class: 'choice', onclick: on.draw }, h('span', { class: 'emoji' }, '✏️'), 'Draw'));
  return page('make', [
    who(v.state.maker),
    title('Make a creature!'),
    picture,
    file,
    h('label', { class: 'label' }, h('span', {}, '💬 Tell me about it'), words),
  ], [hintLine(v), go]);
}

function waiting(v: View, on: Handlers): HTMLElement {
  const { place, ahead, maker } = v.state;
  // the relay's `place` 1 is next; `ahead` counts the one on the TV too, so it equals place
  const text = place === undefined ? 'Getting in line…' : place <= 1 ? "You're next!" : `${place} creatures ahead`;
  const line = h('div', { class: 'line', 'aria-label': 'The line' },
    ...(ahead ?? []).map((m) => h('span', { class: 'in-line', title: m.name }, m.badge)),
    maker ? h('span', { class: 'in-line me', title: maker.name }, maker.badge) : null);
  return page('message waiting', [
    hero('⏳'), title(text), line, h('p', { class: 'sub' }, 'Watch the TV while you wait!'),
  ], [hintLine(v), h('button', { class: 'small', onclick: on.leaveLine }, 'Leave the line')]);
}

const STEPS = [['reading', 'Reading the drawing'], ['building', 'Building'], ['looking', 'Looking again'], ['fixing', 'Fixing']] as const;

function making(v: View): HTMLElement {
  const step: StepMsg | undefined = v.state.step;
  const at = step ? STEPS.findIndex(([k]) => k === step.kind) : -1;
  const pass = step && 'pass' in step ? step.pass : 0;
  const items = STEPS.map(([kind, label], i) => {
    const state = i < at ? 'done' : i === at ? 'now' : 'todo';
    const text = (kind === 'looking' || kind === 'fixing') && pass && i <= at ? `${label} (pass ${pass})` : label;
    return h('li', { class: state },
      h('span', { class: 'tick', 'aria-hidden': 'true' }, state === 'done' ? '✓' : ''),
      h('span', {}, text));
  });
  const note = step?.kind === 'fixing' && step.note ? h('p', { class: 'note' }, `“${step.note}”`) : null;
  return page('message making', [hero('📺'), title('Look at the TV! 👀'), h('ol', { class: 'steps' }, ...items), note]);
}

function preview(v: View, on: Handlers): HTMLElement {
  const { cards, tweaksLeft = 0, note } = v.state;
  const card = (label: string, value: string) => h('div', { class: 'card' }, h('div', { class: 'card-label' }, label), h('div', { class: 'card-value' }, value));
  const box = h('input', { class: 'field', type: 'text', maxlength: WORDS_MAX, placeholder: 'make it fluffier', 'aria-label': 'Change something' });
  const send = (w: string) => { if (w.trim()) on.tweak(w.trim()); };
  const left = tweaksLeft === 1 ? '1 tweak left' : `${tweaksLeft} tweaks left`;

  const tweak = v.tweaking
    ? h('div', { class: 'tweak changing' }, h('span', { class: 'emoji' }, '✨'), 'Changing it… look at the TV! 👀')
    : tweaksLeft > 0
      ? h('div', { class: 'tweak' },
        h('div', { class: 'label' }, 'Change something?'),
        h('div', { class: 'chips' }, ...CHIPS.map((c) => h('button', { class: 'chip', onclick: () => send(c) }, c))),
        h('form', { class: 'tweak-row', onsubmit: (e) => { e.preventDefault(); send(box.value); } },
          box, h('button', { class: 'send', type: 'submit', 'aria-label': 'Send' }, '✨')),
        h('div', { class: 'left' }, left))
      : h('div', { class: 'tweak' }, h('div', { class: 'left' }, left));

  // Start again asks first, in a sheet over the whole screen (so a tap meant for "No" cannot land on Release)
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Are you sure?' },
    h('div', { class: 'sheet-card' },
      h('div', { class: 'hero', 'aria-hidden': 'true' }, '🤔'),
      h('h2', {}, 'Are you sure?'),
      big('Yes, start again', on.startAgain, 'danger'),
      big('No, keep it', () => sheet.remove(), 'keep')));
  const again = h('div', { class: 'again' }, h('button', { class: 'small', onclick: () => el.append(sheet) }, 'Start again'));

  const release = big(v.busy ? 'Sending…' : '🌿 Release into the valley!', on.release, 'release');
  release.disabled = !!(v.busy || v.tweaking);
  const el = page('preview', [
    title(cards?.name ?? 'Your creature'),
    note ? h('p', { class: 'note bubble' }, note) : null,
    cards ? h('div', { class: 'cards' }, card('Eats', cards.eats), card('Speed', cards.speed), card('Mood', cards.mood), card('Special', cards.special)) : null,
    tweak,
    again,
  ], [hintLine(v), release]);
  return el;
}

/** What the phone keeps for tomorrow when the valley is resting. */
const kept = (s: PhoneState) =>
  s.draft.hasImage ? 'Your picture is saved on this phone.' : s.draft.words.trim() ? 'Your words are saved on this phone.' : undefined;

/** The screen for the current state. */
export function screen(v: View, on: Handlers): HTMLElement {
  const s = v.state;
  switch (s.screen) {
    case 'join': return join(v, on);
    case 'make': return make(v, on);
    case 'waiting': return waiting(v, on);
    case 'making': return making(v);
    case 'preview': return preview(v, on);
    case 'released': return message('released', '🌈', 'Off it goes! Watch the TV 🎉', ['Make another', on.again]);
    case 'kept': return message('kept', '🏠', 'Your creature is safe in the lab 💾. Make another?', ['Make another', on.again]);
    case 'resting': return message('resting', '😴', 'The valley is resting. Come back tomorrow! 🌙', ['OK', on.again], kept(s));
    case 'failed': return message('failed', '🤔', s.message || "Hmm, let's try that one again!", ['Try again', on.again]);
    case 'noHost': return message('no-host', '📺', 'Open the valley on the TV first', undefined, 'This screen wakes up by itself.');
    case 'rescan': return rescan(v, on);
  }
}

function rescan(v: View, on: Handlers): HTMLElement {
  const code = h('input', { class: 'field code', type: 'text', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: '????', 'aria-label': 'The code on the TV' });
  const m = v.state.maker;
  const go = big(v.busy ? 'Joining…' : "Let's go!", () => on.join(m?.name ?? '', m?.badge ?? BADGES[0], code.value), 'quiet');
  go.disabled = !!v.busy;
  return page('message rescan', [
    hero('📱'), title('Scan the TV again 📺'),
    h('label', { class: 'label' }, 'Or type the code on the TV', code),
  ], [hintLine(v), go]);
}
