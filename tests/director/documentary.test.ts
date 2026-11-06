import { describe, expect, it } from 'vitest';
import { DIP_S, DocClock, Documentary, FASTEST_SPEED, VOICE_WAIT_S, WARM_WAIT_S, WELCOME_GAP_S, type DocDeps, type Narrator } from '../../src/director/documentary';
import { partOfDay } from '../../src/director/doc-ui';
import { Pacer } from '../../src/director/pacing';
import type { LineCue, Planner, Shot } from '../../src/director/planner';
import type { StoryBook } from '../../src/director/stories';
import { wordsOnlySeconds } from '../../src/director/subtitles';
import type { AgentView, DirectorWorld, LineBeat, Story } from '../../src/director/types';
import type { VoiceClient } from '../../src/director/voice';
import type { Move } from '../../src/views/directed';
import type { FollowOpts } from '../../src/views/follow';
import type { Pose } from '../../src/views/types';
import { SWITCH_S, type Mode, type ViewName, type Views } from '../../src/views/views';
import { DEFAULT_SPEED } from '../../src/world/clock';

const pose = (x = 0): Pose => ({ pos: { x, y: 10, z: 0 }, yaw: 0, pitch: 0 });
const move: Move = { kind: 'drift', from: pose(0), to: pose(5), s: 8 };
const story = (id: string, subject: string | null = 'fox#0'): Story => ({ id, kind: subject ? 'checkin' : 'scenery', tag: subject ? 'herd' : 'vista',
  subject, actors: subject ? [subject] : [], species: [], at: { x: 0, z: 0 }, interest: 0.2, born: 0, live: true, released: false, hunt: null });
const directed = (o: Partial<Shot> = {}): Shot => ({ kind: 'establishing', s: 8, story: 'a', subject: 'fox#0', join: 'cut', move, ...o });
const ride = (view: ViewName, o: Partial<Shot> = {}): Shot => ({ kind: view === 'close' ? 'close' : 'tracking', s: 10, story: 'a', subject: 'fox#0', join: 'cut', view, ...o });

/** The views as the documentary sees them: its calls, and the mode they leave. */
function fakeViews() {
  const calls: string[] = [];
  let st = { mode: 'free' as Mode, id: null as string | null, view: 'follow' as ViewName, sense: null, reins: false };
  const v = {
    calls,
    framing: {} as FollowOpts,
    get state() { return { ...st }; },
    set: (mode: Mode, id: string | null = null) => void (st = { ...st, mode, id }),
    direct: (m: Move, _end?: () => void, o?: { ease?: number }) =>
      void (calls.push(`direct ${m.kind}${o?.ease ? ` ease ${o.ease}` : ''}`), (st = { ...st, mode: 'directed', id: null })),
    place: (id: string, view: ViewName) => void (calls.push(`place ${id} ${view}`), (st = { ...st, mode: 'locked', id, view })),
    lock: (id: string, view: ViewName = 'follow') => void (calls.push(`lock ${id} ${view}`), (st = { ...st, mode: 'gliding', id, view })),
    setView: (view: ViewName) => void (calls.push(`setView ${view}`), (st = { ...st, view })),
    letGo: () => void (calls.push('letGo'), (st = { ...st, mode: 'free', id: null })),
    closeMap: () => void (calls.push('closeMap'), (st = { ...st, mode: 'diving', id: null })),
  };
  return v;
}

/** A planner that plays back what the test queues, frame by frame. */
function fakePlanner() {
  const p = {
    queue: [] as { shot?: Shot; lines?: LineBeat[]; scene?: Story | null; opening?: LineBeat | null }[],
    scene: null as Story | null,
    opening: null as LineBeat | null,
    updates: 0,
    skips: 0,
    skip() { p.skips++; },
    update(): { shot: Shot | null; lines: LineCue[]; scene: Story | null } {
      p.updates++;
      const next = p.queue.shift() ?? {};
      if (next.scene !== undefined) p.scene = next.scene;
      if (next.opening !== undefined) p.opening = next.opening;
      return { shot: next.shot ?? null, lines: (next.lines ?? []).map((beat) => ({ beat, story: p.scene! })), scene: p.scene };
    },
  };
  return p;
}

/** A voice whose lines are ready once the test says so; it records what it was asked. */
function fakeVoice() {
  const v = {
    available: 'yes' as 'unknown' | 'yes' | 'no',
    ready: new Set<string>(),
    prefetched: [] as string[],
    played: [] as string[],
    paused: [] as boolean[],
    stops: 0,
    end: null as (() => void) | null,
    prefetch: (t: string) => void v.prefetched.push(t),
    play(t: string, onEnd: () => void) {
      if (!v.ready.has(t)) return { spoken: false, seconds: 0 };
      v.played.push(t);
      v.end = onEnd;
      return { spoken: true, seconds: 4 };
    },
    stop() { v.stops++; const e = v.end; v.end = null; e?.(); },
    pause: (on: boolean) => void v.paused.push(on),
  };
  return v;
}

function setup(o: { narrator?: Narrator; paused?: boolean; speed?: number; prewarm?: DocDeps['prewarm'] } = {}) {
  const views = fakeViews(), planner = fakePlanner(), voice = fakeVoice();
  const ui = { log: [] as string[], bars: (on: boolean) => void ui.log.push(`bars ${on}`), title: (t: string | null) => void ui.log.push(`title ${t}`),
    hint: (t: string | null) => void ui.log.push(`hint ${t}`), dip: (on: boolean, now?: boolean) => void ui.log.push(`dip ${on}${now ? ' at once' : ''}`) };
  const subs: (string | null)[] = [], ducks: boolean[] = [];
  const clock = { speed: o.speed ?? DEFAULT_SPEED, paused: o.paused ?? false };
  const docClock = new DocClock(clock);
  const flags = { arrival: false, workshop: false };
  const tales = new Map<string, Story>(); // the StoryBook's stories, as the documentary looks them up
  const picked: LineBeat[] = [];
  let updates = 0;
  const deps: DocDeps = {
    views: views as unknown as Views, planner: planner as unknown as Planner, book: { update: () => void updates++, get: (id: string) => tales.get(id) } as unknown as StoryBook,
    voice: voice as unknown as VoiceClient, pacer: new Pacer(),
    lines: { pick: (c) => (picked.push(c.beat), { id: `${c.beat}-1`, text: `the ${c.beat} line` }) },
    ui, subtitles: { show: (t) => void subs.push(t) }, clock: docClock, sound: { duck: (on) => void ducks.push(on) },
    arrivalActive: () => flags.arrival, workshop: () => flags.workshop, narrator: () => o.narrator ?? 'voice', prewarm: o.prewarm,
  };
  const doc = new Documentary(deps);
  const agents = new Map<string, AgentView>();
  const w: DirectorWorld = { now: 0, hours: 9, night: false, camera: { x: 0, y: 10, z: 0 }, agent: (id) => agents.get(id) ?? null,
    agents: () => [...agents.values()], viewpoints: [], ground: () => 0 };
  /** Step the documentary `s` seconds in 0.05 s frames (one frame when 0). */
  const step = (s = 0) => {
    const n = Math.max(1, Math.round(s / 0.05));
    for (let i = 0; i < n; i++) {
      if (s > 0) w.now += 0.05;
      doc.frame(s > 0 ? 0.05 : 0, w, pose());
    }
  };
  /** An animal standing at (`x`, `z`), for a shot to start at. */
  const agentAt = (id: string, x: number, z: number) => void agents.set(id, { id, pos: { x, y: 0, z } } as AgentView);
  return { doc, views, planner, voice, ui, subs, ducks, clock, docClock, flags, picked, w, step, tales, agentAt, books: () => updates };
}

describe('Documentary', () => {
  it('start shows the bars, the hint and the title, holds the clock, and drives the planner\'s shots into the views', () => {
    const t = setup();
    t.doc.start();
    expect(t.doc.on).toBe(true);
    expect(t.ui.log).toEqual(['bars true', 'hint Any button: take over · A: follow this animal']);
    expect(t.planner.skips).toBe(1); // a fresh scene
    t.planner.queue.push({ scene: story('a'), shot: directed() });
    t.step();
    expect(t.views.calls).toEqual(['direct drift']);
    expect(t.ui.log).toContain(`title ${partOfDay(9)} in the valley`);
    expect(partOfDay(9)).toBe('Morning');
    expect(t.books()).toBe(1);
    // a tracking shot placed at once (a cut), its framing set; an eased one on the same animal switches view; on another, a glide
    t.planner.queue.push({ shot: ride('follow', { framing: { orbit: { yaw: 1.4, pitch: 0.2 } } }) });
    t.step();
    expect(t.views.calls.at(-1)).toBe('place fox#0 follow');
    expect(t.views.framing).toEqual({ orbit: { yaw: 1.4, pitch: 0.2 } });
    t.planner.queue.push({ shot: ride('close', { join: 'ease' }) });
    t.step();
    expect(t.views.calls.at(-1)).toBe('setView close');
    expect(t.views.framing).toEqual({});
    t.planner.queue.push({ shot: ride('follow', { join: 'ease', subject: 'deer#2' }) });
    t.step();
    expect(t.views.calls.at(-1)).toBe('lock deer#2 follow');
    // the hint fades after 5 s, the title after 6
    t.step(6.1);
    expect(t.ui.log).toContain('hint null');
    expect(t.ui.log).toContain('title null');
  });

  it('a directed shot joined with an ease blends into its move over the time a view switch takes; a cut starts at once', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: directed({ join: 'ease' }) }, { shot: directed({ join: 'cut' }) });
    t.step();
    t.step();
    expect(t.views.calls).toEqual([`direct drift ease ${SWITCH_S}`, 'direct drift']);
  });

  it('a dip shot dips for 0.6 s around the cut', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: directed({ join: 'dip' }) });
    t.step();
    expect(t.ui.log.at(-1)).toBe('dip true');
    expect(t.views.calls).toEqual([]); // still the old picture, going to black
    t.step(0.25);
    expect(t.views.calls).toEqual([]);
    t.step(0.05);
    expect(t.views.calls).toEqual(['direct drift']); // the cut, in the black
    expect(t.ui.log).not.toContain('dip false'); // the black stays while the new spot's first frame is drawn
    t.step();
    t.step();
    expect(t.ui.log).toContain('dip false');
  });

  /** A pre-warm the test makes ready, recording where it warmed and how often it was let go. */
  const warmer = () => {
    const w = { ready: false, at: [] as { x: number; y: number; z: number }[], done: 0 };
    return { w, prewarm: (at: { x: number; y: number; z: number }) => (w.at.push(at), { ready: () => w.ready, done: () => void w.done++ }) };
  };

  it('a far cut sets the second eye only once the screen is fully black, with no lead, and waits for it to be ready', () => {
    expect([DIP_S, WARM_WAIT_S]).toEqual([0.6, 1.5]);
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }) });
    t.step();
    t.step(); // the far shot comes due: the fade begins at once (no lead), the old shot plays on
    expect(t.ui.log).toContain('dip true');
    expect(w.at).toEqual([]);
    t.step(0.2);
    expect(w.at).toEqual([]); // still fading in (0.3 s)
    t.step(0.15);
    expect(w.at).toHaveLength(1); // black: now the second eye is set
    expect(t.views.calls).toEqual(['place fox#0 close']);
    t.step(1.2);
    expect(t.views.calls).toEqual(['place fox#0 close']); // not ready: the black holds
    w.ready = true;
    t.step(0.15);
    expect(t.views.calls.at(-1)).toBe('direct drift'); // ready: the cut
    t.step();
    t.step();
    expect(t.ui.log.at(-1)).toBe('dip false');
    expect(w.done).toBe(1);
  });

  it('the cut goes anyway after the 1.5 s cap on the black', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }) });
    t.step();
    t.step();
    t.step(0.35);
    t.step(1.4);
    expect(t.views.calls).toEqual(['place fox#0 close']);
    t.step(0.2);
    expect(t.views.calls.at(-1)).toBe('direct drift');
    expect(w.ready).toBe(false);
  });

  it('a near cut needs no pre-warm', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: directed({ join: 'cut' }) }, { shot: ride('close', { join: 'ease' }) }, { shot: ride('follow') });
    t.step();
    t.step();
    t.step();
    expect(w.at).toEqual([]);
    expect(t.views.calls).toEqual(['direct drift', 'lock fox#0 close', 'place fox#0 follow']);
  });

  it('a far cut-away goes black at once, with no fade (a catch must not be seen), warming in the black like any far cut', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    w.ready = true;
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ kind: 'cutaway', join: 'dip' }) });
    t.step();
    t.step();
    expect(t.ui.log.at(-1)).toBe('dip true at once');
    t.step(0.05);
    expect(w.at).toHaveLength(1); // already black: warmed on the very next frame (ready at once here: the cut too)
    expect(t.views.calls.at(-1)).toBe('direct drift');
    expect(t.ui.log).not.toContain('dip false'); // the cut is made on black
  });

  it('a cut-away to a spot never drawn leaves the chase on the very next frame: black at once, never a fading chase', () => {
    const log: string[] = [];
    const prewarm = () => (log.push('warm'), { ready: () => true, done: () => void 0, prime: (p: 0 | 1) => void log.push(`prime ${p}`) });
    const t = setup({ prewarm });
    t.doc.start();
    t.agentAt('fox#0', 5, 0); // the hunter, by the camera
    t.agentAt('hare#0', 90, 0); // the bystander, 90 m off: a cell the camera has not drawn
    t.planner.queue.push({ scene: story('a'), shot: ride('follow', { kind: 'tracking' }) });
    t.step(0.05);
    expect(t.views.calls).toEqual(['place fox#0 follow']); // riding the chase
    t.ui.log.length = 0;
    t.planner.queue.push({ shot: directed({ kind: 'cutaway', join: 'cut', subject: 'hare#0' }) });
    t.step(0.05);
    expect(t.ui.log).toEqual(['dip true at once']); // black on this frame: no 0.3 s fade with the chase on screen
    t.step(0.05);
    expect(log).toEqual(['warm', 'prime 0']); // the warm, the prime and the cut all run on the black
    expect(t.views.calls).toEqual(['place fox#0 follow']);
    for (let n = 0; n < 2; n++) t.step(0.05);
    expect(log).toEqual(['warm', 'prime 0', 'prime 1']);
    expect(t.views.calls.at(-1)).toBe('direct drift');
    expect(t.ui.log).not.toContain('dip false');
    t.step(0.05);
    t.step(0.05);
    expect(t.ui.log.at(-1)).toBe('dip false'); // the black lifts on the cut-away
  });

  it('a cut-away to a spot just drawn is a hard cut, no black at all', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.agentAt('fox#0', 5, 0);
    t.agentAt('hare#0', 10, 0);
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { shot: directed({ kind: 'cutaway', join: 'cut', subject: 'hare#0' }) });
    t.step(0.05);
    t.step(0.05);
    expect(t.views.calls).toEqual(['place fox#0 follow', 'direct drift']);
    expect(t.ui.log.filter((l) => l.startsWith('dip'))).toEqual([]);
    expect(w.at).toEqual([]);
  });

  it('a cut-away coming due while a calm dip still fades in turns the screen black at once', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }) });
    t.step();
    t.step();
    t.step(0.1);
    expect(t.ui.log.at(-1)).toBe('dip true'); // a calm far cut: fading
    t.planner.queue.push({ shot: directed({ kind: 'cutaway', join: 'dip', subject: 'deer#3' }) });
    t.step(0.05);
    expect(t.ui.log.at(-1)).toBe('dip true at once');
    t.step(0.05);
    expect(w.at).toHaveLength(1); // the cut-away's spot, warmed in the black on the next frame
  });

  it('a newer far shot during a cut warms its own spot; a near drawn one is cut to at once', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }) });
    t.step();
    t.step();
    t.step(0.4);
    expect(w.at).toHaveLength(1);
    t.planner.queue.push({ shot: directed({ kind: 'cutaway', join: 'dip', subject: 'deer#3' }) });
    t.step(0.05); // the cut-away comes due in the black: the first spot is let go...
    t.step(0.05); // ...and its own is warmed in its place
    expect(w.at).toHaveLength(2);
    expect(w.done).toBe(1);
    w.ready = true;
    t.step(0.1);
    expect(t.views.calls.at(-1)).toBe('direct drift');
    // a near shot during a cut: the far cut is given up for it
    w.ready = false;
    t.planner.queue.push({ shot: directed({ join: 'dip' }) }, { shot: ride('follow') });
    t.step(0.05);
    t.step(0.05);
    expect(t.views.calls.at(-1)).toBe('place fox#0 follow');
    t.step();
    t.step();
    expect(t.ui.log.at(-1)).toBe('dip false');
  });

  it('a far shot of a story come to a catch goes black at once', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    t.tales.set('hunt', { ...story('hunt'), tag: 'catch', hunt: { hunter: 'fox#0', prey: 'rabbit#0', beat: 'catch' } });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip', story: 'hunt' }) });
    t.step();
    t.step();
    expect(t.ui.log.at(-1)).toBe('dip true at once');
    t.step(0.05);
    expect(w.at).toHaveLength(1);
  });

  it('a near cut to a spot the camera has not drawn dips; to one it has drawn, it does not', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm });
    w.ready = true;
    t.doc.start();
    t.agentAt('fox#0', 500, 0); // 500 m off: far from every cell the camera has drawn
    t.agentAt('deer#3', 10, 0); // 10 m from the camera, which has drawn its cell
    t.planner.queue.push({ scene: story('a'), shot: ride('close', { join: 'cut' }) });
    t.step();
    expect(t.ui.log).toContain('dip true'); // a cut, upgraded: first sights happen in the black
    expect(t.views.calls).toEqual([]);
    t.step(0.5);
    expect(w.at).toHaveLength(1);
    expect(t.views.calls).toEqual(['place fox#0 close']);
    t.step(0.3);
    expect(t.ui.log.at(-1)).toBe('dip false');
    t.planner.queue.push({ shot: ride('close', { join: 'cut', subject: 'deer#3' }) });
    t.step(); // a drawn spot: cut to at once, nothing warmed
    expect(t.views.calls.at(-1)).toBe('place deer#3 close');
    expect(w.at).toHaveLength(1);
  });

  it('the second eye is primed while the screen is fully black, and the cut follows', () => {
    const log: string[] = [];
    const prewarm = () => (log.push('warm'), { ready: () => true, done: () => void 0, prime: (p: 0 | 1) => void log.push(`prime ${p}`) });
    const t = setup({ prewarm });
    t.doc.start();
    t.agentAt('fox#0', 500, 0);
    t.planner.queue.push({ scene: story('a'), shot: ride('close', { join: 'cut' }) });
    t.step();
    t.step(0.25);
    expect(log).toEqual([]); // the dip is still fading in (0.3 s)
    for (let n = 0; n < 12 && log.length < 3; n++) t.step(0.05);
    expect(log).toEqual(['warm', 'prime 0', 'prime 1']); // the animals, then the plants, a frame apart
    expect(t.views.calls).toEqual([]); // the cut comes after both
    t.step();
    expect(t.views.calls).toHaveLength(1);
    expect(t.ui.log).toContain('dip true');
    expect(t.ui.log).not.toContain('dip false'); // still black at the cut
  });

  it('no line starts while a far cut is under way', () => {
    const { w, prewarm } = warmer(), t = setup({ prewarm, narrator: 'words' });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }), lines: ['opener'] });
    t.step();
    t.step();
    t.step(1);
    expect(t.subs).toEqual([]);
    w.ready = true;
    t.step(0.6);
    expect(t.views.calls.at(-1)).toBe('direct drift');
    expect(t.subs).toEqual(['the opener line']);
  });

  it('takeOver(free) mid-dip clears the dip at once, lets go where the camera is, gives the clock back, hides the bars and stops the voice', () => {
    const t = setup({ paused: true });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close') }, { shot: directed({ join: 'dip' }) });
    t.step();
    t.step();
    t.ui.log.length = 0;
    t.doc.takeOver('free');
    expect(t.doc.on).toBe(false);
    expect(t.ui.log).toEqual(expect.arrayContaining(['dip false', 'bars false', 'hint null', 'title null']));
    expect(t.views.calls.at(-1)).toBe('letGo');
    expect(t.views.framing).toEqual({});
    expect(t.voice.stops).toBeGreaterThan(0);
    expect(t.clock).toEqual({ speed: DEFAULT_SPEED, paused: true });
    // nothing more happens: the shot waiting in the black is never cut to
    const calls = t.views.calls.length, updates = t.planner.updates;
    t.step(1);
    expect(t.views.calls.length).toBe(calls);
    expect(t.planner.updates).toBe(updates);
  });

  it('takeOver(lock) keeps the lock in the view being shown, or locks on to a directed shot\'s animal', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('close', { framing: { distance: 2 } }) });
    t.step();
    t.doc.takeOver('lock');
    expect(t.views.calls).toEqual(['place fox#0 close']); // no letting go, no new glide: Close goes on, as if locked on by hand
    expect(t.views.state).toMatchObject({ mode: 'locked', id: 'fox#0', view: 'close' });
    expect(t.views.framing).toEqual({});

    const d = setup();
    d.doc.start();
    d.planner.queue.push({ scene: story('a'), shot: directed({ subject: 'deer#1' }) });
    d.step();
    d.doc.takeOver('lock');
    expect(d.views.calls.at(-1)).toBe('lock deer#1 follow');

    const v = setup();
    v.doc.start();
    v.planner.queue.push({ scene: story('v', null), shot: directed({ subject: null }) });
    v.step();
    v.doc.takeOver('lock');
    expect(v.views.calls.at(-1)).toBe('letGo'); // a vista has no animal: free flight
  });

  it('the subject going mid-shot: a new shot, not a fight with the views', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') });
    t.step();
    const skips = t.planner.skips;
    t.views.set('free'); // the views let go: the animal went back to the earth
    t.planner.queue.push({ scene: story('b', null), shot: directed({ subject: null }) });
    t.step();
    expect(t.planner.skips).toBe(skips + 1);
    expect(t.views.calls).toEqual(['place fox#0 follow', 'direct drift']); // never placed on the gone animal again
    t.step(1);
    expect(t.planner.skips).toBe(skips + 1); // the new shot stands
  });

  it('the clock: Paused before the start, Normal while on, Paused after', () => {
    const t = setup({ paused: true });
    t.doc.start();
    expect(t.clock).toEqual({ speed: DEFAULT_SPEED, paused: false });
    expect(t.docClock.remembered).toEqual({ speed: DEFAULT_SPEED, paused: true }); // the save keeps the player's
    t.doc.takeOver('free');
    expect(t.clock).toEqual({ speed: DEFAULT_SPEED, paused: true });
    expect(t.docClock.remembered).toBeNull();
  });

  it('a time-lapse runs at Fastest; taking over mid time-lapse gives the player\'s speed back, not Fastest', () => {
    const fast = 1 / 15, t = setup({ speed: fast });
    t.doc.start();
    t.planner.queue.push({ scene: story('v', null), shot: directed({ kind: 'timelapse', subject: null, clock: 'fastest' }) });
    t.step();
    expect(t.clock).toEqual({ speed: FASTEST_SPEED, paused: false });
    expect(t.docClock.remembered).toEqual({ speed: fast, paused: false }); // saved: the player's speed
    t.planner.queue.push({ shot: directed() });
    t.step();
    expect(t.clock.speed).toBe(DEFAULT_SPEED); // the next shot is at Normal
    t.planner.queue.push({ shot: directed({ kind: 'timelapse', clock: 'fastest' }) });
    t.step();
    t.doc.takeOver('free');
    expect(t.clock).toEqual({ speed: fast, paused: false });
  });

  it('a speed picked in the menu over it is the player\'s to have back; the documentary keeps Normal', () => {
    const c = { speed: DEFAULT_SPEED, paused: false }, h = new DocClock(c);
    h.hold();
    Object.assign(c, { speed: 1 / 15, paused: false }); // the menu sets Fast
    h.playerChanged();
    expect(c).toEqual({ speed: DEFAULT_SPEED, paused: false });
    expect(h.remembered).toEqual({ speed: 1 / 15, paused: false });
    h.release();
    expect(c.speed).toBe(1 / 15);
  });

  it('the menu pauses the voice and keeps filming', () => {
    const t = setup();
    t.voice.ready.add('the checkin line');
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { lines: ['checkin'] });
    t.step();
    t.step();
    expect(t.voice.played).toEqual(['the checkin line']);
    t.doc.menu(true);
    expect(t.voice.paused).toEqual([true]);
    expect(t.ducks).toEqual([true, false]); // nothing is spoken under the menu: the soundscape comes back up
    t.planner.queue.push({ shot: ride('close', { join: 'ease' }) });
    t.step();
    expect(t.views.calls.at(-1)).toBe('setView close'); // still filming
    t.doc.menu(false);
    expect(t.voice.paused).toEqual([true, false]);
    expect(t.ducks).toEqual([true, false, true]);
  });

  it('no line starts while the menu is up; one waiting starts once it closes', () => {
    const t = setup({ narrator: 'words' });
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') });
    t.step();
    t.doc.menu(true);
    t.planner.queue.push({ lines: ['checkin'] });
    t.step(1);
    expect(t.subs).toEqual([]);
    t.doc.menu(false);
    t.step();
    expect(t.subs).toEqual(['the checkin line']);
  });

  it('an arrival suspends it (no shots) until it is over, then films afresh', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: directed() });
    t.step();
    t.flags.arrival = true;
    t.views.set('free'); // the arrival let go of the views
    const updates = t.planner.updates, skips = t.planner.skips;
    t.planner.queue.push({ shot: directed() });
    t.step(2);
    expect(t.planner.updates).toBe(updates);
    expect(t.views.calls).toEqual(['direct drift']);
    t.flags.arrival = false;
    t.step();
    expect(t.planner.skips).toBe(skips + 1); // a fresh scene: the new family first, as the planner rates it
    expect(t.views.calls).toEqual(['direct drift', 'direct drift']);
    expect(t.doc.on).toBe(true);
  });

  it('the workshop pauses it', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: directed() });
    t.step();
    t.flags.workshop = true;
    const updates = t.planner.updates, skips = t.planner.skips;
    t.step(3);
    expect(t.planner.updates).toBe(updates);
    t.flags.workshop = false;
    t.step();
    expect(t.planner.updates).toBe(updates + 1);
    expect(t.planner.skips).toBe(skips); // a calm shot carries on where it was
  });

  it('a pause mid time-lapse (the workshop, an arrival) puts the clock back to Normal and abandons the time-lapse', () => {
    for (const pause of ['workshop', 'arrival'] as const) {
      const t = setup({ paused: true });
      t.doc.start();
      t.planner.queue.push({ scene: story('v', null), shot: directed({ kind: 'timelapse', subject: null, clock: 'fastest' }) });
      t.step();
      expect(t.clock.speed).toBe(FASTEST_SPEED);
      t.flags[pause] = true;
      t.step(5);
      expect(t.clock).toEqual({ speed: DEFAULT_SPEED, paused: false }); // Normal: the documentary's hold stays
      expect(t.docClock.remembered).toEqual({ speed: DEFAULT_SPEED, paused: true });
      const skips = t.planner.skips;
      t.flags[pause] = false;
      t.planner.queue.push({ scene: story('a'), shot: directed() });
      t.step();
      expect(t.planner.skips).toBe(skips + 1); // a fresh scene, not the rest of the time-lapse
      expect(t.clock.speed).toBe(DEFAULT_SPEED);
    }
  });

  it('an arrival begun over a time-lapse gives back Fastest as it ends: the documentary resumes at Normal', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('v', null), shot: directed({ kind: 'timelapse', subject: null, clock: 'fastest' }) });
    t.step();
    expect(t.clock.speed).toBe(FASTEST_SPEED);
    const found = { ...t.clock }; // what the arrival's own hold remembers as it begins (Fastest)
    t.flags.arrival = true;
    t.step(1);
    t.flags.arrival = false;
    Object.assign(t.clock, found); // the arrival over: it gives back what it found
    t.planner.queue.push({ scene: story('a'), shot: directed({ join: 'dip' }) }); // a dip: no shot applied for 0.6 s
    t.step();
    expect(t.clock.speed).toBe(DEFAULT_SPEED);
    t.step(0.3);
    expect(t.clock.speed).toBe(DEFAULT_SPEED);
  });

  it("A during a cut-away's black locks on to the shot waiting in it (placed at once), never the hunter the views still ride", () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow', { subject: 'fox#0' }) },
      { shot: directed({ kind: 'cutaway', join: 'dip', subject: 'hare#0' }) });
    t.step();
    t.step();
    expect(t.views.state).toMatchObject({ mode: 'locked', id: 'fox#0' }); // the views still ride the hunter
    t.doc.takeOver('lock');
    expect(t.views.calls.at(-1)).toBe('place hare#0 follow');
    // a sky cut-away (no animal): let go
    const v = setup();
    v.doc.start();
    v.planner.queue.push({ scene: story('a'), shot: ride('follow', { subject: 'fox#0' }) },
      { shot: directed({ kind: 'cutaway', join: 'dip', subject: null }) });
    v.step();
    v.step();
    v.doc.takeOver('lock');
    expect(v.views.calls.at(-1)).toBe('letGo');
  });

  it('A during a release arrival takes over without touching the views: the arrival keeps its camera', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') });
    t.step();
    t.flags.arrival = true;
    t.views.set('free'); // the arrival let go of the views
    t.step();
    const calls = t.views.calls.length;
    t.doc.takeOver('lock');
    expect(t.doc.on).toBe(false);
    expect(t.views.calls.length).toBe(calls); // no lock on the animal from before the arrival, no letting go
    expect(t.ui.log).toContain('bars false');
    // the same when the arrival began this frame, before the documentary saw it
    const n = setup();
    n.doc.start();
    n.planner.queue.push({ scene: story('a'), shot: directed() });
    n.step();
    n.flags.arrival = true;
    n.doc.takeOver('lock');
    expect(n.views.calls).toEqual(['direct drift']);
  });

  it('started on the map, it closes the map first', () => {
    const t = setup();
    t.views.set('map');
    t.doc.start();
    expect(t.views.calls).toEqual(['closeMap']);
    t.planner.queue.push({ scene: story('a'), shot: directed() });
    t.step();
    expect(t.views.calls).toEqual(['closeMap', 'direct drift']);
  });

  it('a line cue becomes speech, ducking the soundscape while spoken', () => {
    const t = setup();
    t.voice.ready.add('the checkin line');
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { lines: ['checkin'] });
    t.step();
    t.step();
    expect(t.voice.prefetched).toContain('the checkin line');
    expect(t.voice.played).toEqual(['the checkin line']);
    expect(t.subs.at(-1)).toBe('the checkin line');
    expect(t.ducks).toEqual([true]);
    t.voice.end!();
    expect(t.subs.at(-1)).toBeNull();
    expect(t.ducks).toEqual([true, false]);
  });

  it('a line whose voice is not ready in time is words only, for 3 s and 0.3 s a word', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { lines: ['checkin'] });
    t.step();
    t.step();
    expect(t.subs).toEqual([]); // waiting a moment for the voice
    t.step(VOICE_WAIT_S + 0.05);
    expect(t.subs.at(-1)).toBe('the checkin line');
    expect(t.ducks).toEqual([]); // words only: nothing to duck under
    t.step(wordsOnlySeconds('the checkin line') + 0.1);
    expect(t.subs.at(-1)).toBeNull();
  });

  it('words only and off', () => {
    const w = setup({ narrator: 'words' });
    w.voice.ready.add('the checkin line');
    w.doc.start();
    w.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { lines: ['checkin'] });
    w.step();
    w.step();
    expect(w.subs.at(-1)).toBe('the checkin line');
    expect(w.voice.played).toEqual([]);
    expect(w.voice.prefetched).toEqual([]);

    const o = setup({ narrator: 'off' });
    o.doc.start();
    o.planner.queue.push({ scene: story('a'), shot: ride('follow') }, { lines: ['checkin'] });
    o.step(2);
    expect(o.subs).toEqual([]);
    expect(o.picked).toEqual([]);
  });

  it('the opener is prefetched when the planner names the scene; the run\'s first is a greeting, a welcome after a long gap', () => {
    const t = setup();
    t.doc.start();
    t.planner.queue.push({ scene: story('a'), opening: 'opener', shot: directed() });
    t.step();
    expect(t.picked).toEqual(['first']);
    expect(t.voice.prefetched).toEqual(['the first line']);
    // the next scene's opener, as it is named
    t.planner.queue.push({ scene: story('b'), opening: 'meanwhile', shot: directed() });
    t.step();
    expect(t.voice.prefetched).toEqual(['the first line', 'the meanwhile line']);
    // the opener cue comes ~2 s in: the words picked ahead are the ones said
    t.voice.ready.add('the meanwhile line');
    t.planner.queue.push({ lines: ['meanwhile'] });
    t.step();
    expect(t.voice.played).toEqual(['the meanwhile line']);
    expect(t.picked).toEqual(['first', 'meanwhile']);
    t.voice.end!();

    t.doc.takeOver('free');
    t.w.now += 60;
    t.doc.start();
    t.planner.queue.push({ scene: story('c'), opening: 'opener', shot: directed() });
    t.step();
    expect(t.picked.at(-1)).toBe('first'); // a short break: a fresh greeting
    t.doc.takeOver('free');
    t.w.now += WELCOME_GAP_S + 1;
    t.doc.start();
    t.planner.queue.push({ scene: story('d'), opening: 'opener', shot: directed() });
    t.step();
    expect(t.picked.at(-1)).toBe('welcome');
  });
});
