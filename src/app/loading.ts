import type { GenStage } from '../valley/generate';

/** Friendly words for each generation stage, and about how long each takes (ms, from tools/valley-perf.ts at 2049). */
const STAGES: { stage: GenStage; label: string; ms: number }[] = [
  { stage: 'shape', label: 'Shaping the hills…', ms: 950 },
  { stage: 'erode', label: 'Letting the rain carve gullies…', ms: 150 },
  { stage: 'carve', label: 'Filling the lake…', ms: 300 },
  { stage: 'biomes', label: 'Painting the meadows…', ms: 520 },
  { stage: 'scatter', label: 'Planting the forest…', ms: 420 },
  { stage: 'plants', label: 'Growing the trees…', ms: 300 },
];
const TOTAL = STAGES.reduce((s, x) => s + x.ms, 0);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

/**
 * The full-screen loading screen: a big progress bar, the current stage in friendly words, and all six stages
 * ticking off. `fail` turns it into a friendly error with "Try again" and "Creature Lab" buttons. Generation only reports the start and end of each stage, so the bar glides through a stage over
 * about the time it usually takes.
 */
export function openLoading(root: HTMLElement): {
  step(stage: GenStage, frac: number): void; say(text: string): void; close(): void; fail(message: string): void;
} {
  const screen = el('div', 'loading');
  const title = el('h1', 'loading-title', 'Making your valley');
  const bar = el('div', 'loading-bar'), fill = el('div', 'loading-fill');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Making your valley');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.append(fill);
  const label = el('p', 'loading-label', 'Getting ready…');
  label.setAttribute('aria-live', 'polite');
  const list = el('ol', 'loading-stages');
  const items = STAGES.map((s) => list.appendChild(el('li', '', s.label.replace('…', ''))));
  screen.append(title, bar, label, list);
  root.append(screen);

  const setFill = (frac: number, ms: number) => {
    fill.style.transition = `width ${ms}ms ${ms > 400 ? 'cubic-bezier(.2,.6,.4,1)' : 'ease-out'}`;
    fill.style.width = `${(frac * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  };

  let failed = false; // late progress from the worker must not overwrite the failure message
  return {
    step(stage, frac) {
      const i = STAGES.findIndex((s) => s.stage === stage);
      if (i < 0 || failed) return;
      const before = STAGES.slice(0, i).reduce((s, x) => s + x.ms, 0) / TOTAL, w = STAGES[i].ms / TOTAL;
      items.forEach((li, k) => {
        li.classList.toggle('done', k < i || (k === i && frac >= 1));
        li.classList.toggle('now', k === i && frac < 1);
      });
      if (frac < 1) {
        label.textContent = STAGES[i].label;
        setFill(before, 150);
        requestAnimationFrame(() => setFill(before + w * 0.9, STAGES[i].ms * 1.3)); // glide while the worker works
      } else setFill(before + w, 150);
    },
    /** Show `text` as the current step (after generation, while the last pieces load). */
    say(text) {
      if (!failed) label.textContent = text;
    },
    close() {
      setFill(1, 150);
      screen.classList.add('closing');
      setTimeout(() => screen.remove(), 450);
    },
    fail(message) {
      failed = true;
      screen.classList.add('failed');
      title.textContent = 'Oh no!';
      label.textContent = message;
      const again = el('button', 'loading-button', 'Try again');
      again.type = 'button';
      again.addEventListener('click', () => location.reload());
      const lab = el('a', 'loading-button', 'Creature Lab');
      lab.href = '/lab.html';
      const buttons = el('div', 'loading-buttons');
      buttons.append(again, lab);
      screen.append(buttons);
      again.focus();
    },
  };
}

/** A small note that floats in at the top for a moment ("Welcome back!"). */
export function toast(root: HTMLElement, text: string, ms = 2200) {
  const t = el('div', 'toast', text);
  t.setAttribute('role', 'status');
  root.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
}
