import { NeutralToneMapping, PerspectiveCamera, Scene } from 'three/webgpu';
import { FreeFly, intentFrom, toggleDown } from '../camera/freefly';
import { Glide, viewpointPose } from '../camera/viewpoints';
import { isTier, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { Input } from '../shared/input';
import { stored } from '../shared/settings';
import { loadValley } from '../valley/cache';
import { VALLEY } from '../valley/layout';
import { DEFAULT_GRID } from '../valley/types';
import { createValley } from '../valley/valley';
import { createBackdrop } from '../world/backdrop';
import { ValleyClock, moonDirection, moonPhase, sunDirection } from '../world/clock';
import { lightingAt } from '../world/lighting';
import { loadGroundSets } from '../world/ground';
import { createLake } from '../world/lake';
import { createRiver } from '../world/river';
import { createSky } from '../world/sky';
import { createTerrain } from '../world/terrain';
import { valleyTextures } from '../world/textures';
import { WORLD_QUALITY } from '../world/quality';
import { MID_LAYER, MID_TREE_LAYER, NEAR_LAYER, VegetationTiles } from '../world/tiles';
import { createPlantMaterials, loadBarkSets, loadCards, setPlantLight } from '../plants/material';
import { createWind, setWind, updateWind, windUniforms } from '../plants/wind';
import { IMPOSTOR_LAYER, bakeImpostors, createImpostorLayer } from '../plants/impostor';
import { GROUND_COVER_LAYER, createGroundCover, loadFlowerCards } from '../plants/grass';
import { openLoading, toast } from './loading';
import './valley.css';

/** The lake's mirror shows the forest only within this many metres of the shore (beyond, the lake is a sliver on screen). */
const MIRROR_PLANTS = 400;
/** Metres from (x, z) to the nearest point of the lake's outline. */
const lakeDistance = (x: number, z: number) => VALLEY.lake.outline.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.z - z)), Infinity);

// ---------- settings (remembered per browser) ----------
const saved = stored<unknown>('valley.tier', 'high');
const tier: Tier = isTier(saved) ? saved : 'high';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

/** Everything up to the first frame: the renderer, the Valley (from the cache or the worker), the scene, compiled. */
async function start(step: Parameters<typeof loadValley>[2], say: (text: string) => void) {
  const ground = loadGroundSets(tier); // photo textures download and decode while the valley is made
  const plantTex = Promise.all([ground.then(() => loadBarkSets()), loadCards(tier === 'high' ? 512 : 256), loadFlowerCards(tier === 'high' ? 256 : 128)]); // bark after the ground: one decode at a time
  const [{ renderer, backend }, { data, cached }] = await Promise.all([
    createRenderer(canvas, tier),
    loadValley(VALLEY, DEFAULT_GRID, step),
  ]);
  // Neutral, not the Lab's AgX: AgX greyed the valley's greens and blues and, with the haze on top, washed the middle distance
  // out to a pale blue-grey. The lighting table's exposures are tuned for Neutral.
  renderer.toneMapping = NeutralToneMapping;
  performance.mark('valley-data');
  say('Rolling out the meadows…');
  const sets = await ground;
  const [barks, cards, flowers] = await plantTex;
  performance.mark('valley-ground');
  const valley = createValley(data);

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 8000);

  const tex = valleyTextures(data);
  const terrain = createTerrain(tex, tier, sets);
  const backdrop = createBackdrop(data);
  scene.add(terrain.object, backdrop);

  // ---------- time of day: the clock drives the sun, moon, sky, light and fog ----------
  const clock = new ValleyClock();
  const sky = createSky(scene, renderer, tier, tex);
  // the water (after the sky: it mirrors the sky's environment map)
  const lake = createLake(data, tex, tier, scene), river = createRiver(data, tex, tier, scene);
  scene.add(lake.object, river.object);
  // the mirror draws the mid plants and the far forest's impostors only when the lake is near enough to show them
  // (the impostors cost the mirror about 0.5 ms wherever it renders)
  lake.mirrorLayers((cam) => (lakeDistance(cam.position.x, cam.position.z) < MIRROR_PLANTS ? 1 | (1 << MID_LAYER) | (1 << IMPOSTOR_LAYER) : 1));
  // ---------- the vegetation, swaying in one shared wind ----------
  const wind = createWind(), windU = windUniforms();
  const plants = createPlantMaterials(cards, barks, windU, tier, sets);
  const veg = new VegetationTiles(data, data.plantModels, plants, WORLD_QUALITY[tier]);
  scene.add(veg.object);
  // the far forest: every tree's impostor, baked from the mid trees now that their materials exist
  say('Growing the trees…');
  const bake = await bakeImpostors(renderer, data.plantModels, plants, WORLD_QUALITY[tier].impostorSize);
  performance.mark('valley-trees');
  const impostors = createImpostorLayer(data, bake, WORLD_QUALITY[tier], plants, tier === 'high');
  scene.add(impostors.object);
  camera.layers.enable(NEAR_LAYER);
  camera.layers.enable(MID_LAYER);
  camera.layers.enable(IMPOSTOR_LAYER);
  // the ground cover: grass, wildflowers, reeds and lily pads, placed on the GPU around the camera (no shadows cast, no mirror)
  const cover = createGroundCover(tex, windU, WORLD_QUALITY[tier], { ground: sets, light: plants.light, flowers });
  scene.add(cover.object);
  camera.layers.enable(GROUND_COVER_LAYER);
  // Shadow casters by cascade (about 0–75, 75–154, 154–260 and 260–600 m on High): near plants (within ~60 m) in the first two,
  // mid plants (from ~60 m) in all but the first, where only the mid trees (a tree at 60–75 m shades the ground under the near
  // camera) are drawn, not the mid shrubs, logs and stumps (which cast no shadow anyway). The impostors (from ~210 m) in the
  // last two (they cast on High only). The land everywhere.
  const NEAR = 1 << NEAR_LAYER, MID = 1 << MID_LAYER, MID_TREE = 1 << MID_TREE_LAYER, IMP = 1 << IMPOSTOR_LAYER;
  // Mid trees in the nearest cascade cost ~1.8 ms at the forest floor for a barely visible gain (low sun only), so they
  // stay out for now; flip this on if the frame budget allows after the residents and ground cover are in.
  const MID_TREES_IN_CASCADE_0 = false;
  sky.cascadeLayers([1 | NEAR | (MID_TREES_IN_CASCADE_0 ? MID_TREE : 0), 1 | NEAR | MID, 1 | MID | IMP, 1 | MID | IMP]);

  let waterTime = 0; // seconds the water has run (its own clock, so `step` moves it too)
  /** Light the world for the clock's current time; `dt = Infinity` snaps the exposure and environment (after a jump). */
  const light = (dt: number) => {
    const hour = clock.hour, sun = sunDirection(hour), moon = moonDirection(clock.hours);
    const state = lightingAt(hour, sun, moon, moonPhase(clock.hours));
    sky.update(state, sun, moon, camera, clock.hours, dt);
    if (Number.isFinite(dt)) waterTime += dt;
    lake.update(waterTime, state, wind);
    setPlantLight(plants.light, state);
    river.update(waterTime, state);
  };

  // ---------- the camera: free-fly, with gliding viewpoints ----------
  const input = new Input();
  const views = VALLEY.viewpoints;
  const start0 = viewpointPose(views[views.length - 1], valley); // Valley Overview
  const fly = new FreeFly(start0.pos, start0.yaw, start0.pitch);
  let current = views.length - 1; // the viewpoint we are at or flying to
  let glide: { g: Glide; t: number } | null = null;
  let wasToggle = false;
  const setPose = (p: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }) => {
    fly.pos = { ...p.pos };
    fly.yaw = p.yaw;
    fly.pitch = p.pitch;
    fly.vel = { x: 0, y: 0, z: 0 };
  };
  /** Viewpoint number `n` (1-8, wrapping) as an index. */
  const index = (n: number) => (((Math.round(n) - 1) % views.length) + views.length) % views.length;
  /** Glide to viewpoint `n` (1-8). */
  const goTo = (n: number) => {
    current = index(n);
    fly.walk = false; // a viewpoint is up in the air, so don't drop back to walking height on arrival
    glide = { g: new Glide(fly, views[current], valley), t: 0 };
    return views[current].name;
  };
  /** Jump straight to viewpoint `n` (1-8): eye and target are metres above the ground (or the water). */
  const view = (n: number) => {
    current = index(n);
    fly.walk = false;
    glide = null;
    setPose(viewpointPose(views[current], valley));
    fly.apply(camera);
    return views[current].name;
  };
  fly.apply(camera);
  input.onPress = (b, repeat) => {
    if (repeat) return; // a held arrow key must not restart the glide
    if (b === 'left') goTo(current); // current is 0-based: n = current is the previous viewpoint
    else if (b === 'right') goTo(current + 2);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-8]$/.test(e.key)) return;
    goTo(+e.key);
  });
  canvas.addEventListener('click', () => (canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {}));

  /** One frame of camera control: gamepad and keys in, a glide or a free-fly step out. */
  const drive = (dt: number) => {
    input.poll(dt, false);
    const pad = input.pad(), held = (k: string) => input.held(k);
    const intent = intentFrom(pad, held, input.mouse(), dt, wasToggle);
    wasToggle = toggleDown(pad, held);
    if (glide) {
      const stirred = pad.lx !== 0 || pad.ly !== 0 || pad.rx !== 0 || pad.ry !== 0 || ['w', 'a', 's', 'd'].some(held);
      if (!stirred) {
        glide.t += dt;
        const s = glide.g.sample(glide.t);
        setPose(s);
        if (s.done) glide = null;
        fly.apply(camera);
        return;
      }
      glide = null; // the camera stays where the glide left it
    }
    fly.update(dt, intent, valley);
    fly.apply(camera);
  };

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

  const tick = (dt: number) => {
    clock.update(dt);
    drive(dt);
    plants.fade.eye.value.copy(camera.position); // the trees' mid/far cross-fade follows the camera
    terrain.update(camera);
    updateWind(wind, dt, VALLEY.seed);
    setWind(windU, wind);
    veg.update(camera, dt);
    cover.update(camera);
    light(dt);
  };
  tick(0);
  light(Infinity);
  performance.mark('valley-scene');
  await veg.compile(() => cover.compile(() => renderer.compileAsync(scene, camera))); // every plant material, not just those in view now
  performance.mark('valley-ready');
  return { renderer, backend, data, cached, valley, scene, camera, sky, clock, light, tex, sets, terrain, backdrop, lake, river, view, goTo, fly, input, tick,
    wind, veg, plants, bake, impostors, cover };
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
  const { renderer, scene, camera, tick, clock, light } = w;
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
      /** Put the camera `h` m above the ground (or water) at (x, z), looking at the point `lh` m above (lx, lz). */
      at: (x: number, z: number, h: number, lx: number, lz: number, lh = 0) => {
        const p = viewpointPose({ name: 'dev', pos: { x, z, h }, look: { x: lx, z: lz, h: lh } }, w.valley);
        Object.assign(w.fly, { pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, vel: { x: 0, y: 0, z: 0 }, walk: false });
        w.fly.apply(camera);
      },
      /** Jump the clock forward to `hour` o'clock and relight at once (a following `shot` shows it). */
      time: (hour: number) => {
        clock.jumpTo(hour);
        light(Infinity);
        return clock.hour;
      },
      /** Paint every leaf card (colour above, height below, on a sky-grey ground) and save the sheet as .shots/<name>.png. */
      cards: async (size = 256, name = 'cards') => {
        const { CARD_KINDS, paintCard } = await import('../plants/cards');
        const sheet = document.createElement('canvas');
        sheet.width = size * CARD_KINDS.length;
        sheet.height = size * 2;
        const g = sheet.getContext('2d')!;
        g.fillStyle = '#9fb0bf';
        g.fillRect(0, 0, sheet.width, sheet.height);
        const tmp = new OffscreenCanvas(size, size), tg = tmp.getContext('2d')!;
        CARD_KINDS.forEach((k, i) => {
          const { color, height } = paintCard(k, size);
          [color, height].forEach((img, row) => {
            tg.putImageData(img, 0, 0);
            g.drawImage(tmp, i * size, row * size);
          });
        });
        await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: sheet.toDataURL('image/png') });
        return name;
      },
      /** Median frames per second over the last few seconds. */
      fps: () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0),
      /** Milliseconds since navigation until the data arrived, the ground textures were in, and the first frame was ready. */
      get timings() {
        return { data: mark('valley-data'), ground: mark('valley-ground'), trees: mark('valley-trees'), scene: mark('valley-scene'), ready: mark('valley-ready') };
      },
    },
  });
}

// ---------- start ----------
const loading = openLoading(ui);
let world: World | null = null;
try {
  world = await start(loading.step, loading.say);
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
