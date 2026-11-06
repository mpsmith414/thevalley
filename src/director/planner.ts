/**
 * The documentary's director at work: which story to film next, and how, shot by shot. A scene is one story filmed as a
 * short run of shots: a calm one (establishing, tracking or a group's orbit, close, maybe a glimpse through its eyes,
 * tracking again), a hunt for as long as it runs (close on the creep, wide on the chase, a cut-away before the catch,
 * the prey on an escape), or a time-lapse when the valley is quiet. It also says when the narrator should speak. Pure:
 * the documentary turns its shots into the views, the clock and the voice.
 */
import { HIGH } from '../sim/types';
import { between } from '../util/rng';
import { movePose, type Move } from '../views/directed';
import type { FollowOpts } from '../views/follow';
import type { Pose } from '../views/types';
import type { ViewName } from '../views/views';
import { NIGHT_TAGS, pickScene, placeOf, type ScoreCtx } from './score';
import { cutaway, establishing, group, joinOf, lapse, trackingFraming, viewSpot, vista } from './shots';
import { DAWN_DEG, nightLapseOver, wantTimelapse } from './timelapse';
import type { AgentView, DirectorWorld, LineBeat, Story } from './types';
import type { VantageWorld } from './vantage';

/** The kinds of shot (spec §2's table). */
export type ShotKind = 'establishing' | 'tracking' | 'behind' | 'close' | 'eyes' | 'group' | 'cutaway' | 'timelapse';
/**
 * One shot: what kind, how long it is meant to last (s), the story it films, the animal it is on (or none), and how it
 * joins the last (a hard cut, an eased switch, or a dip through black). A shot riding an animal names its `view` (and
 * a tracking shot its Follow `framing`); a directed shot carries its `move`. `clock` 'fastest' is a time-lapse's; left
 * out, the clock is at Normal.
 */
export type Shot = { kind: ShotKind; s: number; story: string; subject: string | null; join: 'cut' | 'ease' | 'dip';
  view?: ViewName; framing?: FollowOpts; move?: Move; clock?: 'normal' | 'fastest' };
/** A moment for the narrator to speak: what about, and the story it belongs to. */
export type LineCue = { beat: LineBeat; story: Story };

/** A scene's opening line comes this many seconds into its first shot, so the picture lands first. */
export const OPENER_AT_S = 2;
/** A calm scene lasts 30–75 s. */
const CALM_S: [number, number] = [30, 75];
/** The calm scene's shots (s): establishing, then tracking or group, close, the eyes' glimpse, and the last at the least. */
const ESTABLISH_S: [number, number] = [6, 10], MIDDLE_S: [number, number] = [10, 20], CLOSE_S: [number, number] = [6, 10],
  EYES_S: [number, number] = [4, 6], LAST_MIN_S = 6;
/** How often a calm scene glimpses through the eyes, and how often a herd or family is filmed as a group. */
const EYES_CHANCE = 0.5, GROUP_CHANCE = 0.6;
/** A hunt's shots (s): establishing on the stalker, close and tracking on the creep, a cut-away, the escaping prey. */
const STALK_EST_S: [number, number] = [6, 8], CREEP_CLOSE_S: [number, number] = [8, 12], CREEP_TRACK_S: [number, number] = [10, 15],
  CUTAWAY_S: [number, number] = [6, 10], ESCAPE_S: [number, number] = [8, 12];
/** The chase's wide tracking shot holds while the chase runs; this is only its nominal length (s). */
const CHASE_S = 30;
/** A chase closing to within this many of the hunter's body lengths cuts away, before the animals meet. */
const CLOSE_IN = 3;
/** Animals this near the hunt (m) may be a cut-away's bystander. */
const BYSTANDER_M = 60;
/** A flier this high (m) above the ground is in the air: it is established riding along, not from a still vantage. */
const AIRBORNE_M = 1;
/** A scenery scene's shots last 10–18 s; one is never shorter than VISTA_MIN_S. */
const VISTA_S: [number, number] = [10, 18], VISTA_MIN_S = 6;
/** A day time-lapse lasts 20–40 s; a night one ends when the sky lightens, but lasts this long (s) at the least and at the most. */
const DAY_LAPSE_S: [number, number] = [20, 40], NIGHT_LAPSE_MIN_S = 10, NIGHT_LAPSE_MAX_S = 120;
/** How many past scenes the variety rules look back on, and how long (s) an event filmed is not filmed again. */
const RECENT = 2, DONE_S = 120;
/** The calm events' own peak lines. */
const EVENT_BEATS: Partial<Record<string, LineBeat>> = { drink: 'drink', chorus: 'chorus', raft: 'raft', startle: 'startle', newcomer: 'newcomer', arrive: 'arrive' };

type Mode = 'calm' | 'vista' | 'hunt' | 'day' | 'night';
const span = (rng: () => number, [lo, hi]: [number, number]) => between(rng, lo, hi);
const near = (a: AgentView, b: AgentView) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
/** Where the animals of a group shot are: the story's actors still there, and the rest of its lead `a`'s own group. */
const groupOf = (s: Story, a: AgentView, w: DirectorWorld) =>
  w.agents().filter((m) => s.actors.includes(m.id) || m.id === a.id || (a.group !== null && m.group === a.group)).map((m) => m.pos);

/**
 * Plans the documentary. Each frame `update` is handed the valley and the camera's pose and says which shot starts now
 * (if one does), what the narrator might say, and the scene being filmed. `stories` gives the StoryBook's list.
 */
export class Planner {
  private cur: Story | null = null;
  private mode: Mode = 'calm';
  private sceneAt = 0;
  private sceneLen = 0;
  private plan: { kind: ShotKind; s: number }[] = [];
  private shot: Shot | null = null;
  private shotAt = 0;
  private vistaN = 0;
  private opener: LineBeat | null = null;
  private said = new Set<LineBeat>();
  private lines: LineCue[] = [];
  private recent: { species: string[]; tags: Story['tag'][]; places: string[] }[] = [];
  private done = new Map<string, number>();
  private vistas = new Map<string, Story>();
  private quietSince = NaN;
  private nightQuietSince = NaN;
  private lastDayLapse = -Infinity;
  private lowest = Infinity;
  private afterNight = false;
  private skipping = false;
  private forceLapse = false;

  constructor(private o: { world: VantageWorld; rng: () => number; timelapses: () => boolean; stories: () => readonly Story[] }) {}

  /** The story being filmed, if any. */
  get scene(): Story | null {
    return this.cur;
  }

  /** Move on to another scene at the next update. */
  skip(): void {
    this.skipping = true;
  }

  /** Move on to a time-lapse at the next update (by day or by night, as it is then). */
  timelapse(): void {
    this.forceLapse = this.skipping = true;
  }

  /** The scene's opening line still to come, if any: the documentary picks its words ahead, so the voice is ready. */
  get opening(): LineBeat | null {
    return this.opener;
  }

  /** One frame: `shot` is set on the frame a new shot starts; `lines` are the narrator's cues that came up. */
  update(w: DirectorWorld, from: Pose): { shot: Shot | null; lines: LineCue[]; scene: Story | null } {
    this.lines = [];
    const stories = this.o.stories();
    this.watch(w, stories);
    if (this.skipping && this.cur) this.end(w);
    this.skipping = false;
    let shot: Shot | null = null;
    const by = this.cur && this.urgent(w, stories);
    if (by) shot = (this.end(w), this.begin(by, w, from, 'meanwhile'));
    if (!shot && this.cur) shot = this.carryOn(w, from);
    if (!shot && !this.cur) shot = this.next(w, from, stories);
    if (this.cur && this.opener && w.now - this.sceneAt >= OPENER_AT_S) {
      this.lines.push({ beat: this.opener, story: this.cur });
      this.opener = null;
    }
    return { shot, lines: this.lines, scene: this.cur };
  }

  /** The quiet spells: how long since an event was going on, and (at night) since anything night-worthy was. */
  private watch(w: DirectorWorld, stories: readonly Story[]): void {
    if (Number.isNaN(this.quietSince)) this.quietSince = this.nightQuietSince = w.now;
    if (!w.night) this.nightQuietSince = w.now;
    for (const s of stories) {
      if (s.kind !== 'event' || !s.live) continue;
      this.quietSince = w.now;
      if (NIGHT_TAGS.includes(s.tag)) this.nightQuietSince = w.now;
    }
  }

  private ctx(w: DirectorWorld): ScoreCtx {
    return { now: w.now, camera: w.camera, night: w.night, recent: {
      species: this.recent.flatMap((r) => r.species), tags: this.recent.flatMap((r) => r.tags), places: this.recent.flatMap((r) => r.places) } };
  }

  /** The animal a story is filmed on: a hunt's hunter (its prey once it escapes), else its subject or anyone still there. */
  private leadOf(s: Story, w: DirectorWorld): AgentView | null {
    if (s.hunt) return w.agent(s.hunt.beat === 'escape' && s.hunt.prey ? s.hunt.prey : s.hunt.hunter);
    if (s.subject === null) return null;
    return w.agent(s.subject) ?? s.actors.map((id) => w.agent(id)).find((a) => a) ?? null;
  }

  /** Can it be filmed now: not an event that is over or was just filmed, never a catch, and its animals still there. */
  private filmable(s: Story, w: DirectorWorld): boolean {
    if (s.kind === 'event' && (!s.live || w.now - (this.done.get(s.id) ?? -Infinity) < DONE_S)) return false;
    if (s.hunt?.beat === 'catch') return false;
    return s.kind === 'scenery' || !!this.leadOf(s, w);
  }

  /**
   * A high story that should take the camera now: a hunt starting (or running) or an arrival. A hunt is never
   * interrupted except by an arrival, and an arrival not at all.
   */
  private urgent(w: DirectorWorld, stories: readonly Story[]): Story | null {
    const cur = this.cur, calm = !cur || (this.mode !== 'hunt' && cur.tag !== 'arrive');
    let top: Story | null = null;
    for (const s of stories) {
      if (s === cur || !s.live || s.interest < HIGH || !this.filmable(s, w)) continue;
      const ok = s.tag === 'arrive' ? cur?.tag !== 'arrive' : calm && !!s.hunt && s.hunt.beat !== 'escape';
      if (ok && (!top || s.interest > top.interest)) top = s;
    }
    return top;
  }

  /** The scene is over: an event filmed is not filmed again for a while. */
  private end(w: DirectorWorld): null {
    if (this.cur?.kind === 'event') this.done.set(this.cur.id, w.now);
    for (const [id, at] of this.done) if (w.now - at >= DONE_S) this.done.delete(id);
    this.cur = this.shot = null;
    this.plan = [];
    return null;
  }

  /** What to film next: a time-lapse when it is time, a high story, the best story, or a vista. */
  private next(w: DirectorWorld, from: Pose, stories: readonly Story[]): Shot | null {
    let lapseKind = this.forceLapse ? (w.night ? 'night' : 'day') : wantTimelapse({ now: w.now, night: w.night, enabled: this.o.timelapses(), lastDayLapse: this.lastDayLapse,
      quietFor: w.now - this.quietSince, nightWorthyFor: w.now - this.nightQuietSince });
    this.forceLapse = false;
    // no night time-lapse once the sky is lightening: it would end as soon as it began
    if (lapseKind === 'night' && w.sunElevation !== undefined && w.sunElevation >= DAWN_DEG) lapseKind = null;
    const ctx = this.ctx(w);
    if (lapseKind) return this.beginLapse(lapseKind, w, from, pickScene(this.scenery(w, stories), { ...ctx, night: false })!);
    const story = this.urgent(w, stories) ?? pickScene(stories.filter((s) => this.filmable(s, w)), ctx) ?? pickScene(this.scenery(w, stories), ctx)!;
    const opener = this.afterNight ? 'dawn' : 'opener';
    this.afterNight = false;
    return this.begin(story, w, from, opener);
  }

  /** The scenery to fall back on: the book's vistas, else one made from each viewpoint, else one where the camera is. */
  private scenery(w: DirectorWorld, stories: readonly Story[]): Story[] {
    const own = stories.filter((s) => s.kind === 'scenery');
    if (own.length) return own;
    const vps = w.viewpoints.length ? w.viewpoints : [null];
    return vps.map((v) => {
      const id = `vista:${v?.name ?? 'here'}`;
      let s = this.vistas.get(id);
      if (!s) {
        s = { id, kind: 'scenery', tag: 'vista', subject: null, actors: [], species: [], at: v ? { x: v.pos.x, z: v.pos.z } : { x: w.camera.x, z: w.camera.z },
          interest: 0.1, born: w.now, live: true, released: false, hunt: null, ...(v ? { viewpoint: v } : {}) };
        this.vistas.set(id, s);
      }
      return s;
    });
  }

  /** A new scene on `story`: remembered for variety, its opening line due ~2 s in, and its first shot. */
  private begin(story: Story, w: DirectorWorld, from: Pose, opener: LineBeat): Shot | null {
    this.cur = story;
    this.sceneAt = w.now;
    this.opener = opener;
    this.said.clear();
    this.shot = null;
    this.vistaN = 0;
    this.recent = [...this.recent, { species: story.species, tags: [story.tag], places: [placeOf(story.at)] }].slice(-RECENT);
    const lead = this.leadOf(story, w);
    if (story.hunt) return (this.mode = 'hunt'), this.huntStep(w, from);
    if (!lead) return (this.mode = 'vista'), (this.sceneLen = span(this.o.rng, CALM_S)), this.vistaShot(w, from);
    this.mode = 'calm';
    this.plan = this.calmPlan(story, w);
    return this.planned(w, from);
  }

  /** A time-lapse scene from a vista: by day for 20–40 s, by night until the sky lightens. */
  private beginLapse(kind: 'day' | 'night', w: DirectorWorld, from: Pose, story: Story): Shot {
    this.begin(story, w, from, kind === 'day' ? 'lapse-day' : 'nightfall');
    this.mode = kind;
    this.lowest = Infinity;
    if (kind === 'day') this.lastDayLapse = w.now;
    const s = kind === 'day' ? span(this.o.rng, DAY_LAPSE_S) : NIGHT_LAPSE_MAX_S;
    return this.directed('timelapse', s, lapse(story.viewpoint ?? null, this.o.world, this.o.rng, from, s), null, w, from, 'fastest');
  }

  /** The scene goes on: the next shot when one is due, or the scene ends (and null). */
  private carryOn(w: DirectorWorld, from: Pose): Shot | null {
    if (this.mode === 'hunt') return this.huntStep(w, from);
    const shot = this.shot!, t = w.now - this.shotAt;
    if (shot.subject && !w.agent(shot.subject)) return this.end(w); // gone mid-shot: move on
    if (this.mode === 'night') {
      const el = w.sunElevation;
      if (el !== undefined) this.lowest = Math.min(this.lowest, el);
      const over = !w.night || (el !== undefined && nightLapseOver(el, this.lowest));
      if ((over && t >= NIGHT_LAPSE_MIN_S) || t >= shot.s) {
        // a dawn scene next; the night's lapse counts as the day's, so the dawn is not lapsed too
        this.afterNight = true;
        this.nightQuietSince = this.lastDayLapse = w.now;
        return this.end(w);
      }
      return null;
    }
    if (t < shot.s) return null;
    if (this.mode === 'vista') return this.vistaShot(w, from);
    if (this.mode === 'day') return this.end(w);
    return this.planned(w, from);
  }

  /** A calm scene's shots, 30–75 s in all: establishing, tracking or group, close, maybe eyes, then tracking. */
  private calmPlan(story: Story, w: DirectorWorld): { kind: ShotKind; s: number }[] {
    const r = this.o.rng, len = span(r, CALM_S);
    const many = story.actors.filter((id) => w.agent(id)).length > 1;
    const plan: { kind: ShotKind; s: number }[] = [
      { kind: 'establishing', s: span(r, ESTABLISH_S) },
      { kind: many && r() < GROUP_CHANCE ? 'group' : 'tracking', s: span(r, MIDDLE_S) },
      { kind: 'close', s: span(r, CLOSE_S) },
    ];
    if (story.tag !== 'sleeping' && r() < EYES_CHANCE) plan.push({ kind: 'eyes', s: span(r, EYES_S) });
    const used = plan.reduce((a, p) => a + p.s, 0);
    plan.push({ kind: 'tracking', s: Math.max(LAST_MIN_S, len - used, CALM_S[0] - used) });
    return plan;
  }

  /** The calm scene's next planned shot, or the end of the scene. */
  private planned(w: DirectorWorld, from: Pose): Shot | null {
    const step = this.plan.shift(), story = this.cur!, a = this.leadOf(story, w);
    if (!step || !a) return this.end(w);
    const { world, rng } = this.o;
    if (step.kind === 'establishing') return this.establish(a, step.s, w, from);
    if (step.kind === 'group') return this.directed('group', step.s, group(groupOf(story, a, w), a.size, world, rng, from.pos, step.s), a.id, w, from);
    if (step.kind === 'close') this.cue(this.peak(story));
    return this.ride(step.kind, a, step.s, w, from);
  }

  /** The calm scene's peak line: the event's own kind, or a check-in (a species note now and then, natives only). */
  private peak(s: Story): LineBeat {
    return EVENT_BEATS[s.tag] ?? (!s.released && this.o.rng() < 0.5 ? 'species' : 'checkin');
  }

  /** A scenery scene's next shot (10–18 s, the last taking what is left), or its end. */
  private vistaShot(w: DirectorWorld, from: Pose): Shot | null {
    const left = this.sceneLen - (w.now - this.sceneAt);
    if (left < VISTA_MIN_S) return this.end(w);
    const s = left < VISTA_S[1] + VISTA_MIN_S ? left : span(this.o.rng, VISTA_S);
    return this.directed('establishing', s, vista(this.cur!.viewpoint ?? null, this.o.world, this.o.rng, from, this.vistaN++, s), null, w, from);
  }

  /**
   * A hunt, frame by frame: establishing on the stalker, close and tracking while it creeps, wide tracking that holds
   * while the chase runs, a cut-away when the chase closes in or the catch comes (never the prey then), the prey on an
   * escape (a cut-away if any hunter closes in on it meanwhile). The hunt's beats are cued as they come.
   */
  private huntStep(w: DirectorWorld, from: Pose): Shot | null {
    const s = this.cur!, h = s.hunt!, hunter = w.agent(h.hunter), prey = h.prey ? w.agent(h.prey) : null;
    const shot = this.shot, left = shot ? shot.s - (w.now - this.shotAt) : 0, over = left <= 0, k = shot?.kind;
    // the catch, first seen now: its line gets a cut-away of 6 s or more, so a running one too near its end is followed by a fresh one
    const caught = h.beat === 'catch' && !this.said.has('catch'), short = caught && left < CUTAWAY_S[0];
    if (h.beat !== 'creep') this.cue(h.beat);
    if (k === 'cutaway' && !over && !short) return null; // a cut-away plays out whatever happens
    const { rng } = this.o;
    switch (h.beat) {
      case 'catch':
        return k === 'cutaway' && !short ? this.end(w) : this.cutaway(w, from);
      case 'escape': {
        if (!prey) return this.end(w);
        // a hunter (this one, or another) within reach of the prey being ridden: its chase is not filmed either
        const closing = w.agents().filter((a) => a.hunter && a.id !== prey.id && near(a, prey) <= CLOSE_IN * a.bodyLength);
        if (closing.length) return k === 'cutaway' ? this.end(w) : this.cutaway(w, from, closing);
        if (shot?.subject === prey.id && k === 'tracking') return over ? this.end(w) : null;
        return this.ride('tracking', prey, span(rng, ESCAPE_S), w, from);
      }
      case 'chase':
      case 'dive': {
        if (!hunter || !s.live) return this.end(w);
        const gone = h.prey !== null && !prey; // caught and sinking, most likely
        if (gone || (prey && near(hunter, prey) <= CLOSE_IN * hunter.bodyLength)) return gone && k === 'cutaway' ? this.end(w) : this.cutaway(w, from);
        if (k === 'tracking' && shot!.subject === hunter.id && shot!.framing?.wide) return null; // hold the chase
        return this.ride('tracking', hunter, CHASE_S, w, from, true);
      }
      case 'creep':
        if (!hunter || !s.live) return this.end(w);
        if (!shot) return this.establish(hunter, span(rng, STALK_EST_S), w, from, STALK_EST_S[0]);
        if (!over) return null;
        if (k === 'close') return this.ride(rng() < 0.5 ? 'tracking' : 'behind', hunter, span(rng, CREEP_TRACK_S), w, from);
        this.cue('creep');
        return this.ride('close', hunter, span(rng, CREEP_CLOSE_S), w, from);
    }
  }

  /** A cut-away from the hunt: a bystander, the sky or the treeline, 6–10 s, never the hunter or its prey (nor `also`, other hunters closing in). */
  private cutaway(w: DirectorWorld, from: Pose, also: readonly AgentView[] = []): Shot {
    const h = this.cur!.hunt!, hunter = w.agent(h.hunter), prey = h.prey ? w.agent(h.prey) : null;
    const away = [hunter, prey, ...also].filter((a): a is AgentView => !!a), at = away[0]?.pos ?? from.pos;
    const not = new Set([h.hunter, h.prey, ...also.map((a) => a.id)]);
    const bystanders = w.agents().filter((a) => !this.cur!.actors.includes(a.id) && !not.has(a.id)
      && Math.hypot(a.pos.x - at.x, a.pos.z - at.z) < BYSTANDER_M);
    const s = span(this.o.rng, CUTAWAY_S);
    const c = cutaway({ from, away: away.map((a) => a.pos), bystanders, world: this.o.world, rng: this.o.rng, s });
    const shot = this.directed('cutaway', s, c.move, c.subject, w, from);
    // never a glide away from a chase closing in: the animals could meet on screen on the way
    if (shot.join === 'ease') shot.join = 'cut';
    return shot;
  }

  /**
   * An establishing shot of animal `a` (its move planned `move` s long): a drift from a vantage, or riding along behind
   * it while it is in the air, where a still camera framing it near enough to see would lose it in a moment.
   */
  private establish(a: AgentView, s: number, w: DirectorWorld, from: Pose, move = s): Shot {
    if (a.flying && a.altitude > AIRBORNE_M) return this.ride('tracking', a, s, w, from);
    return this.directed('establishing', s, establishing(a, this.o.world, this.o.rng, from.pos, move), a.id, w, from);
  }

  /** A shot riding animal `a` through the views: tracking (framed side-on or low, or wide in a chase), behind, close or eyes. */
  private ride(kind: ShotKind, a: AgentView, s: number, w: DirectorWorld, from: Pose, wide = false): Shot {
    const view: ViewName = kind === 'close' ? 'close' : kind === 'eyes' ? 'eyes' : 'follow';
    const framing = kind === 'tracking' ? trackingFraming(this.o.rng, a, wide) : kind === 'behind' ? {} : undefined;
    const shot: Shot = { kind, s, story: this.cur!.id, subject: a.id, join: joinOf(from, viewSpot(a, from, view, wide)), view, ...(framing ? { framing } : {}) };
    return this.started(shot, w);
  }

  /** A directed shot: the documentary's own camera move. */
  private directed(kind: ShotKind, s: number, move: Move, subject: string | null, w: DirectorWorld, from: Pose, clock?: 'fastest'): Shot {
    const shot: Shot = { kind, s, story: this.cur!.id, subject, join: joinOf(from, movePose(move, 0, this.o.world)), move: { ...move, s }, ...(clock ? { clock } : {}) };
    return this.started(shot, w);
  }

  private started(shot: Shot, w: DirectorWorld): Shot {
    this.shot = shot;
    this.shotAt = w.now;
    return shot;
  }

  /** A narrator's cue for this scene, each kind once a scene; a hunt's beat said before the opener stands in for it. */
  private cue(beat: LineBeat): void {
    if (this.said.has(beat)) return;
    this.said.add(beat);
    if (this.cur!.hunt && this.opener === 'opener') this.opener = null;
    this.lines.push({ beat, story: this.cur! });
  }
}
