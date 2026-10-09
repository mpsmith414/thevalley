import type { GalleryItem } from '../gallery';
import { clear, h } from '../../shared/dom';

export type WorkshopInfo = {
  item: GalleryItem | null;
  backend: string;
  tier: string;
  fps: number;
  buildMs: number;
  model: string | null;
  passes: number;
  lod: number;
  fur: boolean;
  skeleton: boolean;
};

export type WorkshopHandlers = {
  setLod(l: 0 | 1 | 2): void;
  setFur(on: boolean): void;
  setSkeleton(on: boolean): void;
  setTier(t: 'low' | 'medium' | 'high'): void;
  setPasses(n: number): void;
};

/** The hidden grown-up drawer: skeleton, raw recipe, detail levels, quality, look-again history. */
export function createWorkshop(root: HTMLElement, on: WorkshopHandlers) {
  const el = h('aside', { class: 'workshop', hidden: true });
  root.append(el);
  const choice = <T extends string | number>(label: string, opts: T[], cur: T, pick: (v: T) => void) =>
    h('div', { class: 'opt' }, h('span', {}, label), ...opts.map((o) => h('button', { 'data-focus': true, class: o === cur ? 'on' : '', onclick: () => pick(o) }, String(o))));

  function render(i: WorkshopInfo) {
    const recipe = i.item ? JSON.stringify(i.item.recipe, null, 1) : '';
    clear(el).append(...([
      h('h3', {}, '🔧 Workshop'),
      h('dl', {},
        h('dt', {}, 'Renderer'), h('dd', {}, `${i.backend} · ${i.tier}`),
        h('dt', {}, 'Frame rate'), h('dd', {}, `${Math.round(i.fps)} fps`),
        h('dt', {}, 'Body build'), h('dd', {}, `${Math.round(i.buildMs)} ms`),
        h('dt', {}, 'Designer'), h('dd', {}, i.model ?? 'offline'),
      ),
      choice('Detail', [0, 1, 2] as (0 | 1 | 2)[], i.lod as 0 | 1 | 2, on.setLod),
      choice('Fur', ['on', 'off'], i.fur ? 'on' : 'off', (v) => on.setFur(v === 'on')),
      choice('Skeleton', ['on', 'off'], i.skeleton ? 'on' : 'off', (v) => on.setSkeleton(v === 'on')),
      choice('Quality', ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[], i.tier as 'low' | 'medium' | 'high', on.setTier),
      choice('Look-again passes', [1, 2, 3, 4, 5], i.passes, on.setPasses),
      i.item?.history.length
        ? h('div', { class: 'hist' }, h('h4', {}, 'Look-again history'), ...i.item.history.map((p) => h('div', {}, `${p.pass}. ${p.verdict === 'matches' ? '✓' : `${p.edits} edits`} — ${p.note}`)))
        : null,
      h('div', { class: 'recipe' },
        h('h4', {}, 'Recipe ', h('button', { 'data-focus': true, onclick: () => void navigator.clipboard?.writeText(recipe) }, 'Copy')),
        h('pre', {}, recipe),
      ),
    ].filter((x): x is NonNullable<typeof x> => x !== null)));
  }

  return {
    el,
    get open() {
      return !el.hidden;
    },
    toggle(i: WorkshopInfo) {
      el.hidden = !el.hidden;
      if (!el.hidden) render(i);
    },
    refresh(i: WorkshopInfo) {
      if (el.hidden) return;
      // keep live numbers fresh without rebuilding the whole drawer
      const dd = el.querySelectorAll('dd');
      if (dd.length >= 3) {
        dd[1].textContent = `${Math.round(i.fps)} fps`;
        dd[2].textContent = `${Math.round(i.buildMs)} ms`;
      }
    },
    render,
  };
}
