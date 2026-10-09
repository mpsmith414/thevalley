import { NeutralToneMapping, PerspectiveCamera, Scene, type WebGPURenderer } from 'three/webgpu';
import { BuilderClient } from '../builder/client';
import { FreeFly, intentFrom, toggleDown, type FlyIntent } from '../camera/freefly';
import { Glide, viewpointPose } from '../camera/viewpoints';
import { compileTogether } from '../render/compile';
import { startQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { Input } from '../shared/input';
import { remember, stored } from '../shared/settings';
import { CAST } from '../cast';
import { CREATURE_LAYER, Residents } from '../residents/residents';
import { loadValley } from '../valley/cache';
import { VALLEY } from '../valley/layout';
import { DEFAULT_GRID } from '../valley/types';
import { createValley } from '../valley/valley';
import { createBackdrop } from '../world/backdrop';
import { ValleyClock, elevationDeg, moonDirection, moonPhase, sunDirection } from '../world/clock';
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
import { createWind, gustAt, setWind, updateWind, windUniforms } from '../plants/wind';
import { IMPOSTOR_LAYER, bakeImpostors, createImpostorLayer } from '../plants/impostor';
import { GROUND_COVER_LAYER, createGroundCover, loadFlowerCards } from '../plants/grass';
import { createSoundscape, silentSoundscape, type Soundscape } from '../audio/soundscape';
import { isLake, listenerPlace } from '../audio/place';
import { openLoading, toast } from './loading';
import type { Loop } from './dev';
import { showLabel, type SpeedId } from './menu';
import { menuControl, setSpeed } from './menu-control';
import { gpuDone, pacing, type Pacing } from './pacing';
import { openStart } from './start';
import './valley.css';

/** The lake's mirror shows the forest only within this many metres of the shore (beyond, the lake is a sliver on screen). */
const MIRROR_PLANTS = 400;
/** Seconds from the page opening to the performance mark `name` (one decimal). */
const seconds = (name: string) => ((performance.getEntriesByName(name)[0]?.startTime ?? NaN) / 1000).toFixed(1);
/** Metres from (x, z) to the nearest point of the lake's outline. */
const lakeDistance = (x: number, z: number) => VALLEY.lake.outline.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.z - z)), Infinity);

// ---------- settings (remembered per browser) ----------
// Quality: a tier, or Auto (the default), which starts on High, measures the frame rate once and keeps its pick for next time
const quality = startQuality(stored<unknown>('valley.tier', 'auto'), stored<unknown>('valley.autoTier', null));
const tier: Tier = quality.tier;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

/** Everything up to the first frame: the renderer, the Valley (from the cache or the worker), the scene, compiled. */
async function start(step: Parameters<typeof loadValley>[2], say: (text: string) => void) {
  // the sound: its context starts suspended (until the start screen's press) while the recordings load with everything else;
  // sound is a nicety, so if the browser cannot make any the valley goes on in silence
  let audio: AudioContext | null = null, sound: Soundscape;
  try {
    audio = new AudioContext();
    sound = createSoundscape(audio);
  } catch (e) {
    console.warn('sound: no audio in this browser; the valley will be silent', e);
    void audio?.close().catch(() => {});
    audio = null;
    sound = silentSoundscape();
  }
  const ground = loadGroundSets(tier); // photo textures download and decode while the valley is made
  // the animals' bodies build in the builder's worker while the valley is made (the residents pick them up from its cache)
  const builder = new BuilderClient();
  CAST.forEach((c) => void builder.build(c.recipe).catch(() => {}));
  const plantTex = Promise.all([ground.then(() => loadBarkSets()), loadCards(tier === 'high' ? 512 : 256), loadFlowerCards(tier === 'high' ? 256 : 128)]); // bark after the ground: one decode at a time
  const [{ renderer, backend }, { data, cached }] = await Promise.all([
    createRenderer(canvas, tier).then((r) => (watchDeviceLoss(r.renderer), performance.mark('valley-renderer'), r)),
    loadValley(VALLEY, DEFAULT_GRID, step).then((r) => (performance.mark('valley-loaded'), r)),
  ]);
  // Neutral, not the Lab's AgX: AgX greyed the valley's greens and blues and, with the haze on top, washed the middle distance
  // out to a pale blue-grey. The lighting table's exposures are tuned for Neutral.
  renderer.toneMapping = NeutralToneMapping;
  performance.mark('valley-data');
  say('Rolling out the meadows…');
  const sets = await ground;
  performance.mark('valley-photos');
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
  setSpeed(clock, stored<SpeedId>('valley.speed', 'normal'));
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
  performance.mark('valley-built');
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
  performance.mark('valley-cover');
  // Shadow casters by cascade (about 0–75, 75–154, 154–260 and 260–600 m on High): near plants (within ~60 m) in the first two,
  // mid plants (from ~60 m) in all but the first, where only the mid trees (a tree at 60–75 m shades the ground under the near
  // camera) are drawn, not the mid shrubs, logs and stumps (which cast no shadow anyway). The impostors (from ~210 m) in the
  // last two (they cast on High only). The land everywhere.
  const NEAR = 1 << NEAR_LAYER, MID = 1 << MID_LAYER, MID_TREE = 1 << MID_TREE_LAYER, IMP = 1 << IMPOSTOR_LAYER, CREATURE = 1 << CREATURE_LAYER;
  // Mid trees in the nearest cascade cost ~1.8 ms at the forest floor for a barely visible gain (low sun only), so they
  // stay out for now; flip this on if the frame budget allows after the residents and ground cover are in.
  const MID_TREES_IN_CASCADE_0 = false;
  // The animals cast in the first two, like the near plants, once their shaders are ready (see `wakeAnimals`).
  const cascades = (animals: number) => [1 | NEAR | animals | (MID_TREES_IN_CASCADE_0 ? MID_TREE : 0), 1 | NEAR | animals | MID, 1 | MID | IMP, 1 | MID | IMP];
  sky.cascadeLayers(cascades(0));

  // ---------- the resident animals ----------
  say('Waking the animals…');
  const residents = new Residents(valley, VALLEY, builder, tier, scene);
  // the animals are optional: if a body will not build, the valley opens without (some of) them
  await residents.spawn().catch((e) => console.error('the animals could not be made', e));
  performance.mark('valley-animals');
  /**
   * The animals' shaders (about 3 s of compiling, beside the plants') build in the background once the valley is up, and the animals pop in
   * when they are ready: until then neither the camera nor the shadows see their layer, so nothing compiles mid-frame.
   */
  const wakeAnimals = async () => {
    const eye = camera.clone();
    eye.layers.enable(CREATURE_LAYER);
    await residents.compile(() => compileTogether(renderer, residents.object, eye, scene));
    camera.layers.enable(CREATURE_LAYER);
    sky.cascadeLayers(cascades(CREATURE));
    // their shadow pipelines too, which `compileAsync` cannot make: on the next frame, before it is drawn, one render of only
    // the animals from a stand-in camera (its own shadow passes; the frame's real render then draws over it)
    const shadowEye = camera.clone();
    shadowEye.layers.set(CREATURE_LAYER);
    warm = () => {
      shadowEye.copy(camera);
      shadowEye.layers.set(CREATURE_LAYER);
      sky.redrawShadows(); // even if the key light is out
      residents.warmShadows(camera, () => renderer.render(scene, shadowEye));
    };
    performance.mark('valley-animals-shown');
  };
  let warm: (() => void) | null = null; // a one-off job for the start of the next frame's render (see `wakeAnimals`)

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
  let waiting = true; // the start screen is up: the controls wait for it (see `release`)
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

  // ---------- the pause menu: Start or Esc opens and closes it, B goes back; the world runs on behind it ----------
  const menu = menuControl({ ui, clock, sound, choice: quality.choice, tier, light, waiting: () => waiting });
  input.onPress = (b, repeat) => {
    if (waiting) return; // the start screen comes first
    if (menu.press(b, repeat) || repeat) return; // a held arrow key must not restart the glide
    if (b === 'left') goTo(current); // current is 0-based: n = current is the previous viewpoint
    else if (b === 'right') goTo(current + 2);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || waiting) return;
    if (/^[1-8]$/.test(e.key)) {
      if (!menu.open) goTo(+e.key);
    } else if (e.key === 'm' || e.key === 'M') {
      menu.toggleMute();
      toast(ui, sound.muted ? 'Sound off' : 'Sound on', 1200);
    }
  });
  canvas.addEventListener('click', () => (canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {}));

  /** No input: the camera eases to a stop while the menu has the controls. */
  const STILL: FlyIntent = { move: { x: 0, y: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, fast: false, toggleWalk: false };
  /** One frame of camera control: gamepad and keys in, a glide or a free-fly step out (camera input waits while the menu is open). */
  const drive = (dt: number) => {
    const open = !!menu.open;
    input.poll(dt, open);
    if (waiting) return;
    const pad = input.pad(), held = (k: string) => input.held(k), mouse = input.mouse();
    const intent = open ? STILL : intentFrom(pad, held, mouse, dt, wasToggle);
    wasToggle = toggleDown(pad, held);
    if (glide) {
      const stirred = !open && (pad.lx !== 0 || pad.ly !== 0 || pad.rx !== 0 || pad.ry !== 0 || ['w', 'a', 's', 'd'].some(held));
      if (!stirred) {
        glide.t += dt;
        const s = glide.g.sample(glide.t);
        setPose(s);
        if (s.done) {
          glide = null;
          if (!open) showLabel(ui, views[current].name); // arrived (no label over the menu)
        }
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

  // ---------- the soundscape follows the camera, the hour and the wind ----------
  const place = listenerPlace(valley, isLake(valley, VALLEY.lake.level));
  let soundFailed = false;
  /** Mix the sound for the camera; a failure is reported once and never stops the frame. */
  const hear = (dt: number) => {
    try {
      sound.update(listener(), dt);
    } catch (e) {
      if (!soundFailed) console.warn('sound: the mix failed this frame', e);
      soundFailed = true;
    }
  };
  /** The camera as the soundscape's listener. */
  const listener = () => {
    const { x, y, z } = camera.position, hour = clock.hour;
    return { pos: { x, y, z }, hour, sunElevation: elevationDeg(sunDirection(hour)), gust: gustAt(wind, x, z), strength: wind.strength, ...place(x, y, z) };
  };

  const tick = (dt: number) => {
    clock.update(dt);
    drive(dt);
    plants.fade.eye.value.copy(camera.position); // the trees' mid/far cross-fade follows the camera
    terrain.update(camera);
    updateWind(wind, dt, VALLEY.seed);
    setWind(windU, wind);
    veg.update(camera, dt);
    cover.update(camera);
    residents.update(dt, camera, clock.hour);
    light(dt);
    hear(dt);
    if (warm) {
      const job = warm;
      warm = null;
      job();
    }
  };
  tick(0);
  light(Infinity);
  performance.mark('valley-scene');
  // What the opening view shows compiles behind the loading screen, then one frame is drawn (its shadow passes make
  // pipelines of their own); everything else compiles in the background once the valley is up (see `compileRest`).
  await compileTogether(renderer, scene, camera);
  renderer.render(scene, camera);
  await gpuDone(renderer)?.();
  performance.mark('valley-ready');
  console.info(`valley: ready ${seconds('valley-ready')} s after the page opened (${cached ? 'from the cache' : 'made fresh'})`);
  /**
   * Every plant and ground-cover material (not just those in the opening view), the night sky and the animals, compiled in the background
   * while the start screen is up (about 4 s). A plant whose pipeline is still compiling is skipped until it is ready, so
   * a quick flight down may see the ground cover and near plants arrive a moment late, but nothing stalls a frame.
   */
  const compileRest = async () => {
    const plants = veg.compile(() => cover.compile(() => sky.withNight(() => compileTogether(renderer, scene, camera))));
    await Promise.all([plants.then(() => performance.mark('valley-plants')), wakeAnimals()]);
    console.info(`valley: every plant and animal compiled ${(performance.now() / 1000).toFixed(1)} s after the page opened`);
  };
  /** The start screen has gone: hand the controls over. */
  let later: string | null = null; // a label waiting for the start screen to go
  /** Show a label now, or once the start screen has gone. */
  const label = (text: string) => (waiting ? (later = text) : showLabel(ui, text));
  const release = () => {
    waiting = false;
    if (later) showLabel(ui, later);
    later = null;
  };
  return { renderer, backend, data, cached, valley, scene, camera, sky, clock, light, tex, sets, terrain, backdrop, lake, river, view, goTo, fly, input, tick,
    wind, veg, plants, bake, impostors, cover, residents, compileRest, audio, sound, listener, release, label, showMenu: menu.show, closeMenu: menu.close, menu: () => menu.open };
}
export type World = Awaited<ReturnType<typeof start>>;

// ---------- the loop ----------
/** The live loop's dev controls: `step` freezes the world, `heavy` adds busy work per frame, `onFrame` samples the fps, `onDrawn` times frames. */
const loop: Loop = { paused: false, heavy: 0, onFrame: null, onDrawn: null };

function run(w: World, pace: Pacing) {
  let last = performance.now();
  w.renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    loop.onFrame?.(dt);
    if (loop.heavy > 0) while (performance.now() - t0 < loop.heavy); // dev: a forced heavy frame
    if (!loop.paused) w.tick(dt);
    if (canvas.width > 0) w.renderer.render(w.scene, w.camera);
    if (!loop.paused && canvas.width > 0) pace.frame(dt, t0); // real frames only
    loop.onDrawn?.(now, performance.now() - t0);
  });
}

// ---------- start ----------
const loading = openLoading(ui);
let loadingOpen = true, failed = false;
/** The friendly failure screen with "Try again" (on the loading screen, or a new one once that has gone), shown once. */
const fail = (message: string) => {
  if (failed) return;
  failed = true;
  (loadingOpen ? loading : openLoading(ui)).fail(message);
};
/** The GPU went away (a driver reset, the GPU process crashing): stop drawing and offer to try again. */
function watchDeviceLoss(renderer: WebGPURenderer) {
  const report = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    report(info);
    void renderer.setAnimationLoop(null);
    fail('The picture got stuck for a moment. Shall we try again?');
  };
}
let world: World | null = null;
try {
  world = await start(loading.step, loading.say);
} catch (e) {
  console.error('the valley could not start', e);
  fail('The valley got a bit tangled while we were making it. Shall we try again?');
}
if (world) {
  const w = world;
  const pace = pacing({
    renderer: w.renderer, min: WORLD_QUALITY[tier].minScale, tier, measure: quality.measure, done: gpuDone(w.renderer),
    remember: (pick) => remember('valley.autoTier', pick), label: w.label,
  });
  if (import.meta.env.DEV) (await import('./dev')).devHooks(w, pace, loop, { canvas, ui, tier, quality });
  run(w, pace);
  loading.close();
  loadingOpen = false;
  const animals = w.compileRest().catch((e) => console.error('the plants or the animals could not compile', e));
  if (w.audio) await openStart(ui, w.audio); // one press wakes the sound (skipped when the browser already lets it play)
  w.release();
  // Auto measures only now the start screen has gone and the animals' shaders are built (after a 1 s settle): loading
  // stalls must not count against the computer
  void animals.then(() => pace.startAuto());
  if (world.cached) toast(ui, 'Welcome back!');
}
