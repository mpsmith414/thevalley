import { PerspectiveCamera, Scene, SkeletonHelper, Spherical, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BuilderClient } from '../builder/client';
import { CAST } from '../cast';
import { api, designerModel, DesignerInvalid, DesignerResting } from '../designer/api';
import { prepareImage } from '../designer/image';
import { designCreature, tweakCreature } from '../designer/loop';
import type { View } from '../designer/types';
import { ActionController, type Action } from '../motion/actions';
import { CreatureRig } from '../motion/rig';
import type { Recipe } from '../recipe/schema';
import { createCreatureObject, type CreatureObject } from '../render/creature';
import { autoQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { renderView } from '../render/snapshot';
import { createStage } from '../render/stage';
import { mulberry32 } from '../util/rng';
import { FocusRing } from './focus';
import { Gallery, newId, type GalleryItem } from './gallery';
import { Input, type Button } from './input';
import { openGallery } from './ui/galleryPanel';
import { openNewCreature } from './ui/newCreature';
import { openProgress } from './ui/progress';
import { createShell } from './ui/shell';
import { openTweak } from './ui/tweak';
import { createWorkshop, type WorkshopInfo } from './ui/workshop';
import './lab.css';

// ---------- settings (remembered per browser) ----------
const stored = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const remember = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: settings just won't stick */
  }
};
const settings = { tier: stored<Tier>('lab.tier', 'high'), passes: stored('lab.passes', 3) };

// ---------- the 3D stage ----------
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const { renderer, backend } = await createRenderer(canvas, settings.tier);
const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.05, 4000);
camera.position.set(2.2, 1.1, 2.4);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.45, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.3;
controls.maxDistance = 12;
const stage = createStage(scene, renderer, settings.tier);
const builder = new BuilderClient();
const snapshotCtx = { renderer, scene, camera };

let creature: CreatureObject | null = null;
let rig: CreatureRig | null = null;
let actions: ActionController | null = null;
let skeletonHelper: SkeletonHelper | null = null;
let current: GalleryItem | null = null;

/** Put a recipe on the stage, framed to its size, wandering about. */
async function show(recipe: Recipe) {
  const body = await builder.build(recipe);
  creature?.dispose();
  skeletonHelper?.removeFromParent();
  creature = createCreatureObject(body, recipe, settings.tier);
  scene.add(creature.root);
  rig = new CreatureRig(creature, body, recipe, stage);
  if (rig.swimmer) rig.position.set(stage.pond.x, 0, stage.pond.z);
  actions = new ActionController(rig, stage, mulberry32(recipe.seed));
  setAction('wander');
  if (skeletonOn) addSkeleton();
  // frame it: the camera keeps its direction, at a distance that suits the creature's size
  const size = Math.max(0.3, recipe.life.sizeM, body.skeleton.max.y);
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.set(rig.position.x, rig.restHeight, rig.position.z);
  camera.position.copy(controls.target).addScaledVector(dir, size * 2.2 + 0.4);
}

function setAction(a: Action) {
  actions?.set(a, camera.position);
  shell.setAction(a);
}

function resize() {
  let w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) {
    if (canvas.width > 0) return; // hidden: keep the last size
    [w, h] = [1280, 720]; // loaded while hidden: draw at a sensible size anyway
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- the screen ----------
const ui = document.querySelector<HTMLElement>('#ui')!;
const shell = createShell(ui, {
  act: setAction,
  newCreature: () => openNew(),
  gallery: () => void openGalleryPanel(),
  change: () => current && openTweak(shell.layer, current.cards.name, (w) => void change(w)),
});
const gallery = await Gallery.open();
await gallery.seedNatives(CAST);
let model: string | null = await designerModel();
let skeletonOn = false;

const workshopInfo = (): WorkshopInfo => ({
  item: current, backend, tier: settings.tier, fps: medianFps(), buildMs: builder.lastMs, model, passes: settings.passes,
  lod: creature?.lod ?? 0, fur: creature?.furOn ?? true, skeleton: skeletonOn,
});
const workshop = createWorkshop(ui, {
  setLod: (l) => (creature?.setLod(l), workshop.render(workshopInfo())),
  setFur: (on) => (creature?.setFur(on), workshop.render(workshopInfo())),
  setSkeleton: (on) => {
    skeletonOn = on;
    if (on) addSkeleton();
    else skeletonHelper?.removeFromParent();
    workshop.render(workshopInfo());
  },
  setTier: (t) => {
    remember('lab.tier', t);
    location.reload();
  },
  setPasses: (n) => {
    settings.passes = n;
    remember('lab.passes', n);
    workshop.render(workshopInfo());
  },
});

function addSkeleton() {
  if (!creature) return;
  skeletonHelper = new SkeletonHelper(creature.root);
  scene.add(skeletonHelper);
}

async function showItem(item: GalleryItem) {
  current = item;
  shell.setCards(item.cards);
  await show(item.recipe);
  workshop.render(workshopInfo());
}

let busy = false;
const friendly = (e: unknown) =>
  e instanceof DesignerInvalid ? 'Hmm, that one got muddled — let’s try again!'
  : e instanceof DesignerResting ? 'The creature designer is resting — try again in a bit.'
  : 'Something went wrong — let’s try again!';

function openNew() {
  if (busy) return;
  openNewCreature(shell.layer, (file, words) => void makeCreature(file, words));
  focus.reset();
}

/** The whole "bring it to life" flow: prepare the drawing, design with look-again, save, show. */
async function makeCreature(file: Blob | null, words: string) {
  busy = true;
  const drawingUrl = file ? URL.createObjectURL(file) : null;
  const progress = openProgress(shell.layer, drawingUrl, words, settings.passes);
  try {
    const image = file ? await prepareImage(file) : null;
    const out = await designCreature(
      { image, words },
      { api, build: (r) => builder.build(r), snapshot: (b, r, v) => renderView(snapshotCtx, b, r, v) },
      { passes: settings.passes },
      (s) => progress.step(s),
    );
    if (out.status !== 'ok') {
      progress.close();
      shell.toast(out.message || 'I couldn’t find a creature in that — try another drawing!');
      return;
    }
    const thumb = await renderView(snapshotCtx, out.body, out.recipe, { angle: 'threeQuarter', facing: 'right' }, 256);
    const item: GalleryItem = {
      id: newId(), recipe: out.recipe, cards: out.cards, drawing: image, words, thumb,
      history: out.history.map(({ render: _render, ...rest }) => rest), createdAt: Date.now(), native: false,
    };
    await gallery.save(item);
    await showItem(item);
    setTimeout(progress.close, 1200);
    shell.toast(`Ta-da! Meet ${out.cards.name}!`);
  } catch (e) {
    console.error(e);
    progress.close();
    shell.toast(friendly(e));
  } finally {
    busy = false;
  }
}

async function change(words: string) {
  if (!current || busy) return;
  busy = true;
  shell.toast(`Changing ${current.cards.name}…`, 20000);
  try {
    const out = await tweakCreature(current.recipe, current.cards, words, { api, build: (r) => builder.build(r) });
    if (out.status !== 'ok') return shell.toast(out.message);
    const thumb = await renderView(snapshotCtx, out.body, out.recipe, { angle: 'threeQuarter', facing: 'right' }, 256);
    const item: GalleryItem = current.native
      ? { ...current, id: newId(), native: false, recipe: out.recipe, cards: out.cards, thumb, createdAt: Date.now() }
      : { ...current, recipe: out.recipe, cards: out.cards, thumb };
    await gallery.save(item);
    await showItem(item);
    shell.toast(out.note || 'Done!');
  } catch (e) {
    console.error(e);
    shell.toast(friendly(e));
  } finally {
    busy = false;
  }
}

async function openGalleryPanel() {
  await openGallery(shell.layer, gallery, {
    pick: (item) => void showItem(item),
    thumb: async (item) => renderView(snapshotCtx, await builder.build(item.recipe), item.recipe, { angle: 'threeQuarter', facing: 'right' }, 256),
    toast: (t) => shell.toast(t),
  });
  focus.reset();
}

/** LB/RB: previous/next creature in the gallery. */
async function cycle(step: 1 | -1) {
  const items = await gallery.list();
  if (!items.length) return;
  const i = Math.max(0, items.findIndex((x) => x.id === current?.id));
  await showItem(items[(i + step + items.length) % items.length]);
}

// ---------- controller, keyboard, mouse ----------
const topLayer = () => (shell.layer.lastElementChild as HTMLElement | null) ?? (workshop.open ? ui : shell.bar);
const focus = new FocusRing(topLayer);
const input = new Input();
const menuOpen = () => !!shell.layer.lastElementChild;
input.onPress = (b: Button) => {
  if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return focus.move(b);
  if (b === 'a') return focus.activate();
  if (menuOpen()) {
    if (b === 'b') (shell.layer.lastElementChild as HTMLElement).querySelector<HTMLButtonElement>('.close')?.click();
    return;
  }
  if (b === 'x') setAction('walk');
  if (b === 'y') setAction('run');
  if (b === 'lb') void cycle(-1);
  if (b === 'rb') void cycle(1);
  if (b === 'start') return openNew();
  if (b === 'select') workshop.toggle(workshopInfo());
  if (b === 'b' && workshop.open) workshop.toggle(workshopInfo());
};
// number keys pick a native animal (handy at the desk)
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const i = Number(e.key) - 1;
  if (i >= 0 && i < CAST.length) void gallery.get(`native:${CAST[i].recipe.id}`).then((it) => it && showItem(it));
});

// ---------- the loop ----------
const sph = new Spherical();
const lastTarget = new Vector3();
let simTime = 0;
/** Advance the world by dt seconds (no drawing). */
function tick(dt: number) {
  simTime += dt;
  const move = input.poll(dt, menuOpen());
  if (rig && actions) {
    actions.update(dt, camera.position);
    rig.update(dt);
    // follow the creature: the camera keeps its offset as the target moves
    lastTarget.copy(controls.target);
    const p = rig.obj.root.position;
    controls.target.lerp(new Vector3(p.x, p.y + rig.restHeight * 0.8, p.z), Math.min(1, dt * 4));
    camera.position.add(controls.target.clone().sub(lastTarget));
  }
  if (move.orbitX || move.orbitY || move.zoom) {
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    sph.theta -= move.orbitX;
    sph.phi = Math.min(Math.PI * 0.49, Math.max(0.15, sph.phi + move.orbitY));
    sph.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sph.radius * Math.exp(move.zoom)));
    camera.position.copy(controls.target).add(new Vector3().setFromSpherical(sph));
  }
  controls.update();
  stage.update(simTime);
}

const fps: number[] = [];
const medianFps = () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0);
let last = performance.now();
let paused = false;
let infoTimer = 0;
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (dt > 0) fps.push(1 / dt);
  if (fps.length > 240) fps.shift();
  if (!paused) tick(dt);
  else controls.update();
  if (canvas.width > 0) renderer.render(scene, camera);
  if ((infoTimer += dt) > 0.5) {
    infoTimer = 0;
    workshop.refresh(workshopInfo());
  }
});

// ---------- dev hooks (checks in the browser) ----------
/** Dev: render now and save the frame as .shots/<name>.png (works even when the window is hidden). */
async function shot(name: string) {
  controls.update();
  await renderer.compileAsync(scene, camera); // new materials compile in the background; wait for them
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png'); // same task as the render, before the frame is presented
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return name;
}
/** Dev: the whole screen (3D stage plus the UI on top) saved as .shots/<name>.png. */
async function screen(name: string) {
  const { toCanvas } = await import('html-to-image');
  controls.update();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext('2d')!;
  g.drawImage(canvas, 0, 0); // same task as the render
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  // the library waits on animation frames, which stop while the window is hidden: stand in timers
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
  let uiCanvas: HTMLCanvasElement;
  try {
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    uiCanvas = await toCanvas(ui, { width: w, height: h, pixelRatio: canvas.width / w, skipFonts: true, imagePlaceholder: blank,
      filter: (n) => !(n instanceof HTMLImageElement && !n.getAttribute('src')) && !(n instanceof HTMLInputElement && n.type === 'file') });
  } finally {
    window.requestAnimationFrame = raf;
  }
  g.drawImage(uiCanvas, 0, 0, out.width, out.height);
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: out.toDataURL('image/png') });
  return name;
}

/** Dev: freeze the live loop and step the world by hand (works while the window is hidden). */
function step(frames: number, dt = 1 / 60) {
  paused = true;
  for (let i = 0; i < frames; i++) tick(dt);
}
if (import.meta.env.DEV) {
  const fixtures = await import('../../tests/fixtures/recipes');
  Object.assign(window, {
    __lab: {
      scene, camera, renderer, backend, controls, builder, gallery, input, focus, CAST, fixtures, show, showItem, step, shot, screen,
      resume: () => (paused = false),
      act: setAction,
      get creature() { return creature; },
      get rig() { return rig; },
      get actions() { return actions; },
      get current() { return current; },
      fps: () => autoQuality(fps),
      refreshModel: async () => (model = await designerModel()),
      make: makeCreature,
      change,
      /** Dev: photograph a recipe like the designer does and save it to .shots. */
      async view(recipe: Recipe, v: View, name: string) {
        const img = await renderView(snapshotCtx, await builder.build(recipe), recipe, v);
        await fetch(`/__shot?name=${name}`, { method: 'POST', body: `data:image/png;base64,${img.base64}` });
        return img.base64.length;
      },
    },
  });
}

await showItem((await gallery.get(`native:${CAST[0].recipe.id}`))!);
focus.reset();
