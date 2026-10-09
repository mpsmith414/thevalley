import { NeutralToneMapping, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { BuilderClient } from '../builder/client';
import { FreeFly, intentFrom, toggleDown, type FlyIntent } from '../camera/freefly';
import { Glide, viewpointPose } from '../camera/viewpoints';
import { AutoPick, startQuality, type QualityChoice, type Tier } from '../render/quality';
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
import { ResolutionScaler } from '../world/resolution';
import { MID_LAYER, MID_TREE_LAYER, NEAR_LAYER, VegetationTiles } from '../world/tiles';
import { createPlantMaterials, loadBarkSets, loadCards, setPlantLight } from '../plants/material';
import { createWind, gustAt, setWind, updateWind, windUniforms } from '../plants/wind';
import { IMPOSTOR_LAYER, bakeImpostors, createImpostorLayer } from '../plants/impostor';
import { GROUND_COVER_LAYER, createGroundCover, loadFlowerCards } from '../plants/grass';
import { createSoundscape, silentSoundscape, type Soundscape } from '../audio/soundscape';
import { isLake, listenerPlace } from '../audio/place';
import { openLoading, toast } from './loading';
import { SPEEDS, openMenu, showLabel, tierLabel, type Menu, type MenuState, type SpeedId } from './menu';
import { openStart } from './start';
import './valley.css';

/** The lake's mirror shows the forest only within this many metres of the shore (beyond, the lake is a sliver on screen). */
const MIRROR_PLANTS = 400;
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
  /** Set the clock to a speed from the menu (Paused stops it and keeps the speed it had). */
  const setSpeed = (id: SpeedId) => {
    const s = SPEEDS.find((x) => x.id === id);
    if (!s) return;
    clock.paused = id === 'paused';
    if (s.speed > 0) clock.speed = s.speed;
  };
  setSpeed(stored<SpeedId>('valley.speed', 'normal'));
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
   * The animals' shaders (about 8 s of compiling) build in the background once the valley is up, and the animals pop in
   * when they are ready: until then neither the camera nor the shadows see their layer, so nothing compiles mid-frame.
   */
  const wakeAnimals = async () => {
    const eye = camera.clone();
    eye.layers.enable(CREATURE_LAYER);
    await residents.compile(() => renderer.compileAsync(residents.object, eye, scene));
    camera.layers.enable(CREATURE_LAYER);
    sky.cascadeLayers(cascades(CREATURE));
    performance.mark('valley-animals-shown');
  };

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
  let menu: Menu | null = null;
  const menuState = (): MenuState => ({ speed: clock.speed, paused: clock.paused, quality: quality.choice, tier, volume: sound.volume, muted: sound.muted });
  const closeMenu = () => {
    menu?.close();
    menu = null;
  };
  const toggleMute = () => {
    sound.mute(!sound.muted);
    menu?.update(menuState());
  };
  const showMenu = () => {
    if (menu || waiting) return;
    if (document.pointerLockElement) document.exitPointerLock(); // hand the mouse back for the buttons
    menu = openMenu(ui, menuState(), {
      resume: closeMenu,
      time: (hour, label) => {
        clock.jumpTo(hour);
        light(Infinity);
        closeMenu(); // straight back to the valley to see the new light
        showLabel(ui, label);
      },
      speed: (id) => {
        setSpeed(id);
        remember('valley.speed', id);
        menu?.update(menuState());
      },
      quality: (q: QualityChoice) => {
        if (q === quality.choice) return;
        remember('valley.tier', q);
        if (q === 'auto') remember('valley.autoTier', null); // Auto measures afresh
        location.reload(); // the tier shapes the whole world: build it again (cached, so quick), like the lab does
      },
      volume: (d) => {
        if (sound.muted) sound.mute(false);
        sound.setVolume(Math.round((sound.volume + d) * 10) / 10);
        menu?.update(menuState());
      },
      mute: toggleMute,
      lab: () => (location.href = '/lab.html'),
    });
  };
  const toggleMenu = () => (menu ? closeMenu() : showMenu());

  input.onPress = (b, repeat) => {
    if (waiting) return; // the start screen comes first
    if (menu) {
      if (b === 'start') return void (repeat || closeMenu());
      return menu.press(b, repeat);
    }
    if (repeat) return; // a held arrow key must not restart the glide
    if (b === 'start') showMenu();
    else if (b === 'left') goTo(current); // current is 0-based: n = current is the previous viewpoint
    else if (b === 'right') goTo(current + 2);
  };
  // Esc toggles the menu (like Start). `Input` maps Esc to B, so it is caught first, in the capture phase, and goes no further.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || waiting) return; // the start screen's own handler takes it
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) toggleMenu();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || waiting) return;
    if (/^[1-8]$/.test(e.key)) {
      if (!menu) goTo(+e.key);
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
      toast(ui, sound.muted ? 'Sound off' : 'Sound on', 1200);
    }
  });
  canvas.addEventListener('click', () => (canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {}));
  // The browser keeps Esc for itself while the mouse is captured (it lets the mouse go and the page never sees the key), so
  // losing the capture opens the menu, as the press meant. (Opening the menu lets go of it too, with the menu already up.)
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !menu && !waiting) showMenu();
  });

  /** No input: the camera eases to a stop while the menu has the controls. */
  const STILL: FlyIntent = { move: { x: 0, y: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, fast: false, toggleWalk: false };
  /** One frame of camera control: gamepad and keys in, a glide or a free-fly step out (camera input waits while the menu is open). */
  const drive = (dt: number) => {
    input.poll(dt, !!menu);
    if (waiting) return;
    const pad = input.pad(), held = (k: string) => input.held(k), mouse = input.mouse();
    const intent = menu ? STILL : intentFrom(pad, held, mouse, dt, wasToggle);
    wasToggle = toggleDown(pad, held);
    if (glide) {
      const stirred = !menu && (pad.lx !== 0 || pad.ly !== 0 || pad.rx !== 0 || pad.ry !== 0 || ['w', 'a', 's', 'd'].some(held));
      if (!stirred) {
        glide.t += dt;
        const s = glide.g.sample(glide.t);
        setPose(s);
        if (s.done) {
          glide = null;
          showLabel(ui, views[current].name); // arrived
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
  };
  tick(0);
  light(Infinity);
  performance.mark('valley-scene');
  await veg.compile(() => cover.compile(() => renderer.compileAsync(scene, camera))); // every plant material, not just those in view now
  performance.mark('valley-ready');
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
    wind, veg, plants, bake, impostors, cover, residents, wakeAnimals, audio, sound, listener, release, label, showMenu, closeMenu, menu: () => menu };
}
type World = Awaited<ReturnType<typeof start>>;

// ---------- the loop ----------
let paused = false; // dev: `step` freezes the world
let onFrame: ((dt: number) => void) | null = null; // dev: fps samples
let heavy = 0; // dev: extra milliseconds of busy work per frame (to check the dynamic resolution)

/**
 * Dynamic resolution and Auto quality, fed by the live loop's real frames only (the dev `step` freezes them and resets the
 * scale). Auto measures first, at full resolution (a lowered resolution would flatter the frame rate); then the scaler runs.
 * The scale only ever changes the pixel ratio, and `resize` only the CSS size, so the two never undo each other.
 */
function pacing(w: World) {
  const base = w.renderer.getPixelRatio(), min = WORLD_QUALITY[tier].minScale;
  let scaler = new ResolutionScaler(min), applied = 1;
  let auto = quality.measure ? new AutoPick() : null;
  const recent: number[] = []; // the last second or two of working times (for the dev hook)
  const apply = () => {
    if (scaler.scale === applied) return;
    applied = scaler.scale;
    w.renderer.setPixelRatio(base * applied);
  };
  return {
    base,
    get scale() {
      return applied;
    },
    /** One real frame: its interval `dt` (s) and its cost (ms, see `run`), for Auto and then the scaler. */
    frame(dt: number, workMs: number) {
      if (auto) {
        const pick = auto.push(dt, workMs / 1000);
        if (!pick) return;
        auto = null;
        // Auto keeps its pick for next time. It never reloads mid-play: this visit carries on (the scaler holds the frame
        // rate meanwhile) and the next one starts on the pick.
        remember('valley.autoTier', pick);
        if (pick !== tier) w.label(`Next time: ${tierLabel(pick)} quality`);
        return;
      }
      scaler.push(workMs);
      apply();
      recent.push(workMs);
      if (recent.length > 120) recent.shift();
    },
    /** Back to full resolution with a fresh history. */
    reset() {
      scaler = new ResolutionScaler(min);
      apply();
    },
    /** Median working time (ms) of the last frames the scaler saw. */
    get workMs() {
      return recent.length ? [...recent].sort((a, b) => a - b)[recent.length >> 1] : NaN;
    },
    /** Still measuring for Auto? */
    get measuring() {
      return !!auto;
    },
  };
}
type Pacing = ReturnType<typeof pacing>;

/**
 * What a frame cost: the shorter of its interval and its working time (from its start to the GPU finishing it; WebGPU only).
 * The interval alone is capped by the screen (on a 60 Hz screen it never drops below 16.7 ms, so the scaler could never see
 * a light frame and come back to full resolution, and Auto could not tell a fast computer from a capped screen); the working
 * time alone counts the GPU's queue of earlier frames when frames overlap (it read 21 ms at 85 fps).
 */
const gpuDone = (w: World): (() => Promise<unknown>) | null => {
  const device = (w.renderer.backend as { device?: GPUDevice }).device;
  return device ? () => device.queue.onSubmittedWorkDone() : null;
};

function run(w: World, pace: Pacing) {
  let last = performance.now();
  const done = gpuDone(w);
  w.renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    onFrame?.(dt);
    if (heavy > 0) while (performance.now() - t0 < heavy); // dev: a forced heavy frame
    if (!paused) w.tick(dt);
    if (canvas.width > 0) w.renderer.render(w.scene, w.camera);
    if (paused || canvas.width === 0 || dt <= 0) return;
    if (!done) return pace.frame(dt, dt * 1000);
    void done().then(() => !paused && pace.frame(dt, Math.min(dt * 1000, performance.now() - t0)), () => {});
  });
}

// ---------- dev hooks (checks in the browser) ----------
function devHooks(w: World, pace: Pacing) {
  const { renderer, scene, camera, tick, clock, light } = w;
  const fps: number[] = [];
  onFrame = (dt) => {
    if (dt > 0) fps.push(1 / dt);
    if (fps.length > 240) fps.shift();
  };
  /** Render now and save the frame as .shots/<name>.png (works even when the window is hidden). */
  const shot = async (name: string) => {
    pace.reset(); // full resolution (the live loop's scaler takes over again after)
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
    pace.reset();
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
    if (!paused) pace.reset(); // full resolution for the shots that follow
    paused = true;
    for (let i = 0; i < frames; i++) tick(dt);
  };
  const fpsNow = () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0);
  const mark = (name: string) => Math.round(performance.getEntriesByName(name)[0]?.startTime ?? NaN);
  Object.assign(window, {
    __valley: {
      ...w, tier, step, shot, screen, pace,
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
      /** The residents themselves (`residents` below lists them as plain data). */
      animals: w.residents,
      /** Each resident animal: species, position, action and update band. */
      get residents() {
        return w.residents.info();
      },
      /** Frame the camera on resident `i`, `dist` m away (by default a few body lengths), `turn` radians round from its left side. */
      lookAt: (i: number, dist?: number, turn = 0.5, rise = 0.25) => {
        const a = w.residents.animals[i];
        if (!a) return null;
        const size = a.recipe.life.sizeM, root = a.obj.root.position;
        const c = new Vector3(root.x, root.y + size * 0.35, root.z), r = dist ?? Math.max(1.6, size * 2.6);
        const dir = a.rig.yaw + Math.PI / 2 + turn;
        const p = new Vector3(c.x + Math.sin(dir) * r, c.y + r * rise, c.z + Math.cos(dir) * r);
        const floor = w.valley.isWater(p.x, p.z) ? w.valley.waterLevelAt(p.x, p.z) : w.valley.heightAt(p.x, p.z);
        p.y = Math.max(p.y, floor + 0.25);
        const d = c.clone().sub(p);
        Object.assign(w.fly, { pos: { x: p.x, y: p.y, z: p.z }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), vel: { x: 0, y: 0, z: 0 }, walk: false });
        w.fly.apply(camera);
        return w.residents.info()[i];
      },
      /** The soundscape now: the audio context's state, volume, what each layer plays, its current gains and the listener's place. */
      audio: () => {
        const r = (v: number) => Math.round(v * 1000) / 1000, g = w.sound.gains(), l = w.listener();
        return {
          state: w.audio?.state ?? 'unavailable', volume: w.sound.volume, muted: w.sound.muted, sources: w.sound.sources(),
          gains: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, r(v)])),
          listener: { hour: r(l.hour), sun: r(l.sunElevation), height: r(l.heightAboveGround), lake: r(l.lakeDistance), river: r(l.riverDistance), slope: r(l.riverSlope), forest: r(l.forestAround), gust: r(l.gust), strength: r(l.strength) },
        };
      },
      /** Master volume 0..1, and mute (as the menu sets them). */
      volume: (v: number) => (w.sound.setVolume(v), w.sound.volume),
      mute: (on = true) => (w.sound.mute(on), w.sound.muted),
      /** Open or close the pause menu (as Start or Esc does); `menu()` is the open one, or null. */
      openMenu: w.showMenu, closeMenu: w.closeMenu,
      /** The dynamic resolution now: the scale, the pixel ratio and the drawing size (and whether Auto is still measuring). */
      get resolution() {
        return { scale: Math.round(pace.scale * 1000) / 1000, base: pace.base, pixelRatio: w.renderer.getPixelRatio(), size: [canvas.width, canvas.height], measuring: pace.measuring, workMs: Math.round(pace.workMs * 10) / 10, fps: Math.round(fpsNow()) };
      },
      /** Add `ms` of busy work to every live frame (0 to stop): a forced heavy view for checking the scaler. */
      heavy: (ms: number) => (heavy = ms),
      /** The quality setting and the tier running. */
      quality: { ...quality, picked: stored<unknown>('valley.autoTier', null) },
      /** Median frames per second over the last few seconds. */
      fps: fpsNow,
      /** Milliseconds since navigation until the data arrived, the ground textures were in, and the first frame was ready. */
      get timings() {
        return { data: mark('valley-data'), ground: mark('valley-ground'), trees: mark('valley-trees'), scene: mark('valley-scene'), animals: mark('valley-animals'), ready: mark('valley-ready'), animalsShown: mark('valley-animals-shown') };
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
  const pace = pacing(world);
  if (import.meta.env.DEV) devHooks(world, pace);
  run(world, pace);
  loading.close();
  world.wakeAnimals().catch((e) => console.error('the animals could not wake', e));
  if (world.audio) await openStart(ui, world.audio); // one press wakes the sound (skipped when the browser already lets it play)
  world.release();
  if (world.cached) toast(ui, 'Welcome back!');
}
