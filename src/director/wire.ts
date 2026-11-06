/**
 * The Director in the running valley: it sees the animals through the residents and the simulation (built once a frame,
 * only while the documentary runs), keeps the stories from the simulation's moments, and owns the documentary's
 * per-frame call, its idle timer, the handover of the player's hands, the narrator's voice and words, the clock's
 * hold, and the pre-warm (the second eye readying a far spot, for the documentary's far cuts and the invitation cards).
 * In free flight it keeps the stories up to date for the cards (src/app/moments-ui.ts shows them). `main.ts` creates it
 * and ticks it; the controls send it the presses, keys and clicks; the drive, the sticks.
 */
import { PerspectiveCamera, type Camera } from 'three/webgpu';
import { LINES } from './lines';
import { pickLine, RecentLines, type LineCtx } from './lines/pick';
import type { TraitTag } from './lines/types';
import { docUi } from './doc-ui';
import { DocClock, Documentary, type Narrator } from './documentary';
import { Handover, IdleTimer } from './idle';
import { peekVantage, type Warm } from './invite';
import { Pacer } from './pacing';
import { Planner, type LineCue } from './planner';
import { scoreStory } from './score';
import { StoryBook } from './stories';
import { subtitleView, wordsOnlySeconds } from './subtitles';
import type { AgentView, DirectorWorld, Story } from './types';
import { VoiceClient } from './voice';
import { CREATURE_LAYER, type Residents } from '../residents/residents';
import type { Button } from '../shared/input';
import { subject } from '../sim/moments';
import { HIGH, type Moment } from '../sim/types';
import { mulberry32 } from '../util/rng';
import type { Vec3 } from '../util/vec';
import type { Valley } from '../valley/valley';
import type { Viewpoint } from '../valley/types';
import { MID_LAYER, NEAR_LAYER } from '../world/tiles';
import type { Pose } from '../views/types';
import type { Views } from '../views/views';
import type { ViewsWire } from '../views/wire';
import { elevationDeg, sunDirection, type ValleyClock } from '../world/clock';

/** The documentary's settings (the menu's Documentary page changes them as the documentary runs; `main.ts` loads the remembered ones). */
export type DocSettings = { idle: '3' | '10' | 'off'; narrator: Narrator; timelapses: boolean; invitations: boolean };
/** Until the remembered ones are loaded: it starts by itself after 3 minutes, speaks with the voice and the words, and plays time-lapses. */
export const DOC_DEFAULTS: DocSettings = { idle: '3', narrator: 'voice', timelapses: true, invitations: true };
/** The night, for the Director: the sun more than 6° below the horizon (as a night time-lapse ends at −6°). */
export const NIGHT_DEG = -6;
/** A flier counts as up in the air (for the "flier" lines) above this height (m). */
const AIRBORNE_M = 1;
/** Where the last 200 lines heard are remembered. */
const RECENT_KEY = 'valley.director.recent';
/** While the documentary is off the stories are brought up to date (and the stale let go) this often (real s). */
const BOOK_EVERY_S = 0.5;
/** A card's second eye is ready this long (s) after it is set. */
const WARM_LEAD_S = 1.5;
/** A pre-warm with no size given frames a spot this big (m): the documentary's cuts in the black. */
const WARM_SIZE_M = 6;

/** What the Director needs from the valley's wiring. */
export type DirectorDeps = {
  ui: HTMLElement;
  valley: Valley;
  camera: PerspectiveCamera;
  residents: Residents;
  clock: ValleyClock;
  /** The arrival's and the reins' holds on the clock: the documentary's own fits round them. */
  holds: { arrival: { held: boolean; remembered: { speed: number; paused: boolean } | null; playerChanged(): void; hold(): void };
    reins: { remembered: { speed: number; paused: boolean } | null } };
  views: Views;
  viewsWire: ViewsWire;
  viewpoints: readonly Viewpoint[];
  sound: { duck(on: boolean): void; output: AudioNode | null };
  audio: AudioContext | null;
  /** A release arrival has the camera. */
  arrivalActive(): boolean;
  /** The workshop has the screen. */
  workshop(): boolean;
  /** The menu is open. */
  menuOpen(): boolean;
  /** Something else has the screen (the start screen, the menu, the workshop, an arrival): the idle timer waits. */
  away(): boolean;
  /** The player last used the keyboard. */
  keys(): boolean;
  /** A glide under way ends (the documentary takes the camera from the start). */
  endGlide(): void;
  /** The invitation card goes (the documentary has the screen, and the second eye, from the start). */
  endInvitation(): void;
  /**
   * The peek, whose camera is the second eye while its spot is banded for it (a pre-warm's end leaves that alone), and
   * its `prime` (draw an eye's view once, unseen, as the peek draws).
   */
  peek: { readonly eye: Camera | null; prime(eye: Camera): void };
};

/** The animals as the Director sees them, built at most once a frame and only when asked (see `DirectorWorld`). */
class ValleyWorld implements DirectorWorld {
  now = 0;
  hours = 12;
  night = false;
  sunElevation = 90;
  camera: Vec3 = { x: 0, y: 0, z: 0 };
  readonly viewpoints: readonly Viewpoint[];
  private list: AgentView[] | null = null;
  private byId = new Map<string, AgentView>();

  constructor(private readonly d: DirectorDeps) {
    this.viewpoints = d.viewpoints;
  }

  /** A new frame: the clock, the sun and the camera now; the animals are read afresh when next asked for. */
  next(now: number): void {
    const hour = this.d.clock.hour, p = this.d.camera.position;
    this.now = now;
    this.hours = hour;
    this.sunElevation = elevationDeg(sunDirection(hour));
    this.night = this.sunElevation < NIGHT_DEG;
    this.camera = { x: p.x, y: p.y, z: p.z };
    this.list = null;
  }

  ground(x: number, z: number): number {
    return this.d.valley.heightAt(x, z);
  }

  agent(id: string): AgentView | null {
    this.agents();
    return this.byId.get(id) ?? null;
  }

  agents(): readonly AgentView[] {
    if (this.list) return this.list;
    const { residents, valley } = this.d, sim = residents.sim, list: AgentView[] = [];
    this.byId.clear();
    if (!sim) return (this.list = list);
    const groups = new Map<string, number>(), hunts = new Map<string, boolean>();
    for (const a of residents.animals) {
      const g = sim.get(a.id)?.group;
      if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    for (const a of residents.animals) {
      const g = sim.get(a.id);
      if (!g) continue;
      const t = sim.traits(a.species), who = residents.speciesName(a.species), p = a.obj.root.position;
      let hunter = hunts.get(a.species);
      if (hunter === undefined) hunts.set(a.species, (hunter = sim.preyOf(a.species).length > 0));
      const v: AgentView = {
        id: a.id, species: a.species, name: who.name, native: who.native, released: !who.native, doing: g.doing, group: g.group,
        focus: g.focus, pos: { x: p.x, y: p.y, z: p.z }, size: a.recipe.life.sizeM, bodyLength: a.rig.bodyLength,
        flying: g.motion.flying, altitude: g.motion.altitude, swimmer: t.swimmer, wet: valley.isWater(p.x, p.z), hunter,
        grazer: t.grazer, plural: (g.group ? groups.get(g.group) ?? 0 : 0) > 1,
      };
      list.push(v);
      this.byId.set(a.id, v);
    }
    return (this.list = list);
  }
}

/** What kind of place a point is, for the lines: on the water, the meadow, the forest or the rocks (or none of them). */
function placeAt(valley: Valley, x: number, z: number): LineCtx['place'] {
  if (valley.isWater(x, z)) return 'water';
  const b = valley.biomeAt(x, z);
  return b.meadow >= 0.4 ? 'meadow' : b.forest >= 0.3 ? 'forest' : b.rock >= 0.4 ? 'rock' : undefined;
}

/** The traits a line may speak of: a flier only while it is up in the air, and a group or alone. */
function traitsOf(a: AgentView, plural: boolean): TraitTag[] {
  const t: TraitTag[] = [plural ? 'group' : 'alone'];
  if (a.flying && a.altitude > AIRBORNE_M) t.push('flier');
  if (a.swimmer) t.push('swimmer');
  if (a.hunter) t.push('hunter');
  if (a.grazer) t.push('grazer');
  return t;
}

/**
 * What the narrator knows when choosing words for a cue: scenery has no one in it (no species, no traits); a hunt's lines
 * are about the hunter, with its prey; anything else is about the story's lead animal (a group when the story has more
 * than one). A released creature is named by its own name, and never gets a native's species notes.
 */
export function lineCtx(c: LineCue, w: DirectorWorld, place: (x: number, z: number) => LineCtx['place']): LineCtx {
  const s = c.story, ctx: LineCtx = { traits: [], hours: w.hours, place: place(s.at.x, s.at.z) };
  if (s.kind === 'scenery') return ctx;
  const h = s.hunt, lead = h ? w.agent(h.hunter)
    : ((s.subject !== null ? w.agent(s.subject) : null) ?? s.actors.map((id) => w.agent(id)).find((a) => a) ?? null);
  if (!lead) return ctx;
  const plural = h ? lead.plural : s.actors.length > 1;
  ctx.who = { name: lead.name, native: lead.native, plural };
  if (lead.native) ctx.species = lead.species;
  ctx.traits = traitsOf(lead, plural);
  ctx.place = place(lead.pos.x, lead.pos.z);
  const prey = h?.prey ? w.agent(h.prey) : null;
  if (prey) ctx.prey = { name: prey.name, native: prey.native, plural: false };
  return ctx;
}

/** The last lines heard, kept in localStorage (a store that cannot be read or written is only a nicety lost). */
const recentStore = {
  get(): string[] {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  set(ids: string[]): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
    } catch {
      /* private window, full storage: forget */
    }
  },
};

/**
 * "Watch the documentary" from the menu: from any mode but an arrival it lets go of a lock, the reins or the map first
 * (free flight has the camera), then starts. Returns false, and does nothing, during an arrival; while the documentary
 * already runs it does nothing either (its shot goes on). (LB and P are free flight only.)
 */
export function watchFromMenu(o: { arrival: boolean; on: boolean; mode: string; letGo(): void; start(): void }): boolean {
  if (o.arrival) return false;
  if (o.on) return true;
  if (o.mode !== 'free') o.letGo();
  o.start();
  return true;
}

/** The Director wired into the valley (see the file's note). */
export function createDirector(d: DirectorDeps) {
  const { valley, residents, clock, views, viewsWire, holds } = d;
  const settings: DocSettings = { ...DOC_DEFAULTS };
  const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  const world = new ValleyWorld(d);
  const book = new StoryBook();
  /** Who hears of each story as its moment happens (the invitation cards). */
  const told = new Set<(s: Story, m: Moment) => void>();
  // the moments still going on as the valley opens, then each as it happens
  for (const m of residents.sim?.moments.now(clock.hours) ?? []) book.offer(m, 0);
  residents.sim?.moments.on((m) => {
    const s = book.offer(m, now);
    if (s) for (const fn of told) fn(s, m);
  });
  const planner = new Planner({ world: valley, rng, timelapses: () => settings.timelapses, stories: () => book.list() });
  const voice = new VoiceClient({ fetch: (...a) => fetch(...a), ctx: d.audio, out: d.sound.output });
  void voice.check();
  const subtitles = subtitleView(d.ui);
  const recent = new RecentLines(recentStore);
  const place = (x: number, z: number) => placeAt(valley, x, z);
  const docClock = new DocClock(clock);
  const doc = new Documentary({
    views, planner, book, voice, pacer: new Pacer(), ui: docUi(d.ui), subtitles, sound: d.sound,
    lines: {
      pick: (c) => {
        const line = pickLine(LINES, c.beat, lineCtx(c, world, place), recent, rng);
        if (line) recent.add(line.id);
        return line;
      },
    },
    clock: {
      hold: () => docClock.hold(holds.arrival.remembered ?? holds.reins.remembered),
      fastest: (on) => docClock.fastest(on),
      release: () => {
        docClock.release();
        // taken over during an arrival: it plays on at Normal, and gives back the player's speed when it is over
        if (holds.arrival.held) (holds.arrival.playerChanged(), holds.arrival.hold());
      },
    },
    arrivalActive: d.arrivalActive, workshop: d.workshop, narrator: () => settings.narrator, keys: d.keys,
    prewarm: (at) => prewarm(at, WARM_SIZE_M, true),
  });
  const hands = new Handover({
    get on() {
      return doc.on;
    },
    takeOver: (how) => {
      doc.takeOver(how);
      if (how === 'lock' && views.state.mode !== 'free') viewsWire.poke(); // locked on: the views' hints show, as for a lock by hand
    },
  });
  const idle = new IdleTimer(() => (settings.idle === 'off' ? null : settings.idle === '10' ? 600 : 180));
  /** Real seconds since the valley began (the frames' dt, so `step` moves it too). */
  let now = 0;
  /** Frames the Director has seen (for a warm's readiness in the black). */
  let ticks = 0;
  /** There was input since the last frame (for the idle timer). */
  let touched = false;
  /** When the stories were last brought up to date while the documentary was off. */
  let booked = -Infinity;

  /** The second eye while a pre-warm holds it, and which pre-warm does (one at a time). */
  const warmEye = new PerspectiveCamera(), primeEye = new PerspectiveCamera();
  let warmBy: object | null = null;
  /**
   * Ready the spot round `at` (framed for something `size` m across) before it is seen: the second eye looks at it from a
   * vantage (the animals there banded and woken, the plants there banded in; nothing is drawn) until `done`, and is
   * `ready` WARM_LEAD_S later (a card's), or, for the documentary's cut in the black (`inBlack`), as soon as two frames have
   * run with the eye set: the animals' waking and banding and the plants' refill all happen in the first (the long frame, unseen).
   * `done` gives the second eye back, unless the peek has taken it meanwhile (the card's peek
   * opens on the warmed spot first). One owner at a time: the documentary's far cuts, or (in free flight, so never while
   * the documentary runs) an invitation card. A card also asks `prime`: the eye's view drawn once, unseen (part 0 the
   * animals, part 1 the plants, a frame apart), so the still's frame finds them uploaded (Ruling R14).
   */
  const prewarm = (at: Vec3, size = WARM_SIZE_M, inBlack = false): Warm => {
    console.assert(!warmBy && !d.peek.eye, 'the second eye has one owner at a time');
    const pose = peekVantage({ pos: at, size }, valley, { sun: sunDirection(clock.hour), rng }), c = d.camera;
    Object.assign(warmEye, { fov: c.fov, aspect: c.aspect, near: c.near, far: c.far });
    warmEye.updateProjectionMatrix();
    warmEye.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    warmEye.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    warmEye.updateMatrixWorld();
    residents.setSecondEye(warmEye);
    const me = {}, from = now, tick = ticks;
    warmBy = me;
    return {
      pose,
      ready: () => (inBlack ? ticks - tick >= 2 : now - from >= WARM_LEAD_S),
      prime: (part) => {
        if (warmBy !== me) return;
        primeEye.copy(warmEye);
        primeEye.layers.set(part === 0 ? CREATURE_LAYER : NEAR_LAYER);
        if (part === 1) primeEye.layers.enable(MID_LAYER);
        d.peek.prime(primeEye);
      },
      done: () => {
        if (warmBy !== me) return;
        warmBy = null;
        if (!d.peek.eye) residents.setSecondEye(null);
      },
    };
  };

  /** Start the documentary (a glide under way ends, and the invitation card goes: it has the camera now). */
  const start = () => {
    if (doc.on) return;
    d.endGlide();
    d.endInvitation();
    doc.start();
  };

  /** Speak `text` now (the voice once it is ready, up to 8 s; else words only): a dev hook. */
  const say = async (text: string) => {
    voice.prefetch(text);
    for (let i = 0; i < 80 && voice.available !== 'no'; i++) {
      const r = voice.play(text, () => (subtitles.show(null), d.sound.duck(false)));
      if (r.spoken) return (subtitles.show(text), d.sound.duck(true), 'spoken');
      await new Promise((go) => setTimeout(go, 100));
    }
    subtitles.show(text);
    setTimeout(() => subtitles.show(null), wordsOnlySeconds(text) * 1000);
    return 'words only';
  };

  return {
    settings,
    /** Whether the narrator's voice can be had on this computer (unknown until it has been asked). */
    get voiceAvailable() {
      return voice.available;
    },
    /** Whether the documentary is running. */
    get on() {
      return doc.on;
    },
    /** The stories as their moments happen (each medium or high moment, with the story it makes or carries on). */
    stories: { on: (fn: (s: Story, m: Moment) => void) => (told.add(fn), () => void told.delete(fn)) },
    prewarm,
    /** The second eye while a pre-warm holds it (the plants band for it too), else null. */
    get warmEye(): Camera | null {
      return warmBy ? warmEye : null;
    },
    start,
    /** The menu's Watch (see `watchFromMenu`): false during an arrival. */
    watchFromMenu: () => watchFromMenu({ arrival: d.arrivalActive(), on: doc.on, mode: views.state.mode, letGo: () => views.letGo(), start }),
    /** End the documentary (a glide the player asked for begins): free flight from where the camera is. Nothing if off. */
    stop: () => doc.takeOver('free'),
    /** A press (a controller button, or a key that sends one): true when the documentary used it (to take over). */
    press(b: Button, fromKey: boolean): boolean {
      touched = true;
      return hands.press(b, fromKey);
    },
    /** Any other key, or a click: true when the documentary used it. */
    other(): boolean {
      touched = true;
      return hands.other();
    },
    /** The sticks and the mouse this frame (`any`: moved): true when they go nowhere else. */
    hands(any: boolean): boolean {
      touched ||= any;
      return hands.hands(any);
    },
    /** The player picked a speed in the menu: theirs to have back when the documentary ends. */
    speedPicked: () => docClock.playerChanged(),
    /** What the save keeps while the documentary holds the clock: the player's speed (null: not held). */
    get clockRemembered() {
      return docClock.remembered;
    },
    /**
     * One frame of `dt` real seconds, before the views move the camera (`from`: its pose now): the menu over it, the idle
     * timer (free flight or the map, nothing else on the screen), then the documentary's frame while it runs.
     */
    frame(dt: number, from: Pose) {
      now += dt;
      const menu = d.menuOpen(), mode = views.state.mode;
      doc.menu(menu);
      // the menu up counts as input: closing it after a long browse starts the wait afresh
      if (idle.update(dt, { input: touched || menu, counts: !doc.on && !d.away() && (mode === 'free' || mode === 'map') })) start();
      touched = false;
      viewsWire.quiet = doc.on;
      if (!doc.on) {
        // where each story is now and whether it goes on (for the cards), and the stale ones let go: whatever the mode
        // and the settings, so the book never grows over a long session
        if (now - booked >= BOOK_EVERY_S) {
          booked = now;
          world.next(now);
          book.update(world);
        }
        return;
      }
      world.next(now);
      ticks++;
      doc.frame(dt, world, from);
    },
    /** The dev hooks (`__valley.director`). */
    dev: {
      start: () => (start(), 'on'),
      stop: () => (doc.takeOver('free'), 'off'),
      /** Skip to the next scene. */
      next: () => doc.skip(),
      /** The stories, scored as the Director sees them now (best first). */
      stories: () => {
        world.next(now);
        const ctx = { now, camera: world.camera, night: world.night, recent: { species: [], tags: [], places: [] } };
        return book.list().map((s) => ({ id: s.id, kind: s.kind, tag: s.tag, live: s.live, interest: s.interest, score: scoreStory(s, ctx), hunt: s.hunt?.beat ?? null }))
          .sort((a, b) => b.score - a.score);
      },
      say,
      /** A time-lapse now (the documentary starts if it is off). */
      timelapse: () => (start(), planner.timelapse(), 'time-lapse'),
      /** A story about animal `id` for an invitation card now, and its line (null: no such animal): `__valley.director.peek`. */
      cardFor: (id: string): { story: Story; line: string } | null => {
        world.next(now);
        const a = world.agent(id);
        if (!a) return null;
        const story: Story = { id: `look:${id}`, kind: 'event', tag: 'herd', subject: id, actors: [id], species: [a.species],
          at: { x: a.pos.x, z: a.pos.z }, interest: HIGH, born: now, live: true, released: a.released, hunt: null };
        return { story, line: `${subject({ name: a.name, native: a.native, plural: false })}.` };
      },
      planner, book, voice,
    },
  };
}
/** The Director's wiring (see `createDirector`). */
export type Director = ReturnType<typeof createDirector>;
