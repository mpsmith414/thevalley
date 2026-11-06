import { NeutralToneMapping, PerspectiveCamera, Scene, type Object3D, type WebGPURenderer } from 'three/webgpu';
import { BuilderClient } from '../builder/client';
import { viewpointPose } from '../camera/viewpoints';
import { compileTogether } from '../render/compile';
import { NEUTRAL_GRADE, setGrade } from '../render/grade';
import { waterLight } from '../render/lens';
import { createPeek, peekRect } from '../render/peek';
import { surfaceAt } from '../camera/freefly';
import { createPost } from '../render/post';
import { startQuality, type Tier } from '../render/quality';
import { createRenderer } from '../render/renderer';
import { Input } from '../shared/input';
import { remember, stored } from '../shared/settings';
import { CAST } from '../cast';
import { CREATURE_LAYER, Residents, SELF_LAYER, speciesDefs } from '../residents/residents';
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
import { createBring } from '../bring/bring';
import { joinCard } from '../bring/card';
import { createStudio } from '../bring/studio';
import { Heartbeat } from '../views/fear';
import { viewsHud } from '../views/hud';
import { MAP_NIGHT_EXPOSURE, nightGrade, places } from '../views/map';
import { MapView } from '../views/map-view';
import { ReinsClock } from '../views/reins';
import { DANGER_RED, SHIMMER_GOLD, createRing } from '../views/ring';
import { createRippleMesh } from '../views/ripples';
import { SHARP_MAX } from '../views/sharp';
import { TRAIL_LAYER, createTrailMesh } from '../views/trail-mesh';
import { Views } from '../views/views';
import { ViewsWire } from '../views/wire';
import { comeBack, HOLD_CAP, keepMade, placeHomeless, releaseMade, sendExploring, visit, type ReleaseDeps } from '../bring/release';
import { connectWorkshop, sendEnd, TRY_AGAIN, Workshop, workshopView } from '../bring/workshop';
import { CreatureList } from '../creatures/list';
import { api } from '../designer/api';
import { newId } from '../lab/gallery';
import { designCreature, tweakCreature } from '../designer/loop';
import { openLoading, toast } from './loading';
import type { Made } from '../bring/workshop';
import type { Loop } from './dev';
import { HOMES } from '../sim/homes';
import { daylight } from '../sim/senses';
import { SAVE_VERSION, ValleySaves, reconcile, type SaveFile } from '../sim/save';
import { showLabel, type SpeedId } from './menu';
import { valleyPage } from './valley-page';
import { menuControl, setSpeed } from './menu-control';
import { ReleaseTimeHold, animalRate } from './time';
import { gpuDone, pacing, type Pacing } from './pacing';
import { openStart } from './start';
import { createCameraDrive } from './camera-drive';
import { createControls } from './controls';
import { createMomentsUi } from './moments-ui';
import { CAMERA_FOV } from '../director/shots';
import { readDocSettings, saveDocSettings } from '../director/settings';
import { createDirector } from '../director/wire';
import './valley.css';

/** The lake's mirror shows the forest only within this many metres of the shore (beyond, the lake is a sliver on screen). */
const MIRROR_PLANTS = 400;
/** The valley's life is saved this often (real milliseconds), and when the page is hidden or closed. */
const AUTOSAVE_MS = 60_000;
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
  void Promise.allSettled(CAST.map((c) => builder.build(c.recipe))).then(() => {
    performance.mark('valley-bodies');
    console.info(`valley: bodies ready ${seconds('valley-bodies')} s after the page opened (${builder.stats.cached} of ${CAST.length} from the cache)`);
  });
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
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 8000);
  // every frame of the valley goes through the post pipeline (MSAA, bloom, tone mapping, grade); the shadow warm-up, the
  // impostor bakes and the lake's mirror still draw straight with the renderer
  const post = createPost(renderer, scene, camera, tier);

  const tex = valleyTextures(data);
  const terrain = createTerrain(tex, tier, sets);
  const backdrop = createBackdrop(data, VALLEY.seed);
  scene.add(terrain.object, backdrop);

  // ---------- time of day: the clock drives the sun, moon, sky, light and fog ----------
  const clock = new ValleyClock();
  setSpeed(clock, stored<SpeedId>('valley.speed', 'normal'));
  const timeHold = new ReleaseTimeHold(clock);
  /** The clock while the player steers an animal: Normal, unpaused, and the player's speed back after (spec section 1). */
  const reinsClock = new ReinsClock();
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
  // (an animal seen through its own eyes moves to SELF_LAYER: off the camera, still in the shadows)
  const NEAR = 1 << NEAR_LAYER, MID = 1 << MID_LAYER, MID_TREE = 1 << MID_TREE_LAYER, IMP = 1 << IMPOSTOR_LAYER, CREATURE = (1 << CREATURE_LAYER) | (1 << SELF_LAYER);
  // Mid trees in the nearest cascade cost ~1.8 ms at the forest floor for a barely visible gain (low sun only), so they
  // stay out for now; flip this on if the frame budget allows after the residents and ground cover are in.
  const MID_TREES_IN_CASCADE_0 = false;
  // The animals cast in the first two, like the near plants, once their shaders are ready (see `wakeAnimals`).
  const cascades = (animals: number) => [1 | NEAR | animals | (MID_TREES_IN_CASCADE_0 ? MID_TREE : 0), 1 | NEAR | animals | MID, 1 | MID | IMP, 1 | MID | IMP];
  sky.cascadeLayers(cascades(0));

  // ---------- the resident animals, and the families released into the valley ----------
  say('Waking the animals…');
  const residents = new Residents(valley, VALLEY, HOMES, builder, tier, scene);
  const views = VALLEY.viewpoints;
  const start0 = viewpointPose(views[views.length - 1], valley); // Valley Overview, where the camera starts
  // the creature list is the lab's gallery database: creatures released there (with no home yet, Ruling P3) get one in
  // front of the start view now; without the list (no IndexedDB, or an older lab tab holding it at version 1, which
  // would stop the upgrade until it is closed) the valley opens with its natives and nothing can be released
  const list = await CreatureList.open().catch((e) => (console.error('the creature list could not be opened (an older lab tab open? close it and reload)', e), null));
  const startView = { eye: start0.pos, forward: { x: -Math.sin(start0.yaw), z: -Math.cos(start0.yaw) } };
  const released = list
    ? await list.released().then((items) => placeHomeless(items, { list, valley, camera: () => startView })).catch((e) => (console.error('the released creatures could not be read', e), []))
    : [];
  // the saved valley (IndexedDB, optional like the list): the clock and the animals carry on where they were, unless the save
  // is of another valley or cannot be carried on; then, and with no save, the valley starts afresh
  const saves = await ValleySaves.open().catch((e) => (console.warn('the valley cannot be saved here', e), null));
  const saved = (await saves?.load().catch((e) => (console.warn('the saved valley could not be read', e), null))) ?? null;
  let carried = false;
  if (saved && saved.sim.seed === VALLEY.seed) {
    try {
      await residents.spawn(released, reconcile(saved.sim, speciesDefs(HOMES, released), valley));
      ({ hours: clock.hours, speed: clock.speed, paused: clock.paused } = saved.clock);
      carried = true;
    } catch (e) {
      console.error('the saved valley could not be carried on; the valley starts afresh', e);
      residents.clear(); // any bodies it joined before the throw: the fresh spawn makes its own
    }
  }
  // the animals are optional: if a body will not build, the valley opens without (some of) them
  if (!carried) await residents.spawn(released).catch((e) => console.error('the animals could not be made', e));
  performance.mark('valley-animals');
  // the peek: a small live picture of somewhere else (the invitation card's), drawn by a second camera into a corner
  const peek = createPeek({ renderer, scene, camera, post, residents, terrain, fade: plants.fade, lake, tier });
  /**
   * The valley's life as it is now. While the documentary, an arrival or the reins hold the clock, the player's own speed
   * is what is kept (the documentary's first: it keeps the player's even when it started during an arrival; then the
   * arrival's: it was held first when both it and the reins are).
   */
  const life = (): SaveFile => ({
    kind: 'valley-save', version: SAVE_VERSION, savedAt: Date.now(),
    clock: { hours: clock.hours, ...(director.clockRemembered ?? timeHold.remembered ?? reinsClock.remembered ?? { speed: clock.speed, paused: clock.paused }) }, sim: residents.sim.state(),
  });
  /** Off while the valley is being started again or a backup restored: the page reloads next, and must not write the old state back. */
  let saving = true;
  const autosave = () => {
    if (saves && residents.sim && saving) saves.save(life()).catch((e) => console.warn('the valley could not be saved', e));
  };
  setInterval(autosave, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && autosave());
  window.addEventListener('pagehide', autosave);
  /**
   * The animals' shaders (about 3 s of compiling, beside the plants') build in the background once the valley is up, and the animals pop in
   * when they are ready: until then neither the camera nor the shadows see their layer, so nothing compiles mid-frame.
   */
  const wakeAnimals = async () => {
    const eye = camera.clone();
    eye.layers.enable(CREATURE_LAYER);
    eye.layers.enable(TRAIL_LAYER);
    // the highlight's and the danger's rings compile with them (they are drawn on their layer; Sharp eyes' share their
    // pipeline), and Smell's trails and Hearing's ripples (one of each)
    const senses = [ring, threatRing, trails, ripples];
    for (const r of senses) r.object.visible = true;
    trails.object.count = ripples.object.count = 1;
    const ringDone = Promise.all(senses.map((r) => compileTogether(renderer, r.object, eye, scene)));
    for (const r of senses) r.object.visible = false;
    trails.object.count = ripples.object.count = 0;
    await residents.compile(() => Promise.all([compileTogether(renderer, residents.object, eye, scene), compileTogether(renderer, residents.shadows, eye, scene), ringDone]));
    camera.layers.enable(CREATURE_LAYER);
    sky.cascadeLayers(cascades(CREATURE));
    // their shadow pipelines too, which `compileAsync` cannot make: on the next frame, before it is drawn, one render of only
    // the animals from a stand-in camera (its own shadow passes; the frame's real render then draws over it)
    warmShadows();
    performance.mark('valley-animals-shown');
  };
  let warm: (() => void) | null = null; // a one-off job for the start of the next frame's render (see `wakeAnimals`)

  let waterTime = 0; // seconds the water has run (its own clock, so `step` moves it too)
  /** The cooled grade the overview map shows at night. */
  const nightLook = structuredClone(NEUTRAL_GRADE);
  /** Light the world for the clock's current time; `dt = Infinity` snaps the exposure and environment (after a jump). */
  const light = (dt: number) => {
    const hour = clock.hour, sun = sunDirection(hour), moon = moonDirection(clock.hours);
    const state = lightingAt(hour, sun, moon, moonPhase(clock.hours));
    sky.update(state, sun, moon, camera, clock.hours, dt);
    setGrade(post.grade, sky.grade); // the grade eases with the exposure (in the sky), into the post's uniforms
    // the map's own light at night: the exposure lifted and the grade cooled, as far as the map is up and the night is dark
    const night = cam.mapLift() * (1 - daylight(elevationDeg(sun)));
    if (night > 0) {
      renderer.toneMappingExposure *= 1 + (MAP_NIGHT_EXPOSURE - 1) * night;
      setGrade(post.grade, nightGrade(sky.grade, night, nightLook));
    }
    if (Number.isFinite(dt)) waterTime += dt;
    lake.update(waterTime, state, wind);
    waterLight(state, post.lens.waterLight.value); // for the look from under the water (Eyes)
    setPlantLight(plants.light, state);
    river.update(waterTime, state);
  };

  // ---------- the camera: free-fly, with gliding viewpoints (see camera-drive.ts) ----------
  const input = new Input();
  let waiting = true; // the start screen is up: the controls wait for it (see `release`)
  // ---------- the views: lock on to an animal and ride along (Follow, Close, Eyes); see src/views ----------
  const ring = createRing(valley, CREATURE_LAYER), threatRing = createRing(valley, CREATURE_LAYER, DANGER_RED);
  // Smell's scent trails, on a layer of their own: the camera draws it, the mirror and the shadow cascades do not
  const trails = createTrailMesh(valley, windU);
  // Hearing's ripples (on the trails' layer) and Sharp eyes' shimmer rings
  const ripples = createRippleMesh(valley), shimmers = Array.from({ length: SHARP_MAX }, () => createRing(valley, CREATURE_LAYER, SHIMMER_GOLD));
  scene.add(ring.object, threatRing.object, trails.object, ripples.object, ...shimmers.map((r) => r.object));
  camera.layers.enable(TRAIL_LAYER);
  const viewer = new Views({ world: valley, animal: (id) => residents.viewAnimal(id), say: (text) => showLabel(ui, text), now: () => performance.now(), mapPose: () => mapView.pose });
  // the overview map's screen (its mouse let go quietly: the menu stays shut)
  const mapView = new MapView({
    views: viewer, camera, world: valley, size: valley.size, places: places(VALLEY), animals: () => residents.onMap(), ui, canvas,
    keys: () => input.using === 'keys', now: () => performance.now(), freeMouse: () => menu.quietRelease(), blocked: () => !!menu.open || shop.showing,
  });
  const wire = new ViewsWire({
    views: viewer, world: valley, camera, animals: residents, ring, hud: viewsHud(ui), keys: () => input.using === 'keys', now: () => performance.now(),
    screen: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }),
    lens: post.lens, daylight: () => daylight(elevationDeg(sunDirection(clock.hour))),
    sensing: (id) => residents.sensing(id), threatRing, smell: { mesh: trails, scents: (id) => residents.scents(id), time: () => residents.sim.time }, heartbeat: audio && sound.output ? new Heartbeat(audio, sound.output) : undefined,
    hearing: { mesh: ripples, heard: (id) => residents.hearing(id) },
    sharp: { rings: shimmers, sightings: (id, light) => residents.sightings(id, light) },
    map: mapView,
    reins: {
      steer: (id, input) => residents.sim.steer(id, input), time: () => residents.sim.time,
      heading: (id) => residents.sim.get(id)?.motion.yaw ?? null,
      flies: (id) => {
        const g = residents.sim.get(id);
        return !!g && residents.sim.traits(g.species).canFly;
      },
      take: () => reinsClock.take(clock), give: () => reinsClock.give(clock),
    },
  });
  const cam = createCameraDrive({
    valley, camera, residents, viewer, wire, mapView, input, timeHold, ui, start: start0, viewpoints: views, waiting: () => waiting, open: () => !!menu.open || shop.showing,
    rate: () => animalRate(clock), chime: () => sound.chime(), hands: (any) => director.hands(any), playerGlide: () => director.stop(),
  });
  /** A released family's bodies, compiled detached from the valley but lit by it, before anyone sees them. */
  const compileFamily = (root: Object3D) => {
    const eye = camera.clone();
    eye.layers.enable(CREATURE_LAYER);
    return compileTogether(renderer, root, eye, scene);
  };
  /**
   * On the next frame, one render of only the animals (one of each species) from a stand-in camera, for their shadow passes.
   * It is drawn as the picture draws (`peek.prime`), so the shaders three builds for them then are the picture's: the main
   * view's first sight of each kind (and the peek's) costs far less (Lake Shore's first frame 457 ms against 912, the herd
   * close up 231 against 420, the wolves 74 against 259, on the owner's PC).
   */
  const warmShadows = () => {
    const shadowEye = camera.clone();
    warm = () => {
      shadowEye.copy(camera);
      shadowEye.layers.set(CREATURE_LAYER);
      sky.redrawShadows(); // even if the key light is out
      residents.warmShadows(camera, () => peek.prime(shadowEye));
    };
  };
  const releaseDeps: ReleaseDeps | null = list && {
    list, residents, valley, glideTo: cam.glideTo, arriveAt: cam.arriveAt, hold: cam.holdFor, cancel: cam.cancelArrival, compile: compileFamily, warm: warmShadows, now: () => Date.now(), newId,
    camera: () => ({ eye: { ...cam.fly.pos }, forward: { x: -Math.sin(cam.fly.yaw), z: -Math.cos(cam.fly.yaw) } }),
  };

  // ---------- the pause menu: Start or Esc opens and closes it, B goes back; the world runs on behind it ----------
  // the phones: the valley hosts them (it registers once the start screen is through, in the loading code at the end)
  const bring = createBring(joinCard(ui));
  // the workshop: when a phone's turn comes the valley dims and the studio makes the creature (spec §3.2-3.5)
  const shop = workshopView(ui, (parent) => createStudio(parent, tier));
  const workshop = new Workshop({
    design: designCreature, tweak: tweakCreature, api, build: (r) => builder.build(r), studio: shop.studio,
    send: (t, m) => bring.send(t, m), ui: shop, now: () => performance.now(),
  });
  type Outcome = 'released' | 'kept' | 'failed';
  /** Tell the phone how its turn ended (`failed`, with Try again, when nothing could be saved); once more if it did not go. */
  const tell = (token: string, o: Outcome) => sendEnd((t, m) => bring.send(t, m), token, o === 'failed' ? { type: 'failed', message: TRY_AGAIN, retry: true } : { type: o });
  /** Releases and Come backs under way, from the stage closing to the camera's hold on the arrival (the join card waits, Ruling R21). */
  let arriving = 0;
  const arrive = async <T>(f: () => Promise<T>): Promise<T> => {
    arriving++;
    try {
      return await f();
    } finally {
      arriving--;
    }
  };
  const hooks = {
    /**
     * Release: the stage fades out (0.6 s) while the creature is saved and its family compiled, the camera glides to the
     * arrival and the family walks in (spec §3.4). A family that cannot come leaves the creature kept: "let's try again".
     */
    onRelease: (made: Made): Promise<Outcome> => arrive(async () => {
      shop.close();
      let outcome: Outcome = 'failed';
      try {
        if (!releaseDeps) throw new Error('no creature list');
        outcome = (await releaseMade(made, releaseDeps)).valley ? 'released' : 'kept';
      } catch (e) {
        console.error('release: the creature could not be saved', e);
      }
      if (outcome !== 'released') toast(ui, TRY_AGAIN, 3000);
      await tell(made.token, outcome);
      return outcome;
    }),
    /** Ruling R17: a new turn waits until the arrival's camera hold is over (HOLD_CAP s at most, even with no frames drawn). */
    ready: () => Promise.race([cam.arrival.idle(), new Promise<void>((go) => setTimeout(go, HOLD_CAP * 1000))]),
    /** The workshop takes the screen: no menu over it, and the mouse let go so Esc reaches the page (it is Back here). */
    opening: () => {
      menu.close();
      if (document.pointerLockElement) document.exitPointerLock();
    },
    /** Back/Escape, the relay's cancel or a restarted relay with a creature made: kept, for the lab. */
    onKept: async (made: Made): Promise<Outcome> => {
      let outcome: Outcome = 'kept';
      try {
        if (!list) throw new Error('no creature list');
        await keepMade(made, { list, now: () => Date.now(), newId });
      } catch (e) {
        console.error('workshop: the creature could not be kept', e);
        outcome = 'failed';
      }
      await tell(made.token, outcome);
      return outcome;
    },
  };
  const linked = connectWorkshop(bring, workshop, hooks);
  /** Back/Escape while the workshop shows: stop it (kept if something was made), or close a "try again". */
  const back = () => (workshop.busy ? void linked.back() : shop.close());
  // the menu stays shut while the workshop shows, and while a turn waits to open it (Ruling R17), so B cannot cancel it
  // ---------- the Director: the documentary, when the controller is put down (LB / P, or by itself); see src/director ----------
  const director = createDirector({
    ui, valley, camera, residents, clock, holds: { arrival: timeHold, reins: reinsClock }, views: viewer, viewsWire: wire, viewpoints: views,
    sound, audio, arrivalActive: () => cam.arrival.active, workshop: () => shop.showing, menuOpen: () => !!menu.open,
    away: () => waiting || !!menu.open || shop.showing || arriving > 0 || cam.arrival.active, keys: () => input.using === 'keys', endGlide: () => cam.endGlide(),
    endInvitation: () => moments.closeCard(true), peek,
  });
  Object.assign(director.settings, readDocSettings()); // the remembered Documentary page choices
  // ---------- the moments: invitation cards in free flight (Go there), the quiet caption line while watching an animal ----------
  const moments = createMomentsUi({
    ui, moments: residents.sim?.moments, free: () => viewer.state.mode === 'free',
    invites: residents.sim ? {
      stories: director.stories, peek, prewarm: director.prewarm, documentary: () => director.on,
      animal: (id) => residents.viewAnimal(id)?.pose ?? null, ground: (x, z) => surfaceAt(valley, x, z), camera: () => camera.position,
      rect: () => peekRect({ w: canvas.clientWidth || canvas.width, h: canvas.clientHeight || canvas.height }), // where the peek lays its picture
      hint: () => (input.using === 'pad' ? 'X Go there' : 'F Go there'),
    } : undefined,
  });
  const menu = menuControl({ ui, clock, sound, documentary: {
      watch: () => void (director.watchFromMenu() || showLabel(ui, 'The documentary starts once the creature has arrived')),
      get: () => ({ ...director.settings, invitations: moments.captions.get() }),
      set: (s) => {
        Object.assign(director.settings, s); // the documentary reads them as it goes
        saveDocSettings(s); // (the moment captions' own switch is the invitations: it reads the same key)
        if (s.invitations !== undefined) moments.captions.switchTo(s.invitations);
      },
      voice: () => director.voiceAvailable,
    }, valley: saves && list ? valleyPage({ ui, saves, list, save: () => (residents.sim ? saves.save(life()) : Promise.resolve()), saving: (on) => (saving = on) }) : undefined, speedPicked: () => (timeHold.playerChanged(), reinsClock.playerChanged(), director.speedPicked()), choice: quality.choice, tier, light, bring, waiting: () => waiting, busy: () => shop.showing || linked.waiting,
    opened: () => viewer.reins(false), // the lock holds behind the menu; the reins hand back
    escape: () => viewer.state.mode === 'map' && controls.viewsDo('closeMap'), // on the map (its mouse free) Esc closes it
    creatures: releaseDeps ? {
      all: () => releaseDeps.list.all(), visit: (id) => visit(id, releaseDeps), explore: (id) => sendExploring(id, releaseDeps),
      comeBack: (id) => arrive(() => comeBack(id, releaseDeps)), say: (text) => showLabel(ui, text),
    } : undefined,
  });
  const controls = createControls({
    ui, canvas, input, clock, timeHold, residents, viewer, wire, cam, menu, moments, director, waiting: () => waiting, workshop: () => shop.showing, back, muted: () => sound.muted,
  });

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
    cam.drive(dt);
    // the arrival is over: the player's speed comes back (once the reins, if taken since, have given theirs back first)
    if (arriving === 0 && !cam.arrival.active && !reinsClock.held) timeHold.release();
    director.frame(dt, { pos: { ...cam.fly.pos }, yaw: cam.fly.yaw, pitch: cam.fly.pitch }); // the documentary's shot, before the views move the camera
    residents.update(dt * animalRate(clock), dt, camera, clock.hours); // the animals live at the clock's speed (none when paused)
    cam.ride(dt); // the views ride along with the animals as they are now
    plants.fade.eye.value.copy(camera.position); // the trees' mid/far cross-fade follows the camera
    terrain.update(camera);
    updateWind(wind, dt, VALLEY.seed);
    setWind(windU, wind);
    veg.update(camera, dt, director.warmEye ?? peek.eye); // a pre-warm's camera (a card's holds until its still is taken), or the peek's, is the plants' second eye
    cover.update(camera);
    shop.turn(dt);
    // the cards and captions wait while something else has the screen (the menu, the workshop, a release arriving, the start screen) or are off
    const away = waiting || !!menu.open || shop.showing || arriving > 0 || cam.arrival.active || director.on; // the narrator has the caption's place
    moments.frame(dt, away);
    bring.setStage(shop.showing || arriving > 0 || cam.arrival.active); // Ruling R21: the join card waits for the stage and the arrival
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
  post.render(); // also compiles the pipeline's own quad materials, still behind the loading screen
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
  return { renderer, post, backend, data, cached, valley, scene, camera, sky, clock, light, tex, sets, terrain, backdrop, lake, river, view: cam.view, goTo: cam.goTo, fly: cam.fly, input, tick,
    wind, veg, plants, bake, impostors, cover, residents, peek, compileRest, audio, sound, listener, release, label, bring, showMenu: menu.show, closeMenu: menu.close, menu: () => menu.open,
    builder, shop, workshop, hooks, list,
    arrival: cam.arrival, views: viewer, viewsWire: wire, mapView, quietRelease: menu.quietRelease, director, moments };
}
export type World = Awaited<ReturnType<typeof start>>;

// ---------- the loop ----------
/** The live loop's dev controls: `step` freezes the world, `heavy` adds busy work per frame, `onFrame` samples the fps, `onDrawn` times frames. */
const loop: Loop = { paused: false, heavy: 0, onFrame: null, onDrawn: null };

function run(w: World, pace: Pacing) {
  let last = performance.now(), frameNo = 0;
  w.renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    loop.onFrame?.(dt);
    if (loop.heavy > 0) while (performance.now() - t0 < loop.heavy); // dev: a forced heavy frame
    if (!loop.paused) w.tick(dt);
    if (canvas.width > 0) {
      w.peek.frame(frameNo++); // before the main picture, which lays it into its corner
      w.post.render();
    }
    w.shop.render(); // the workshop's stage, on its own canvas
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
  void w.bring.start(); // the phones can join now; this waits for no one and never delays the valley
  // Auto measures only now the start screen has gone and the animals' shaders are built (after a 1 s settle): loading
  // stalls must not count against the computer
  void animals.then(() => pace.startAuto());
  if (world.cached) toast(ui, 'Welcome back!');
}
