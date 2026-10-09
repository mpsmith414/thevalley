import { imageUrl } from '../../designer/image';
import type { ProgressStep } from '../../designer/loop';
import { clear, h } from '../../shared/dom';
import { openPanel } from './shell';

/** "Reading your drawing… → Building the body… → Taking a look…", with the drawing beside each build. */
export function openProgress(layer: HTMLElement, drawingUrl: string | null, words: string, passes: number) {
  const stepEl = h('div', { class: 'step' }, drawingUrl ? 'Reading your drawing…' : 'Reading your words…');
  const spinner = h('div', { class: 'spinner' });
  const dots = h('div', { class: 'dots' }, ...Array.from({ length: passes }, () => h('span', {})));
  const built = h('div', { class: 'frame empty' }, h('span', {}, 'Building…'));
  const compare = h('div', { class: 'compare' },
    h('figure', {}, drawingUrl ? h('img', { src: drawingUrl, alt: 'Your drawing' }) : h('div', { class: 'frame words' }, words ? `“${words}”` : ''), h('figcaption', {}, drawingUrl ? 'Your drawing' : 'Your words')),
    h('figure', {}, built, h('figcaption', {}, 'What I built')),
  );
  const p = openPanel(layer, 'Bringing it to life', h('div', { class: 'status' }, spinner, stepEl), compare, dots);
  p.panel.classList.add('progress');
  p.closeBtn.remove(); // it finishes by itself

  return {
    step(s: ProgressStep) {
      if (s.kind === 'reading') stepEl.textContent = drawingUrl ? 'Reading your drawing…' : 'Reading your words…';
      if (s.kind === 'building') stepEl.textContent = 'Building the body…';
      if (s.kind === 'looking') {
        stepEl.textContent = 'Taking a look…';
        clear(built).append(h('img', { src: imageUrl(s.render), alt: 'What I built' }));
        built.classList.remove('empty');
        dots.children[s.pass - 1]?.classList.add('on');
      }
      if (s.kind === 'fixing') stepEl.textContent = s.note || 'Fixing a few things…';
      if (s.kind === 'done') {
        stepEl.textContent = 'Ta-da!';
        spinner.classList.add('done');
      }
    },
    close: p.close,
  };
}
