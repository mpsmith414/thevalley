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
const SUN_DIR = new Vector3(0.5, 0.6, 0.3).normalize(); // fixed until the clock arrives (Task 12)

/** Everything up to the first frame: the renderer, the Valley (from the cache or the worker), the scene, compiled. */
async function start(step: Parameters<typeof loadValley>[2]) {
  const [{ renderer, backend }, { data, cached }] = await Promise.all([
    createRenderer(canvas, tier),
    loadValley(VALLEY, DEFAULT_GRID, step),
  ]);
  performance.mark('valley-data');
  const valley = createValley(data);

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
  const view = (n: number) => {
    const v = VALLEY.viewpoints[Math.min(VALLEY.viewpoints.length, Math.max(1, Math.round(n))) - 1];
    const ground = (x: number, z: number) => Math.max(valley.heightAt(x, z), valley.isWater(x, z) ? valley.waterLevelAt(x, z) : -Infinity);
    camera.position.set(v.pos.x, ground(v.pos.x, v.pos.z) + v.pos.h, v.pos.z);
    camera.lookAt(v.look.x, ground(v.look.x, v.look.z) + v.look.h, v.look.z);
    return v.name;
  };
  view(8); // Valley Overview

  const resize = () => {
    let w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      if (canvas.width > 0) return; // hidden: keep the last size
      [w, h] = [1280, 720]; // loaded while hidden: draw at a sensible size anyway
    }
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const tick = (_dt: number) => {
    terrain.update(camera);
    sky.position.copy(camera.position);
  };
  tick(0);
  await renderer.compileAsync(scene, camera);
  performance.mark('valley-ready');
  return { renderer, backend, data, cached, valley, scene, camera, sky, sun, tex, terrain, backdrop, view, tick };
}
type World = Awaited<ReturnType<typeof start>>;

// ---------- the loop ----------
let paused = false; // dev: `step` freezes the world
let onFrame: ((dt: number) => void) | null = null; // dev: fps samples

function run(w: World) {
  let last = performance.now();
  w.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    onFrame?.(dt);
    if (!paused) w.tick(dt);
    if (canvas.width > 0) w.renderer.render(w.scene, w.camera);
  });
}

// ---------- dev hooks (checks in the browser) ----------
function devHooks(w: World) {
  const { renderer, scene, camera, tick } = w;
  const fps: number[] = [];
  onFrame = (dt) => {
    if (dt > 0) fps.push(1 / dt);
    if (fps.length > 240) fps.shift();
  };
  /** Render now and save the frame as .shots/<name>.png (works even when the window is hidden). */
  const shot = async (name: string) => {
    tick(0);
    await renderer.compileAsync(scene, camera); // new materials compile in the background; wait for them
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png'); // same task as the render, before the frame is presented
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return name;
  };
  /** The whole screen (3D view plus the UI on top) saved as .shots/<name>.png. */
  const screen = async (name: string) => {
    const { toCanvas } = await import('html-to-image');
    tick(0);
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const g = out.getContext('2d')!;
    g.drawImage(canvas, 0, 0); // same task as the render
    const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
    // the library waits on animation frames, which stop while the window is hidden: stand in timers
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
    let uiCanvas: HTMLCanvasElement;
    try {
      uiCanvas = await toCanvas(ui, { width: cw, height: ch, pixelRatio: canvas.width / cw, skipFonts: true });
    } finally {
      window.requestAnimationFrame = raf;
    }
    g.drawImage(uiCanvas, 0, 0, out.width, out.height);
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: out.toDataURL('image/png') });
    return name;
  };
  /** Freeze the live loop and step the world by hand (works while the window is hidden). */
  const step = (frames: number, dt = 1 / 60) => {
    paused = true;
    for (let i = 0; i < frames; i++) tick(dt);
  };
  const mark = (name: string) => Math.round(performance.getEntriesByName(name)[0]?.startTime ?? NaN);
  Object.assign(window, {
    __valley: {
      ...w, tier, step, shot, screen,
      resume: () => (paused = false),
      /** Median frames per second over the last few seconds. */
      fps: () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0),
      /** Milliseconds since navigation until the data arrived and until the first frame was ready. */
      get timings() { return { data: mark('valley-data'), ready: mark('valley-ready') }; },
    },
  });
}

// ---------- start ----------
const loading = openLoading(ui);
let world: World | null = null;
try {
  world = await start(loading.step);
} catch (e) {
  console.error('the valley could not start', e);
  loading.fail('The valley got a bit tangled while we were making it. Shall we try again?');
}
if (world) {
  if (import.meta.env.DEV) devHooks(world);
  run(world);
  loading.close();
  if (world.cached) toast(ui, 'Welcome back!');
}
