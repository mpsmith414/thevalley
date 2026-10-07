import { PerspectiveCamera, Scene } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BuilderClient } from '../builder/client';
import { createCreatureObject, type CreatureObject } from '../render/creature';
import { autoQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { createStage } from '../render/stage';
import type { Recipe } from '../recipe/schema';
import { quadruped } from '../../tests/fixtures/recipes';
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
async function show(recipe: Recipe) {
  const body = await builder.build(recipe);
  creature?.dispose();
  creature = createCreatureObject(body, recipe, tier);
  creature.root.position.y = stage.heightAt(0, 0);
  scene.add(creature.root);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const fps: number[] = [];
let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (dt > 0) fps.push(1 / dt);
  if (fps.length > 240) fps.shift();
  controls.update();
  stage.update(now / 1000);
  renderer.render(scene, camera);
});

// dev hook for checks in the browser
Object.assign(window, {
  __lab: { scene, camera, renderer, backend, show, get creature() { return creature; }, fps: () => autoQuality(fps), fpsSamples: fps, builder },
});

await show(quadruped);
