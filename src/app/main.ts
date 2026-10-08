import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { isTier, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { stored } from '../shared/settings';
import { loadValley } from '../valley/cache';
import { VALLEY } from '../valley/layout';
import { DEFAULT_GRID } from '../valley/types';
import { createValley } from '../valley/valley';
import { createBackdrop } from '../world/backdrop';
import { createTerrain } from '../world/terrain';
import { valleyTextures } from '../world/textures';
import { openLoading, toast } from './loading';
import './valley.css';

// ---------- settings (remembered per browser) ----------
const saved = stored<unknown>('valley.tier', 'high');
const tier: Tier = isTier(saved) ? saved : 'high';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

// ---------- the Valley: from the cache, or made in the worker ----------
const loading = openLoading(ui);
const [{ renderer, backend }, loaded] = await Promise.all([
  createRenderer(canvas, tier),
  loadValley(VALLEY, DEFAULT_GRID, loading.step).catch((e: unknown) => {
    loading.fail('The valley got stuck while it was being made. Try reloading the page.');
    throw e;
  }),
]);
const { data, cached } = loaded;
const timings = { data: Math.round(performance.now()), ready: 0 }; // ms since navigation, for checking load times
const valley = createValley(data);

// ---------- the scene ----------
const SUN_DIR = new Vector3(0.5, 0.6, 0.3).normalize(); // fixed until the clock arrives (Task 12)
const scene = new Scene();
scene.fog = new Fog(new Color('#b9c8cf'), 600, 5000);
const camera = new PerspectiveCamera(55, 1, 0.1, 8000);

const sky = new SkyMesh();
sky.scale.setScalar(4000);
sky.turbidity.value = 3;
sky.rayleigh.value = 1.2;
sky.mieCoefficient.value = 0.004;
sky.mieDirectionalG.value = 0.8;
sky.sunPosition.value.copy(SUN_DIR);
sky.cloudCoverage.value = 0.35;

const sun = new DirectionalLight('#fff3df', 2.6);
sun.position.copy(SUN_DIR).multiplyScalar(1000);
const hemi = new HemisphereLight('#cfe3ff', '#5a4a30', 0.6);

const tex = valleyTextures(data);
const terrain = createTerrain(tex, tier);
const backdrop = createBackdrop(data);
scene.add(sky, sun, sun.target, hemi, terrain.object, backdrop);

/** Put the camera at viewpoint `n` (1–8): eye and target are metres above the ground (or the water). */
function view(n: number) {
  const v = VALLEY.viewpoints[Math.min(VALLEY.viewpoints.length, Math.max(1, Math.round(n))) - 1];
  const ground = (x: number, z: number) => Math.max(valley.heightAt(x, z), valley.isWater(x, z) ? valley.waterLevelAt(x, z) : -Infinity);
  camera.position.set(v.pos.x, ground(v.pos.x, v.pos.z) + v.pos.h, v.pos.z);
  camera.lookAt(v.look.x, ground(v.look.x, v.look.z) + v.look.h, v.look.z);
  return v.name;
}
view(8); // Valley Overview

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

// ---------- the loop ----------
function tick(_dt: number) {
  terrain.update(camera);
  sky.position.copy(camera.position);
}

await renderer.compileAsync(scene, camera);
timings.ready = Math.round(performance.now());
loading.close();
if (cached) toast(ui, 'Welcome back!');

const fps: number[] = [];
let last = performance.now();
let paused = false;
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (dt > 0) fps.push(1 / dt);
  if (fps.length > 240) fps.shift();
  if (!paused) tick(dt);
  if (canvas.width > 0) renderer.render(scene, camera);
});

// ---------- dev hooks (checks in the browser) ----------
/** Dev: render now and save the frame as .shots/<name>.png (works even when the window is hidden). */
async function shot(name: string) {
  tick(0);
  await renderer.compileAsync(scene, camera); // new materials compile in the background; wait for them
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png'); // same task as the render, before the frame is presented
  await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return name;
}
/** Dev: the whole screen (3D view plus the UI on top) saved as .shots/<name>.png. */
async function screen(name: string) {
  const { toCanvas } = await import('html-to-image');
  tick(0);
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
    uiCanvas = await toCanvas(ui, { width: w, height: h, pixelRatio: canvas.width / w, skipFonts: true });
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
  Object.assign(window, {
    __valley: {
      scene, camera, renderer, backend, tier, data, cached, timings, valley, terrain, backdrop, sky, sun, tex, step, shot, screen, view,
      resume: () => (paused = false),
      /** Median frames per second over the last few seconds. */
      fps: () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0),
    },
  });
}
