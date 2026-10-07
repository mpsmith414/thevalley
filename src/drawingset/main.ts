import { PerspectiveCamera, Scene } from 'three/webgpu';
import { BuilderClient } from '../builder/client';
import { api, DesignerInvalid, DesignerResting } from '../designer/api';
import { imageUrl, prepareImage } from '../designer/image';
import { designCreature, type DesignOutcome } from '../designer/loop';
import { Gallery, newId } from '../lab/gallery';
import { h, clear } from '../lab/ui/dom';
import { createRenderer } from '../render/renderer';
import { renderView } from '../render/snapshot';
import './drawings.css';

/**
 * The drawing test set: every image in tests/drawings goes through the real designer, with the
 * drawing beside what was built, and a 1/2/3 score ("not mine" / "kind of" / "that's MY one!").
 */
const files = import.meta.glob('/tests/drawings/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const passes = (() => {
  try {
    return JSON.parse(localStorage.getItem('lab.passes') ?? '3') as number;
  } catch {
    return 3;
  }
})();
const scores: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem('drawingset.scores') ?? '{}');
  } catch {
    return {};
  }
})();
const saveScores = () => {
  try {
    localStorage.setItem('drawingset.scores', JSON.stringify(scores));
  } catch {
    /* scores just won't stick */
  }
};

const canvas = document.querySelector<HTMLCanvasElement>('#studio')!;
const { renderer } = await createRenderer(canvas, 'high');
const ctx = { renderer, scene: new Scene(), camera: new PerspectiveCamera() };
const builder = new BuilderClient();
const gallery = await Gallery.open();

const app = document.querySelector<HTMLElement>('#app')!;
const rows = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, url]) => {
  const name = path.split('/').pop()!.replace(/\.\w+$/, '');
  const status = h('div', { class: 'status' }, 'Not run yet');
  const built = h('img', { alt: '' });
  const turned = h('img', { alt: '' });
  const notes = h('div', { class: 'notes' });
  const scoreBox = h('div', { class: 'score' });
  const renderScore = () => {
    clear(scoreBox).append(
      ...[1, 2, 3].map((n) =>
        h('button', { class: scores[name] === n ? 'on' : '', title: ['', 'Not mine', 'Kind of', 'That’s MY one!'][n], onclick: () => ((scores[name] = n), saveScores(), renderScore()) }, ['', '1 😕', '2 🙂', '3 🤩'][n]),
      ),
    );
  };
  renderScore();
  const open = h('button', { disabled: true }, 'Open in lab');
  const tr = h('tr', {},
    h('td', {}, h('div', { class: 'name' }, name), h('img', { src: url, alt: name })),
    h('td', {}, built), h('td', {}, turned),
    h('td', {}, status, notes, h('br', {}), scoreBox, h('br', {}), open),
  );
  return { name, url, tr, status, built, turned, notes, open };
});

const runAll = h('button', { class: 'primary' }, `▶ Run all (${passes} look-again passes each)`);
app.append(
  h('h1', {}, 'Drawing test set'),
  h('p', {}, 'Each drawing goes through the creature designer. Score each one: 1 = “not mine”, 2 = “kind of”, 3 = “that’s MY one!”. Add photos of real drawings to tests/drawings/ and reload.'),
  h('div', { class: 'top' }, runAll),
  h('table', {}, h('tbody', {}, ...rows.map((r) => r.tr))),
);

async function runOne(r: (typeof rows)[number]) {
  const t0 = performance.now();
  r.status.textContent = 'Reading the drawing…';
  try {
    const file = await (await fetch(r.url)).blob();
    const image = await prepareImage(file);
    const out: DesignOutcome = await designCreature(
      { image, words: '' },
      { api, build: (x) => builder.build(x), snapshot: (b, x, v) => renderView(ctx, b, x, v) },
      { passes },
      (s) => {
        if (s.kind === 'looking') {
          r.built.src = imageUrl(s.render);
          r.status.textContent = `Look-again pass ${s.pass}…`;
        } else r.status.textContent = s.kind === 'building' ? 'Building…' : s.kind === 'fixing' ? s.note : r.status.textContent;
      },
    );
    if (out.status !== 'ok') {
      r.status.textContent = `${out.status}: ${out.message}`;
      return;
    }
    r.built.src = imageUrl(await renderView(ctx, out.body, out.recipe, out.view));
    const three = await renderView(ctx, out.body, out.recipe, { angle: 'threeQuarter', facing: 'right' }, 512);
    r.turned.src = imageUrl(three);
    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    r.status.textContent = `${out.cards.name} · ${out.history.length} pass${out.history.length === 1 ? '' : 'es'} · ${secs} s · tokens —`;
    clear(r.notes).append(
      h('div', {}, `Saw: ${out.checklist.join(', ')}`),
      ...out.history.map((p) => h('div', {}, `${p.pass}. ${p.verdict === 'matches' ? '✓ matches' : `${p.edits} edits`} — ${p.note}`)),
    );
    r.open.disabled = false;
    r.open.onclick = async () => {
      const thumb = await renderView(ctx, out.body, out.recipe, { angle: 'threeQuarter', facing: 'right' }, 256);
      await gallery.save({
        id: newId(), recipe: out.recipe, cards: out.cards, drawing: image, words: '', thumb,
        history: out.history.map(({ render: _render, ...rest }) => rest), createdAt: Date.now(), native: false,
      });
      location.href = '/';
    };
  } catch (e) {
    r.status.textContent = e instanceof DesignerResting ? 'The designer is resting (is the API key set?)' : e instanceof DesignerInvalid ? 'The designer got muddled' : `Error: ${String(e)}`;
  }
}

runAll.addEventListener('click', async () => {
  runAll.disabled = true;
  for (const r of rows) await runOne(r);
  runAll.disabled = false;
});

Object.assign(window, { __drawings: { rows, runOne } });
