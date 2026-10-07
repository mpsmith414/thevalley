import { PerspectiveCamera, Scene } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BuilderClient } from '../builder/client';
import { ActionController, type Action } from '../motion/actions';
import { CreatureRig } from '../motion/rig';
import { mulberry32 } from '../util/rng';
import { createCreatureObject, type CreatureObject } from '../render/creature';
import { autoQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { createStage } from '../render/stage';
import { renderView } from '../render/snapshot';
import type { View } from '../designer/types';
import type { Recipe } from '../recipe/schema';
import * as fixtures from '../../tests/fixtures/recipes';
import { CAST } from '../cast';
import './lab.css';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const tier: Tier = 'high';
const { renderer, backend } = await createRenderer(canvas, tier);
const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.05, 4000);
camera.position.set(2.2, 1.1, 2.4);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.45, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.4;
controls.maxDistance = 12;
const stage = createStage(scene, renderer, tier);
const builder = new BuilderClient();

let creature: CreatureObject | null = null;
let rig: CreatureRig | null = null;
let actions: ActionController | null = null;
async function show(recipe: Recipe) {
  const body = await builder.build(recipe);
  creature?.dispose();
  creature = createCreatureObject(body, recipe, tier);
  scene.add(creature.root);
  rig = new CreatureRig(creature, body, recipe, stage);
  if (rig.swimmer) rig.position.set(stage.pond.x, 0, stage.pond.z);
  actions = new ActionController(rig, stage, mulberry32(recipe.seed));
  actions.set('wander');
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

let simTime = 0;
/** Advance the world by dt seconds (no drawing). */
function tick(dt: number) {
  simTime += dt;
  if (rig && actions) {
    actions.update(dt, camera.position);
    rig.update(dt);
    controls.target.lerp(rig.obj.root.position.clone().setY(rig.obj.root.position.y + 0.4), 0.1);
  }
  controls.update();
  stage.update(simTime);
}

const fps: number[] = [];
let last = performance.now();
let paused = false;
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (dt > 0) fps.push(1 / dt);
  if (fps.length > 240) fps.shift();
  if (!paused) tick(dt);
  else controls.update();
  if (canvas.width > 0) renderer.render(scene, camera);
});

/** Dev: render now and save the frame as .shots/<name>.png (works even when the window is hidden). */
async function shot(name: string) {
  controls.update();
  await renderer.compileAsync(scene, camera); // new materials compile in the background; wait for them
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png'); // same task as the render, before the frame is presented
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return name;
}

/** Dev: freeze the live loop and step the world by hand (works while the window is hidden). */
function step(frames: number, dt = 1 / 60) {
  paused = true;
  for (let i = 0; i < frames; i++) tick(dt);
}

// dev hook for checks in the browser
Object.assign(window, {
  __lab: { scene, camera, renderer, backend, show, fixtures, CAST,
    /** Dev: photograph a recipe like the designer does and save it to .shots. */
    async view(recipe: Recipe, v: View, name: string) {
      const body = await builder.build(recipe);
      const img = await renderView({ renderer, scene, camera }, body, recipe, v);
      await fetch(`/__shot?name=${name}`, { method: 'POST', body: `data:image/png;base64,${img.base64}` });
      return img.base64.length;
    }, get creature() { return creature; }, get rig() { return rig; }, act(a: Action) { actions?.set(a, camera.position); }, get actions() { return actions; }, step, shot, resume() { paused = false; }, controls, fps: () => autoQuality(fps), fpsSamples: fps, builder },
});

// temporary cast picker until the lab UI lands: number keys 1-8
window.addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < CAST.length) void show(CAST[i].recipe);
});

await show(CAST[0].recipe);
