/**
 * The documentary: the valley filming itself while the family sits back. It turns the planner's shots into the views (a
 * directed move, a lock placed at once or glided to, a view or a framing), dips through black between far-apart scenes,
 * warming a spot with the second eye in the black before cutting to it, holds the clock at Normal (Fastest for a time-lapse),
 * shows the letterbox bars, the title and the hint, and has the
 * narrator speak the planner's cues when the pacing allows (the voice if its audio is ready, else words only), ducking
 * the soundscape while she speaks. Any touch hands the camera back at once (see `Handover`); the menu pauses the
 * narrator but not the filming, the workshop pauses it, and a release arrival suspends it until it is over.
 */
import { DEFAULT_SPEED } from '../world/clock';
import type { Vec3 } from '../util/vec';
import type { Pose } from '../views/types';
import { SWITCH_S, type Mode, type Views } from '../views/views';
import { partOfDay, type DocUi } from './doc-ui';
import type { Pacer } from './pacing';
import { DrawnMemory } from './drawn';
import type { LineCue, Planner, Shot } from './planner';
import type { StoryBook } from './stories';
import { wordsOnlySeconds } from './subtitles';
import type { DirectorWorld, LineBeat, Story } from './types';
import type { VoiceClient } from './voice';

/** A dip through black lasts this long (s), the cut in its middle. */
export const DIP_S = 0.6;
/**
 * A cut through black waits at most this much longer (s) for its spot to be warmed: the second eye is set at the spot only
 * once the screen is black, so the animals' waking and the plants' refill (a long frame) are not seen.
 */
export const WARM_WAIT_S = 1.5;
/** The camera also counts as having drawn the ground this far (m) ahead of where it faces. */
const LOOK_AHEAD_M = 40;
/** A directed shot with no animal is warmed this far (m) ahead of where its camera starts, along the way it faces. */
const WARM_AHEAD_M = 40;
/** The hint shows this long (real s) from the start; the title this long from the first shot. */
export const HINT_S = 5, TITLE_S = 6;
/** The first line of a run is a welcome back when the documentary has been off this long (real s). */
export const WELCOME_GAP_S = 30 * 60;
/** A line waits this long (real s) for its voice before it is shown as words only. */
export const VOICE_WAIT_S = 1;
/** Fastest, for a time-lapse: 16 times Normal. */
export const FASTEST_SPEED = 16 * DEFAULT_SPEED;

/** The beats that open a scene: the first of a run is spoken as a greeting instead. */
const OPENINGS: readonly LineBeat[] = ['opener', 'meanwhile', 'dawn', 'lapse-day', 'nightfall'];

/** What the narrator can do: speak with the voice and show the words, show the words only, or stay quiet. */
export type Narrator = 'voice' | 'words' | 'off';

/** What the documentary works with (see the file's note). */
export type DocDeps = {
  views: Views;
  planner: Planner;
  book: StoryBook;
  voice: VoiceClient;
  pacer: Pacer;
  /** The words for a cue (null: no line fits). */
  lines: { pick(c: LineCue): { id: string; text: string } | null };
  ui: DocUi;
  subtitles: { show(t: string | null): void };
  clock: { hold(): void; release(): void; fastest(on: boolean): void };
  sound: { duck(on: boolean): void };
  arrivalActive(): boolean;
  workshop(): boolean;
  /**
   * Ready a far spot before the cut to it: the second eye looks at `at` (banding only) until `done`; `ready` once it has
   * had time. Without it a far cut just dips.
   */
  prewarm?(at: Vec3): Warming;
  /** The narrator setting (voice and words, by default). */
  narrator?(): Narrator;
  /** The player last used the keyboard (the hint names its keys). */
  keys?(): boolean;
};

/** A far spot being pre-warmed (see `DocDeps.prewarm`). */
export type Warming = { ready(): boolean; done(): void; prime?(part: 0 | 1): void };

/** The views' modes a shot leaves them in: anything else means something other than the documentary has moved them. */
const RIDING: readonly Mode[] = ['gliding', 'locked'], DIRECTED: readonly Mode[] = ['directed'];

/**
 * What a shot starts by looking at, roughly, for a pre-warm: its animal, an orbit's centre, or a point ahead of where a
 * directed camera starts (on the ground at the least).
 */
function startOf(s: Shot, w: DirectorWorld): Vec3 | null {
  const a = s.subject !== null ? w.agent(s.subject) : null, m = s.move;
  if (a) return a.pos;
  if (!m) return null;
  if (m.kind === 'orbit') return m.centre;
  const p = m.kind === 'drift' ? m.from : m.pose, cos = Math.cos(p.pitch);
  const x = p.pos.x - Math.sin(p.yaw) * cos * WARM_AHEAD_M, z = p.pos.z - Math.cos(p.yaw) * cos * WARM_AHEAD_M;
  return { x, y: Math.max(p.pos.y + Math.sin(p.pitch) * WARM_AHEAD_M, w.ground(x, z)), z };
}

/** The documentary (see the file's note). The wiring calls `frame` every frame while it is on. */
export class Documentary {
  private running = false;
  private now = 0;
  private hours = 12;
  /** When it was last turned off (real s), for the welcome back; null: never yet. */
  private offAt: number | null = null;
  /** The first frame of a run is still to come (the greeting is chosen then). */
  private fresh = false;
  /** The greeting still to be spoken this run, in place of its first opening line. */
  private greeting: LineBeat | null = null;
  private menuOpen = false;
  /** Paused by the workshop, or suspended by a release arrival (null: neither). */
  private held: 'workshop' | 'arrival' | null = null;
  /** Once the pause is over, film a fresh scene (after an arrival, or when a time-lapse or a cut was abandoned). */
  private afresh = false;
  /** The modes the last shot left the views in (null: none yet). */
  private expect: readonly Mode[] | null = null;
  private shot: Shot | null = null;
  private scene: Story | null = null;
  /**
   * A cut through black under way: `t` runs from the dip's start, the shot to cut to, the spot to warm (set once the screen
   * is black, at `warmT`), its warm, and how many of the warm's priming parts have been drawn.
   */
  private dip: { t: number; shot: Shot; at: Vec3 | null; warm: Warming | null; warmT: number; primed: number } | null = null;
  /** Where the main camera has drawn lately: a cut to anywhere else joins through black (its first sight is hidden). */
  readonly drawn = new DrawnMemory();
  /** Frames the black stays after a cut, so the picture's first frame at the new spot is drawn unseen (0: none waiting). */
  private holdBlack = 0;
  private titled = false;
  private hintLeft = 0;
  private titleLeft = 0;
  /** The words picked for each cue the pacer holds, and the opening line picked ahead for the scene's opener. */
  private texts = new WeakMap<LineCue, string>();
  private ahead: { story: Story; beat: LineBeat; text: string } | null = null;
  /** The line being said (spoken, or words only with the seconds it has left), and a line waiting for its voice. */
  private saying: { words: boolean; left: number } | null = null;
  private waiting: { text: string; until: number } | null = null;

  constructor(private readonly d: DocDeps) {}

  /** Whether the documentary is running. */
  get on(): boolean {
    return this.running;
  }

  /** Start filming (the map closed first, if it is up): the bars and the hint, the clock held at Normal, and a fresh scene. */
  start(): void {
    if (this.running) return;
    const { ui, clock, planner, views } = this.d;
    if (views.state.mode === 'map') views.closeMap();
    this.running = this.fresh = true;
    this.titled = this.afresh = false;
    this.held = null;
    this.expect = this.shot = this.scene = this.ahead = null;
    this.hintLeft = HINT_S;
    clock.hold();
    ui.bars(true);
    ui.hint(this.d.keys?.() ? 'Any key: take over · Enter: follow this animal' : 'Any button: take over · A: follow this animal');
    planner.skip();
  }

  /**
   * Hand the camera back, at once: `free` lets go of the views where the camera is; `lock` locks on to the animal being
   * filmed, in the view being shown (as if the player had locked on), or lets go when the shot has no animal. During a
   * release arrival the views are left alone (the arrival keeps its camera). The dip, the bars, the narrator and the
   * clock's hold all end.
   */
  takeOver(how: 'free' | 'lock'): void {
    if (!this.running) return;
    if (this.held === 'arrival' || this.d.arrivalActive()) return this.end();
    // in a dip the views still ride the shot being left (a hunter, for a cut-away): the shot waiting in the black is the one
    // filmed, so its animal is locked on to, placed at once (no glide back past the old one), or none: let go
    const { views } = this.d, st = views.state, dip = this.dip?.shot, riding = !dip && RIDING.includes(st.mode) && st.id !== null;
    const subject = dip ? dip.subject : riding ? st.id : (this.shot?.subject ?? null);
    this.end();
    views.framing = {};
    if (how === 'lock' && subject !== null) {
      if (dip) views.place(subject, 'follow');
      else if (!riding || st.id !== subject) views.lock(subject);
    } else views.letGo();
  }

  /**
   * The menu opened over the documentary (`true`) or closed: the narrator pauses while it is up (the soundscape comes
   * back up meanwhile), the filming goes on.
   */
  menu(open: boolean): void {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    if (!this.running || !this.saying || this.saying.words) return;
    this.d.voice.pause(open);
    this.d.sound.duck(!open);
  }

  /** Move on to the next scene. */
  skip(): void {
    this.d.planner.skip();
  }

  /** One frame of `dt` real seconds: the valley as the Director sees it (`w`) and the camera's pose now (`from`). */
  frame(dt: number, w: DirectorWorld, from: Pose): void {
    this.now = w.now;
    this.hours = w.hours;
    if (!this.running) return;
    if (this.fresh) {
      this.fresh = false;
      this.greeting = this.offAt !== null && w.now - this.offAt > WELCOME_GAP_S ? 'welcome' : 'first';
    }
    this.furniture(dt);
    if (this.holdBlack > 0 && --this.holdBlack === 0 && !this.dip) this.d.ui.dip(false);
    this.drawn.visit(from.pos.x, from.pos.z, w.now);
    this.drawn.visit(from.pos.x - Math.sin(from.yaw) * LOOK_AHEAD_M, from.pos.z - Math.cos(from.yaw) * LOOK_AHEAD_M, w.now);
    // the workshop pauses it; a release arrival suspends it (it has the camera)
    const why = this.d.workshop() ? 'workshop' : this.d.arrivalActive() ? 'arrival' : null;
    if (why) return this.suspend(why);
    const { views, planner, book } = this.d, after = this.held !== null && this.afresh;
    // back from a pause: Normal again (an arrival started over a time-lapse gives back the Fastest it found as it ends)
    if (this.held !== null) this.d.clock.fastest(false);
    this.held = null;
    // after an arrival or an abandoned shot, or when something else moved the views (the animal went, a lock from
    // elsewhere): a new shot, rather than fighting it
    if (after || (this.expect && !this.expect.includes(views.state.mode))) {
      this.afresh = false;
      this.expect = null;
      planner.skip();
    }
    this.dipFrame(dt);
    book.update(w);
    const r = planner.update(w, from);
    if (r.scene !== this.scene) this.prepare((this.scene = r.scene));
    for (const c of r.lines) this.want(c);
    if (r.shot) this.take(r.shot, w);
    if (this.menuOpen) {
      if (this.waiting) this.waiting.until += dt; // the narrator is paused: so is her wait
    } else this.speak(dt);
  }

  /** The hint and the title fade after their time. */
  private furniture(dt: number): void {
    const { ui } = this.d;
    if (this.hintLeft > 0 && (this.hintLeft -= dt) <= 0) ui.hint(null);
    if (this.titleLeft > 0 && (this.titleLeft -= dt) <= 0) ui.title(null);
  }

  /**
   * The workshop or a release arrival comes first: no shots and no lines until it is over, the line being said stopped,
   * and the clock back at Normal (the documentary's hold stays): a time-lapse, or a cut waiting in the black, is
   * abandoned, and filming starts afresh after it. After an arrival it always does (the arrival had the camera).
   */
  private suspend(why: 'workshop' | 'arrival'): void {
    if (this.held === why) return;
    if (this.held === null) {
      this.hush();
      if (this.dip || this.shot?.clock === 'fastest') this.afresh = true;
      this.clearDip();
      this.d.clock.fastest(false);
    }
    this.held = why;
    if (why === 'arrival') (this.afresh = true), (this.expect = this.shot = null);
  }

  /**
   * A new shot: at once when its spot has been drawn lately and it is near; otherwise through black: the screen fades out
   * (the last shot plays on until it is black), then the spot is warmed (see `dipFrame`). A cut-away (and any shot of a
   * hunt come to its catch) never fades: the screen goes black at once, so the chase is never seen fading out. A newer
   * shot while a cut is under way: a near one is cut to at once (the cut is given up); a far one is the one cut to (its own
   * spot warmed).
   */
  private take(shot: Shot, w: DirectorWorld): void {
    const d = this.dip, spot = this.d.prewarm ? startOf(shot, w) : null;
    // a spot the camera has not drawn lately meets its first-sight work: that frame is hidden in a dip, however near
    if (spot) {
      if (shot.join !== 'dip' && !this.drawn.seen(spot.x, spot.z, w.now)) shot = { ...shot, join: 'dip' };
      this.drawn.visit(spot.x, spot.z, w.now);
    }
    if (d && shot.join !== 'dip') return (this.clearDip(), this.apply(shot));
    const sudden = shot.kind === 'cutaway' || this.d.book.get(shot.story)?.hunt?.beat === 'catch';
    if (d) {
      d.shot = shot;
      d.at = spot;
      if (d.warm) (d.warm.done(), (d.warm = null));
      if (sudden && d.t < DIP_S / 2) (d.t = DIP_S / 2), this.d.ui.dip(true, true); // still fading: black now
      return;
    }
    if (shot.join !== 'dip') return this.apply(shot);
    // a sudden dip starts fully black: its warm is set on the next frame, as when a fade has just finished
    this.dip = { t: sudden ? DIP_S / 2 : 0, shot, at: spot, warm: null, warmT: 0, primed: 0 };
    this.holdBlack = 0;
    this.d.ui.dip(true, sudden);
  }

  /**
   * A cut through black under way: the screen fades out (DIP_S / 2), then the second eye is set at the new spot (the animals
   * there woken and banded, the plants refilled: the long frame happens in the black) and the cut waits for it to be ready
   * (WARM_WAIT_S at the most), then the eye's view is drawn once, unseen (the animals, then the plants, a frame apart), then
   * the cut; the black lifts two frames after it.
   */
  private dipFrame(dt: number): void {
    const d = this.dip;
    if (!d) return;
    d.t += dt;
    if (d.t < DIP_S / 2) return;
    if (!d.warm && d.at && this.d.prewarm) (d.warm = this.d.prewarm(d.at)), (d.warmT = d.t);
    if (d.warm && !d.warm.ready() && d.t - d.warmT < WARM_WAIT_S) return;
    if (d.warm?.prime && d.primed < 2) return d.warm.prime(d.primed++ as 0 | 1);
    this.clearDip(true);
    this.apply(d.shot);
  }

  /** End the dip: the black lifts now, or (`keepBlack`, at a cut) two frames later, once the new spot's first frame is drawn. */
  private clearDip(keepBlack = false): void {
    this.dip?.warm?.done();
    if (this.dip && keepBlack) this.holdBlack = 2;
    else if (this.dip) this.d.ui.dip(false);
    this.dip = null;
  }

  /** Put a shot on the screen: the clock for it, then a directed move, or riding its animal (an eased switch, a glide or a lock placed at once). */
  private apply(s: Shot): void {
    const { views, clock, ui } = this.d;
    clock.fastest(s.clock === 'fastest');
    this.shot = s;
    if (s.move) {
      views.framing = {};
      views.direct(s.move, undefined, s.join === 'ease' ? { ease: SWITCH_S } : undefined);
      this.expect = DIRECTED;
    } else if (s.subject !== null && s.view) {
      views.framing = s.framing ?? {};
      const st = views.state;
      if (s.join === 'ease' && st.id === s.subject && RIDING.includes(st.mode)) views.setView(s.view);
      else if (s.join === 'ease') views.lock(s.subject, s.view);
      else views.place(s.subject, s.view);
      this.expect = RIDING;
    }
    if (this.titled) return;
    this.titled = true;
    this.titleLeft = TITLE_S;
    ui.title(`${partOfDay(this.hours)} in the valley`);
  }

  /** A new scene: its opening line's words picked now (the greeting, for the run's first), so its voice can be fetched ahead. */
  private prepare(scene: Story | null): void {
    this.ahead = null;
    const beat = this.d.planner.opening;
    if (!scene || !beat || this.narrator() === 'off') return;
    const greet = this.greeting && OPENINGS.includes(beat) ? this.greeting : null;
    if (greet) this.greeting = null;
    const line = this.d.lines.pick({ beat: greet ?? beat, story: scene });
    if (!line) return;
    this.ahead = { story: scene, beat, text: line.text };
    if (this.narrator() === 'voice') this.d.voice.prefetch(line.text);
  }

  /** The planner wants a line: its words picked now (and its voice fetched), then it waits for the pacer. */
  private want(c: LineCue): void {
    if (this.narrator() === 'off') return;
    const a = this.ahead, mine = a && a.story === c.story && a.beat === c.beat;
    let text = mine ? a.text : null;
    if (mine) this.ahead = null;
    else {
      text = this.d.lines.pick(c)?.text ?? null;
      if (text && this.narrator() === 'voice') this.d.voice.prefetch(text);
    }
    if (!text) return;
    this.texts.set(c, text);
    this.d.pacer.want(c, this.now);
  }

  private narrator(): Narrator {
    return this.d.narrator?.() ?? 'voice';
  }

  /** The narrator, this frame: the line being said goes on; a line waiting for its voice starts; or the pacer lets the next go. */
  private speak(dt: number): void {
    const { pacer, voice } = this.d;
    if (this.saying) {
      if (this.saying.words && (this.saying.left -= dt) <= 0) this.quiet();
      return;
    }
    if (this.waiting) {
      if (!this.tryVoice(this.waiting.text) && this.now >= this.waiting.until) this.words(this.waiting.text);
      return;
    }
    if (this.dip) return; // no new line while a far cut is under way: it waits for the picture (or goes stale)
    const cue = pacer.next(this.now, false), text = cue && this.texts.get(cue);
    if (!text) return;
    if (this.narrator() !== 'voice' || voice.available === 'no') return this.words(text);
    if (!this.tryVoice(text)) this.waiting = { text, until: this.now + VOICE_WAIT_S };
  }

  /** Speak `text` if its voice is ready: the subtitle shows and the soundscape ducks while it plays. */
  private tryVoice(text: string): boolean {
    const me = { words: false, left: 0 };
    const r = this.d.voice.play(text, () => this.saying === me && this.quiet());
    if (!r.spoken) return false;
    this.waiting = null;
    this.saying = me;
    this.d.subtitles.show(text);
    this.d.sound.duck(true);
    this.d.pacer.spoke(this.now, r.seconds);
    return true;
  }

  /** Show `text` as words only, for 3 s and 0.3 s a word. */
  private words(text: string): void {
    const s = wordsOnlySeconds(text);
    this.waiting = null;
    this.saying = { words: true, left: s };
    this.d.subtitles.show(text);
    this.d.pacer.spoke(this.now, s);
  }

  /** The line is over: the subtitle fades and the soundscape comes back up. */
  private quiet(): void {
    const spoken = this.saying && !this.saying.words;
    this.saying = null;
    this.d.subtitles.show(null);
    if (spoken) this.d.sound.duck(false);
  }

  /** Stop whatever the narrator is saying or waiting to say. */
  private hush(): void {
    this.waiting = null;
    if (this.saying && !this.saying.words) this.d.voice.stop(); // its end clears the line
    if (this.saying) this.quiet();
  }

  /** It is over: the dip, the narrator, the furniture and the clock's hold all end. */
  private end(): void {
    this.running = false;
    this.offAt = this.now;
    this.clearDip();
    this.hush();
    this.d.voice.stop();
    this.d.sound.duck(false);
    this.d.subtitles.show(null);
    const { ui } = this.d;
    ui.dip(false);
    ui.bars(false);
    ui.title(null);
    ui.hint(null);
    this.hintLeft = this.titleLeft = 0;
    this.d.clock.release();
    this.expect = this.shot = this.scene = this.ahead = null;
    this.greeting = this.held = null;
  }
}

/**
 * The clock while the documentary runs: Normal (Fastest for a time-lapse), even if the player had Paused (a paused valley
 * has nothing to film), with the player's own speed kept to give back when they take over, and saved in its place.
 */
export class DocClock {
  private was: { speed: number; paused: boolean } | null = null;
  private fast = false;

  constructor(private readonly clock: { speed: number; paused: boolean }) {}

  /** The documentary starts: remember the player's speed (`base`, when another hold already keeps it) and play at Normal. */
  hold(base?: { speed: number; paused: boolean } | null): void {
    if (this.was) return;
    this.was = base ? { ...base } : { speed: this.clock.speed, paused: this.clock.paused };
    this.set(false);
  }

  /** A time-lapse (`true`, Fastest) or back to Normal; only while held. */
  fastest(on: boolean): void {
    if (this.was) this.set(on);
  }

  /** The documentary is over: the player's speed back, whatever the shot was. */
  release(): void {
    if (!this.was) return;
    Object.assign(this.clock, this.was);
    this.was = null;
  }

  /** The player picked a speed (in the menu over the documentary): it is theirs to have back; the documentary keeps its own. */
  playerChanged(): void {
    if (!this.was) return;
    this.was = { speed: this.clock.speed, paused: this.clock.paused };
    this.set(this.fast);
  }

  /** What `release` would give back (for the save: the player's speed, not the documentary's); null when not held. */
  get remembered(): { speed: number; paused: boolean } | null {
    return this.was && { ...this.was };
  }

  private set(fast: boolean): void {
    this.fast = fast;
    this.clock.paused = false;
    this.clock.speed = fast ? FASTEST_SPEED : DEFAULT_SPEED;
  }
}
