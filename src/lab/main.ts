import { PerspectiveCamera, Scene } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BuilderClient } from '../builder/client';
import { CreatureRig } from '../motion/rig';
import { createCreatureObject, type CreatureObject } from '../render/creature';
import { autoQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { createStage } from '../render/stage';
import type { Recipe } from '../recipe/schema';
import * as fixtures from '../../tests/fixtures/recipes';
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
let circling = true;
async function show(recipe: Recipe) {
  const body = await builder.build(recipe);
  creature?.dispose();
  creature = createCreatureObject(body, recipe, tier);
  scene.add(creature.root);
  rig = new CreatureRig(creature, body, recipe, stage);
  rig.setSpeed(0.25);
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
  if (rig) {
    if (circling) {
      // walk a circle that crosses the slope
      const a = Math.atan2(rig.position.z, rig.position.x) + 0.5;
      rig.moveTo({ x: Math.cos(a) * 2.6, y: 0, z: Math.sin(a) * 2.6 });
    }
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
async function step(frames: number, dt = 1 / 60) {
  paused = true;
  for (let i = 0; i < frames; i++) tick(dt);
}

// dev hook for checks in the browser
Object.assign(window, {
  __lab: { scene, camera, renderer, backend, show, fixtures, get creature() { return creature; }, get rig() { return rig; }, setCircling(v: boolean) { circling = v; }, step, shot, resume() { paused = false; }, controls, fps: () => autoQuality(fps), fpsSamples: fps, builder },
});

await show(fixtures.quadruped);
