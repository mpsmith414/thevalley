/** The menu's Creatures page (spec §3.6): every released and off-exploring creature, with Visit, Off exploring and Come back. */
import type { GalleryItem } from '../lab/gallery';
import { h } from '../shared/dom';
import { TRY_AGAIN } from './workshop';

export const NO_CREATURES = 'No creatures yet — scan the code to add one!';
/** Visit found none of the family in the valley (its body would not build when the valley opened, say). */
export const NOT_FOUND = "Hmm, they're hiding just now!";
/** A creature made without a phone (in the lab) wears this badge. */
const LAB_BADGE = '🧪';

export type CreatureAction = 'visit' | 'explore' | 'back';
export type CreatureRow = {
  id: string; name: string; badge: string; maker: string; status: 'released' | 'exploring';
  buttons: { id: CreatureAction; label: string }[];
};

/** The page's rows, newest first: badge, name and maker, with Visit and Off exploring (released) or Come back (exploring). */
export function creatureRows(items: GalleryItem[]): CreatureRow[] {
  return items
    .filter((i) => i.valley && !i.native)
    .sort((a, b) => b.valley!.releasedAt - a.valley!.releasedAt)
    .map((i) => {
      const status = i.valley!.status;
      return {
        id: i.id, name: i.cards.name || i.recipe.name, badge: i.maker?.badge || LAB_BADGE,
        maker: i.maker ? `by ${i.maker.name || 'a friend'}` : 'from the Creature Lab', status,
        buttons: status === 'released' ? [{ id: 'visit', label: 'Visit' }, { id: 'explore', label: 'Off exploring' }] : [{ id: 'back', label: 'Come back' }],
      };
    });
}

export type CreaturesDeps = {
  /** The released and exploring creatures (the list's `all`). */
  all(): Promise<GalleryItem[]>;
  /** Glide to the family; false when none of it is in the valley. */
  visit(id: string): boolean;
  explore(id: string): Promise<void>;
  comeBack(id: string): Promise<void>;
  /** Close the menu, to watch. */
  close(): void;
  /** A short line on the TV. */
  say(text: string): void;
};
/** What the menu lends the page: going back to the menu, and the controller's focus ring. */
export type PageNav = { back(): void; focus(el: HTMLElement | null): void };

/**
 * Draw the Creatures page into `page` (each time it opens): a row per creature, its buttons in the focus ring like the
 * menu's own, and Back. Off exploring shows Come back at once (the family takes a while to walk out of view).
 */
export function fillCreatures(page: HTMLElement, deps: CreaturesDeps, nav: PageNav): Promise<void> {
  const pending = new Map<string, CreatureRow['status']>(); // pressed, not yet saved
  const press = (row: CreatureRow, action: CreatureAction) => {
    if (action === 'visit') {
      if (deps.visit(row.id)) deps.close();
      else deps.say(NOT_FOUND);
    } else if (action === 'explore') {
      pending.set(row.id, 'exploring');
      void draw(`${row.id}:back`);
      deps.explore(row.id).catch((e) => console.error('creatures: could not send it exploring', e)).finally(() => {
        pending.delete(row.id);
        void draw(`${row.id}:back`);
      });
    } else {
      deps.close(); // watch it arrive
      deps.comeBack(row.id).catch((e) => {
        console.error('creatures: it could not come back', e);
        deps.say(TRY_AGAIN);
      });
    }
  };
  /** Redraw from the list; the focus goes to `focusKey`'s button (`''`: the first creature's), or stays on the same one. */
  const draw = async (focusKey?: string) => {
    const rows = creatureRows(await deps.all()).map((r) => {
      const status = pending.get(r.id);
      return status && status !== r.status ? { ...r, status, buttons: [{ id: 'back' as const, label: 'Come back' }] } : r;
    });
    const was = focusKey ?? page.querySelector<HTMLElement>('.focused')?.dataset.key;
    const back = h('button', { class: 'menu-btn menu-back', type: 'button', 'data-focus': true, 'data-key': 'back', onclick: () => nav.back() }, 'Back');
    page.replaceChildren(
      h('h2', { class: 'menu-heading' }, 'Creatures'),
      rows.length
        ? h('ul', { class: 'menu-creatures-list' }, ...rows.map((r) => h('li', { class: `menu-creature ${r.status}` },
          h('span', { class: 'menu-creature-badge', 'aria-hidden': 'true' }, r.badge),
          h('span', { class: 'menu-creature-who' }, h('b', {}, r.name), h('small', {}, r.status === 'exploring' ? `${r.maker} · off exploring` : r.maker)),
          h('span', { class: 'menu-items' }, ...r.buttons.map((b) => h('button', {
            class: 'menu-btn', type: 'button', 'data-focus': true, 'data-key': `${r.id}:${b.id}`, 'aria-label': `${b.label}: ${r.name}`,
            onclick: () => press(r, b.id),
          }, b.label))))))
        : h('p', { class: 'menu-empty' }, NO_CREATURES),
      back);
    if (page.hidden || !page.isConnected) return; // closed meanwhile: the menu's own page has the ring
    const keep = was ? page.querySelector<HTMLElement>(`[data-key="${CSS.escape(was)}"]`) : null;
    nav.focus(keep ?? page.querySelector<HTMLElement>('.menu-creature [data-focus]') ?? back);
  };
  return draw('').catch((e) => console.error('creatures: the list could not be read', e));
}
