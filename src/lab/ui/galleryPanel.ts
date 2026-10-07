import { imageUrl } from '../../designer/image';
import type { ImageIn } from '../../designer/types';
import type { Gallery, GalleryItem } from '../gallery';
import { clear, h } from './dom';
import { openPanel } from './shell';

export type GalleryHandlers = {
  pick(item: GalleryItem): void;
  thumb(item: GalleryItem): Promise<ImageIn>;
  toast(text: string): void;
};

/** Every creature, made and native: pick one to show it, delete made ones, back them up. */
export async function openGallery(layer: HTMLElement, gallery: Gallery, on: GalleryHandlers) {
  const grid = h('div', { class: 'grid' });
  const picker = h('input', { type: 'file', accept: 'application/json', hidden: true });
  const tools = h('div', { class: 'row' },
    h('button', { 'data-focus': true, onclick: () => void exportAll() }, '💾 Save a backup'),
    h('button', { 'data-focus': true, onclick: () => picker.click() }, '📂 Load a backup'),
    picker,
  );
  const p = openPanel(layer, 'Gallery', grid, tools);
  p.panel.classList.add('gallery');

  async function exportAll() {
    const blob = await gallery.exportAll();
    const a = h('a', { href: URL.createObjectURL(blob), download: `creatures-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    on.toast('Backup saved to your downloads 💾');
  }
  picker.addEventListener('change', async () => {
    const f = picker.files?.[0];
    if (!f) return;
    try {
      const n = await gallery.importAll(f);
      on.toast(n ? `Welcome back, ${n} creature${n > 1 ? 's' : ''}!` : 'Those creatures are already here.');
      await render();
    } catch {
      on.toast('That file isn’t a creature backup.');
    }
  });

  async function render() {
    const items = await gallery.list();
    clear(grid);
    for (const item of items) {
      const img = h('img', { alt: '' });
      const tile = h('button', { class: 'tile', 'data-focus': true, onclick: () => (p.close(), on.pick(item)) }, img, h('span', { class: 'label' }, item.cards.name));
      const cell = h('div', { class: 'cell' }, tile);
      if (!item.native) {
        cell.append(h('button', { class: 'del', 'data-focus': true, 'aria-label': `Delete ${item.cards.name}`, onclick: () => confirmDelete(item) }, '🗑'));
      }
      grid.append(cell);
      if (item.thumb) img.src = imageUrl(item.thumb);
      else
        void on.thumb(item).then(async (t) => {
          img.src = imageUrl(t);
          await gallery.save({ ...item, thumb: t });
        });
    }
  }

  function confirmDelete(item: GalleryItem) {
    const yes = h('button', { class: 'danger', 'data-focus': true }, 'Yes, delete');
    const no = h('button', { 'data-focus': true }, 'No, keep it');
    const c = openPanel(layer, `Delete ${item.cards.name}?`, h('p', {}, 'It will be gone from this gallery.'), h('div', { class: 'row' }, no, yes));
    no.addEventListener('click', c.close);
    yes.addEventListener('click', async () => {
      await gallery.delete(item.id);
      c.close();
      await render();
    });
  }

  await render();
  return p;
}
