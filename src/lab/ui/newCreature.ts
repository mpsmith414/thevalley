import { h } from './dom';
import { openPanel } from './shell';

/** Drop or pick a photo of a drawing, and/or type some words, then "Bring it to life!". */
export function openNewCreature(layer: HTMLElement, onSubmit: (file: Blob | null, words: string) => void) {
  let file: Blob | null = null;
  const preview = h('img', { class: 'preview', alt: '' });
  const hint = h('div', { class: 'hint' }, h('div', { class: 'big-icon' }, '🖍️'), 'Drop a photo of a drawing here', h('small', {}, 'or click to choose one · or paste'));
  const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const drop = h('button', { class: 'drop', 'data-focus': true, onclick: () => picker.click() }, hint, preview);
  const words = h('textarea', { class: 'words', rows: 3, maxlength: 500, 'data-focus': true, placeholder: 'Tell me about it… “It’s shy, it eats flowers and it breathes bubbles”' });
  const go = h('button', { class: 'go', 'data-focus': true }, '✨ Bring it to life!');

  const setFile = (f: Blob | null) => {
    file = f;
    if (f) {
      preview.src = URL.createObjectURL(f);
      drop.classList.add('has');
    }
  };
  picker.addEventListener('change', () => setFile(picker.files?.[0] ?? null));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) setFile(f);
  });
  const onPaste = (e: ClipboardEvent) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) setFile(f);
  };
  window.addEventListener('paste', onPaste);

  const p = openPanel(layer, 'New creature', drop, picker, words, go);
  p.panel.classList.add('new');
  const close = () => {
    window.removeEventListener('paste', onPaste);
    p.close();
  };
  p.closeBtn.addEventListener('click', () => window.removeEventListener('paste', onPaste));
  go.addEventListener('click', () => {
    if (!file && !words.value.trim()) {
      go.classList.add('shake');
      setTimeout(() => go.classList.remove('shake'), 500);
      return;
    }
    const f = file, w = words.value.trim();
    close();
    onSubmit(f, w);
  });
  return { close };
}
