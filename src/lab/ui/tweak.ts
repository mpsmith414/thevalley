import { h } from '../../shared/dom';
import { openPanel } from './shell';

/** "Change it": a few words like "make it bigger" or "give it wings". */
export function openTweak(layer: HTMLElement, name: string, onSubmit: (words: string) => void) {
  const words = h('input', { class: 'words', type: 'text', maxlength: 200, 'data-focus': true, placeholder: 'Make it bigger · give it wings · make it purple' });
  const go = h('button', { class: 'go', 'data-focus': true }, '✏️ Change it!');
  const p = openPanel(layer, `Change ${name}`, words, go);
  p.panel.classList.add('tweak');
  const submit = () => {
    const w = words.value.trim();
    if (!w) return;
    p.close();
    onSubmit(w);
  };
  go.addEventListener('click', submit);
  words.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  return p;
}
