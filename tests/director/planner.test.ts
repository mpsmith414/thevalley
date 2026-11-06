import { describe, expect, it } from 'vitest';
import { OPENER_AT_S, Planner, type LineCue, type Shot } from '../../src/director/planner';
import { joinOf } from '../../src/director/shots';
import type { AgentView, DirectorWorld, Story } from '../../src/director/types';
import type { VantageWorld } from '../../src/director/vantage';
import { surfaceAt } from '../../src/camera/freefly';
import { movePose } from '../../src/views/directed';
import type { Pose } from '../../src/views/types';
import type { Viewpoint } from '../../src/valley/types';
import { mulberry32 } from '../../src/util/rng';
import { HIGH, LOW } from '../../src/sim/types';

const DEG = Math.PI / 180;

/** Gentle rolling ground, no trees, no water: a valley 2 km across. */
const valley: VantageWorld = {
  heightAt: (x, z) => 2 * Math.sin(x / 50) + 2 * Math.cos(z / 70),
  isWater: () => false,
  waterLevelAt: () => NaN,
  trunksNear: () => [],
  inside: (x, z) => Math.abs(x) < 1000 && Math.abs(z) < 1000,
};
const ground = (x: number, z: number) => valley.heightAt(x, z);

const agent = (id: string, x: number, z: number, o: Partial<AgentView> = {}): AgentView => ({ id, species: id.split('#')[0], name: id,
  native: true, released: false, doing: 'walk', group: null, focus: null, pos: { x, y: ground(x, z), z }, size: 1, bodyLength: 0.8,
  flying: false, altitude: 0, swimmer: false, wet: false, hunter: false, grazer: false, plural: false, ...o });

const viewpoints: Viewpoint[] = [
  { name: 'Lake Shore', pos: { x: -300, z: 200, h: 6 }, look: { x: -200, z: 120, h: 0 } },
  { name: 'High Ridge', pos: { x: 400, z: -300, h: 12 }, look: { x: 250, z: -200, h: 0 } },
  { name: 'Meadow', pos: { x: 0, z: 400, h: 5 }, look: { x: 60, z: 320, h: 0 } },
];

/** A scripted valley the tests change as they go: its animals, its stories, the hour and the clock. */
class Scene {
  now = 0;
  night = false;
  sunElevation: number | undefined = undefined;
  agents: AgentView[] = [];
  stories: Story[] = [];
  camera: Pose = { pos: { x: 0, y: 30, z: 0 }, yaw: 0, pitch: 0 };
  timelapses = false;
  planner: Planner;
  shots: { at: number; shot: Shot }[] = [];
  lines: { at: number; cue: LineCue }[] = [];
  scenes: { at: number; scene: Story | null }[] = [];
  constructor(seed = 1, vps = viewpoints) {
    this.vps = vps;
    this.planner = new Planner({ world: valley, rng: mulberry32(seed), timelapses: () => this.timelapses, stories: () => this.stories });
  }
  vps: Viewpoint[];
  world(): DirectorWorld {
    return { now: this.now, hours: this.night ? 23 : 10, night: this.night, camera: this.camera.pos, viewpoints: this.vps,
      agent: (id) => this.agents.find((a) => a.id === id) ?? null, agents: () => this.agents, ground, sunElevation: this.sunElevation };
  }
  /** One update; returns the shot that started on it, if any. */
  step(dt = 0.5): Shot | null {
    this.now += dt;
    const r = this.planner.update(this.world(), this.camera);
    if (r.shot) this.shots.push({ at: this.now, shot: r.shot });
    for (const cue of r.lines) this.lines.push({ at: this.now, cue });
    if (r.scene !== (this.scenes.at(-1)?.scene ?? undefined)) this.scenes.push({ at: this.now, scene: r.scene });
    return r.shot;
  }
  run(seconds: number, dt = 0.5) {
    for (let t = 0; t < seconds; t += dt) this.step(dt);
  }
  agent(id: string) {
    return this.agents.find((a) => a.id === id)!;
  }
}

const story = (o: Partial<Story> & { id: string }): Story => ({ kind: 'checkin', tag: 'herd', subject: null, actors: [], species: [],
  at: { x: 0, z: 0 }, interest: LOW, born: 0, live: true, released: false, hunt: null, ...o });

const herd = (s: Scene, x = 20, z = 10, n = 3) => {
  const ids = Array.from({ length: n }, (_, i) => `deer#${i}`);
  s.agents.push(...ids.map((id, i) => agent(id, x + i * 2, z + i, { doing: 'graze', group: 'g1', grazer: true, plural: n > 1, size: 1.6, bodyLength: 1.4 })));
  const st = story({ id: 'herd:g1', subject: ids[0], actors: ids, species: ['deer'], at: { x, z } });
  s.stories.push(st);
  return st;
};

const hunt = (s: Scene, beat: 'creep' | 'chase' = 'creep', x = 30, z = -20): Story => {
  s.agents.push(agent('fox#0', x, z, { doing: beat === 'creep' ? 'stalk' : 'chase', focus: 'rabbit#0', hunter: true, size: 0.9, bodyLength: 0.8 }));
  s.agents.push(agent('rabbit#0', x + 20, z + 5, { size: 0.4, bodyLength: 0.35 }));
  const st = story({ id: 'hunt:fox#0', kind: 'event', tag: beat === 'creep' ? 'stalk' : 'chase', subject: 'fox#0', actors: ['fox#0', 'rabbit#0'],
    species: ['fox', 'rabbit'], at: { x, z }, interest: HIGH, hunt: { hunter: 'fox#0', prey: 'rabbit#0', beat } });
  s.stories.push(st);
  return st;
};

const forward = (p: Pose) => ({ x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) });
/** The angle (radians) between where a pose faces and the direction to `at`. */
const offAxis = (p: Pose, at: { x: number; y: number; z: number }) => {
  const f = forward(p), d = { x: at.x - p.pos.x, y: at.y - p.pos.y, z: at.z - p.pos.z }, l = Math.hypot(d.x, d.y, d.z);
  return Math.acos(Math.max(-1, Math.min(1, (f.x * d.x + f.y * d.y + f.z * d.z) / l)));
};

/** Every pose a shot's move passes through is real and clear of the ground. */
const expectSanePoses = (shots: Shot[]) => {
  for (const sh of shots) {
    expect(Number.isFinite(sh.s)).toBe(true);
    if (!sh.move) continue;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const p = movePose(sh.move, sh.move.s * f, valley);
      for (const v of [p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch]) expect(Number.isFinite(v)).toBe(true);
      expect(p.pos.y).toBeGreaterThanOrEqual(surfaceAt(valley, p.pos.x, p.pos.z) + 1.5 - 1e-6);
    }
    // the move as built is sane too, not only after movePose's clamp
    const m = sh.move, raw = m.kind === 'hold' ? [m.pose] : m.kind === 'drift' ? [m.from, m.to] : [];
    for (const p of raw) expect(p.pos.y).toBeGreaterThanOrEqual(surfaceAt(valley, p.pos.x, p.pos.z) + 1.5 - 1e-6);
  }
};

/** The shots of the first scene, with how long the scene ran. */
const firstScene = (s: Scene, limit = 200) => {
  const first = s.step();
  const scene = s.planner.scene;
  s.stories = s.stories.filter((x) => x !== scene); // later scenes go elsewhere, so the first one's end shows
  const start = s.now;
  while (s.planner.scene === scene && s.now - start < limit) s.step();
  return { shots: [first!, ...s.shots.slice(1).filter((x) => x.at < s.now).map((x) => x.shot)], length: s.now - start };
};

describe('Planner: a calm scene', () => {
  it('a calm scene is establishing, then tracking or group, then close, maybe eyes, then tracking, 30–75 s in all', () => {
    let eyes = 0, groups = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = new Scene(seed);
      herd(s);
      const { shots, length } = firstScene(s);
      const kinds = shots.map((x) => x.kind);
      expect(kinds[0]).toBe('establishing');
      expect(['tracking', 'group']).toContain(kinds[1]);
      expect(kinds[2]).toBe('close');
      expect(kinds.slice(3)).toEqual(kinds.length === 5 ? ['eyes', 'tracking'] : ['tracking']);
      expect(length).toBeGreaterThanOrEqual(30);
      expect(length).toBeLessThanOrEqual(75.5);
      for (const sh of shots) expect(sh.story).toBe('herd:g1');
      eyes += kinds.includes('eyes') ? 1 : 0;
      groups += kinds.includes('group') ? 1 : 0;
      expectSanePoses(shots);
    }
    // "maybe": some scenes glimpse through the eyes and some do not; a herd is sometimes filmed as a group
    expect(eyes).toBeGreaterThan(0);
    expect(eyes).toBeLessThan(12);
    expect(groups).toBeGreaterThan(0);
  });

  it('eyes at most once a scene and 4–6 s', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = new Scene(seed);
      herd(s);
      const { shots } = firstScene(s);
      const eyes = shots.filter((x) => x.kind === 'eyes');
      expect(eyes.length).toBeLessThanOrEqual(1);
      for (const e of eyes) {
        expect(e.s).toBeGreaterThanOrEqual(4);
        expect(e.s).toBeLessThanOrEqual(6);
        expect(e.view).toBe('eyes');
      }
    }
  });

  it('shots on an animal ride it through the views; the rest are directed moves', () => {
    const s = new Scene(3);
    herd(s);
    const { shots } = firstScene(s);
    for (const sh of shots) {
      if (['tracking', 'behind', 'close', 'eyes'].includes(sh.kind)) {
        expect(sh.view).toBeDefined();
        expect(sh.move).toBeUndefined();
        expect(sh.subject).toMatch(/^deer#/);
      } else expect(sh.move).toBeDefined();
    }
    const tracking = shots.filter((x) => x.kind === 'tracking');
    for (const t of tracking) {
      const o = t.framing?.orbit;
      expect(o).toBeDefined();
      // side-on, or low
      expect(Math.abs(o!.yaw) >= 70 * DEG - 1e-9 && Math.abs(o!.yaw) <= 90 * DEG + 1e-9 || (o!.pitch >= 8 * DEG - 1e-9 && o!.pitch <= 12 * DEG + 1e-9)).toBe(true);
    }
  });
});

describe('Planner: joins', () => {
  const at = (x: number, z: number, yaw = 0): Pose => ({ pos: { x, y: 10, z }, yaw, pitch: 0 });

  it('joinOf: far is a dip, a long move or a big turn is a cut, otherwise an ease', () => {
    expect(joinOf(at(0, 0), at(200, 0))).toBe('dip');
    expect(joinOf(at(0, 0), at(25, 0))).toBe('cut');
    expect(joinOf(at(0, 0), at(5, 0, 70 * DEG))).toBe('cut');
    expect(joinOf(at(0, 0), at(5, 0, 30 * DEG))).toBe('ease');
    expect(joinOf(at(0, 0), at(15, 0))).toBe('ease');
  });

  it('the first shot of a scene far from the camera joins with a dip; within a scene a jump over 20 m or a turn over 60° cuts, otherwise eases', () => {
    const far = new Scene(2);
    herd(far, 400, 300);
    expect(far.step()!.join).toBe('dip');

    // the camera stays a few metres from a lone duck, looking at it: the shots on the duck ease, the far wide shots cut
    const s = new Scene(5);
    s.agents.push(agent('duck#0', 20, 10, { swimmer: true, size: 0.5 }));
    s.stories.push(story({ id: 'water:duck#0', tag: 'water', subject: 'duck#0', actors: ['duck#0'], species: ['duck'], at: { x: 20, z: 10 } }));
    const duck = s.agents[0].pos;
    s.camera = { pos: { x: 20, y: duck.y + 2, z: 15 }, yaw: 0, pitch: -0.3 };
    const { shots } = firstScene(s);
    expect(shots[0].kind).toBe('establishing');
    expect(shots[0].join).not.toBe('dip');
    for (const sh of shots.slice(1)) {
      if (sh.move) expect(sh.join).toBe('cut');
      else expect(sh.join).toBe('ease');
    }
  });
});

describe('Planner: a hunt', () => {
  it('creep → close on the hunter; chase → tracking with framing.wide; the scene does not end while the chase runs', () => {
    const s = new Scene(4);
    const h = hunt(s);
    s.run(20);
    expect(s.planner.scene).toBe(h);
    const close = s.shots.find((x) => x.shot.kind === 'close');
    expect(close?.shot.subject).toBe('fox#0');

    h.hunt!.beat = 'chase';
    h.tag = 'chase';
    s.agent('fox#0').doing = 'chase';
    const shot = s.step();
    expect(shot).toMatchObject({ kind: 'tracking', subject: 'fox#0', view: 'follow', framing: { wide: true } });
    const before = s.shots.length;
    s.run(120);
    expect(s.planner.scene).toBe(h);
    expect(s.shots.length).toBe(before); // the wide tracking shot holds
  });

  it('cuts away before the catch when hunter and prey are within 3 body lengths: a cutaway, never a shot of the prey', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = new Scene(seed);
      s.agents.push(agent('hare#0', 70, -40, {})); // a bystander nearby
      const h = hunt(s, 'chase');
      s.run(3);
      const fox = s.agent('fox#0'), rabbit = s.agent('rabbit#0');
      rabbit.pos = { x: fox.pos.x + 3 * fox.bodyLength - 0.1, y: fox.pos.y, z: fox.pos.z };
      s.camera = { pos: { x: fox.pos.x - 10, y: fox.pos.y + 4, z: fox.pos.z }, yaw: -Math.PI / 2, pitch: -0.2 };
      const shot = s.step()!;
      expect(shot.kind).toBe('cutaway');
      expect(shot.subject).not.toBe('rabbit#0');
      expect(shot.subject).not.toBe('fox#0');
      expect(shot.move).toBeDefined();
      expect(shot.s).toBeGreaterThanOrEqual(6);
      expect(shot.s).toBeLessThanOrEqual(10);
      for (const f of [0, 0.5, 1]) {
        const p = movePose(shot.move!, shot.move!.s * f, valley);
        expect(offAxis(p, rabbit.pos)).toBeGreaterThan(60 * DEG);
        expect(offAxis(p, fox.pos)).toBeGreaterThan(60 * DEG);
      }
      // the catch comes during the cut-away: no shot of the prey, and the scene moves on once it has played
      h.hunt!.beat = 'catch';
      h.tag = 'catch';
      const n = s.shots.length;
      while (s.planner.scene === h) s.step();
      for (const x of s.shots.slice(n)) expect(x.shot.subject).not.toBe('rabbit#0');
      expectSanePoses(s.shots.map((x) => x.shot));
    }
  });

  it('a cut-away always cuts (or dips), never eases, even from close by', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = new Scene(seed);
      s.agents.push(agent('hare#0', 45, -20, {})); // a bystander 15 m from the fox
      hunt(s, 'chase');
      s.run(3);
      const fox = s.agent('fox#0'), rabbit = s.agent('rabbit#0');
      rabbit.pos = { x: fox.pos.x + 1, y: fox.pos.y, z: fox.pos.z };
      // the camera stands between the fox and the hare, looking along the line towards the hare
      s.camera = { pos: { x: 38, y: fox.pos.y + 3, z: -20 }, yaw: -Math.PI / 2, pitch: -0.1 };
      const shot = s.step()!;
      expect(shot.kind).toBe('cutaway');
      // from here the look away (at the sky past the hare, or the hare itself) turns little: it must still be a cut
      expect(shot.join).not.toBe('ease');
    }
  });

  it("a catch's cut-away holds at least 6 s from the catch, whatever cut-away was already running", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = new Scene(seed);
      const h = hunt(s, 'chase');
      s.run(3);
      const fox = s.agent('fox#0');
      s.agent('rabbit#0').pos = { x: fox.pos.x + 1, y: fox.pos.y, z: fox.pos.z };
      const cut = s.step()!;
      expect(cut.kind).toBe('cutaway');
      const ends = s.now + cut.s;
      while (s.now < ends - 1) s.step(); // the catch comes in the cut-away's last second
      h.hunt!.beat = 'catch';
      h.tag = 'catch';
      const n = s.shots.length;
      s.step();
      const caught = s.now;
      while (s.planner.scene === h && s.now - caught < 30) s.step();
      expect(s.now - caught).toBeGreaterThanOrEqual(6);
      expect(s.now - caught).toBeLessThanOrEqual(10.5);
      for (const x of s.shots.slice(n)) if (x.shot.story === h.id) expect(x.shot.kind).toBe('cutaway');
    }
  });

  it('on catch the next shot is a cutaway of 6–10 s', () => {
    const s = new Scene(6);
    const h = hunt(s, 'chase');
    s.run(5);
    h.hunt!.beat = 'catch';
    h.tag = 'catch';
    const shot = s.step()!;
    expect(shot.kind).toBe('cutaway');
    expect(shot.s).toBeGreaterThanOrEqual(6);
    expect(shot.s).toBeLessThanOrEqual(10);
    expect(shot.subject).not.toBe('rabbit#0');
  });

  it('on escape a tracking shot on the prey', () => {
    const s = new Scene(7);
    const h = hunt(s, 'chase');
    s.run(5);
    h.hunt!.beat = 'escape';
    h.tag = 'escape';
    expect(s.step()).toMatchObject({ kind: 'tracking', subject: 'rabbit#0', view: 'follow' });
  });

  it('on escape, another hunter closing in on the prey cuts away from the prey, never to either animal', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = new Scene(seed);
      s.agents.push(agent('hare#0', 90, -40, {})); // a bystander nearby
      const h = hunt(s, 'chase');
      s.run(5);
      h.hunt!.beat = 'escape';
      h.tag = 'escape';
      s.agent('fox#0').pos = { x: -200, y: ground(-200, 0), z: 0 }; // the first hunter gave up, far behind
      expect(s.step()).toMatchObject({ kind: 'tracking', subject: 'rabbit#0' });
      s.step();
      const rabbit = s.agent('rabbit#0');
      s.agents.push(agent('wolf#0', rabbit.pos.x + 2, rabbit.pos.z, { hunter: true, doing: 'chase', focus: 'rabbit#0', bodyLength: 1.2 }));
      const shot = s.step()!;
      expect(shot.kind).toBe('cutaway');
      expect(shot.subject).not.toBe('rabbit#0');
      expect(shot.subject).not.toBe('wolf#0');
      // the cut-away plays out, then the scene ends while the wolf is still near: no shot of the prey again
      const n = s.shots.length;
      for (let i = 0; i < 40 && s.planner.scene === h; i++) s.step();
      for (const x of s.shots.slice(n)) if (x.shot.story === h.id) expect(x.shot.subject).not.toBe('rabbit#0');
      expect(s.planner.scene).not.toBe(h);
    }
  });

  it('the prey going mid-chase (caught and sinking) cuts away', () => {
    const s = new Scene(8);
    hunt(s, 'chase');
    s.run(5);
    s.agents = s.agents.filter((a) => a.id !== 'rabbit#0');
    expect(s.step()?.kind).toBe('cutaway');
  });
});

describe('Planner: interrupting', () => {
  it('a high story interrupts a calm scene, with a meanwhile line cue', () => {
    const s = new Scene(9);
    herd(s);
    s.run(10);
    expect(s.planner.scene?.id).toBe('herd:g1');
    const h = hunt(s, 'creep', 300, -200);
    const shot = s.step();
    expect(shot?.story).toBe(h.id);
    expect(s.planner.scene).toBe(h);
    const at = s.now;
    s.run(4);
    const cues = s.lines.filter((l) => l.at >= at);
    expect(cues.map((l) => l.cue.beat)).toContain('meanwhile');
    expect(cues.map((l) => l.cue.beat)).not.toContain('opener');
  });

  it('but never a hunt, except an arrival', () => {
    const s = new Scene(10);
    const h = hunt(s, 'chase');
    s.run(5);
    hunt2(s);
    s.run(5);
    expect(s.planner.scene).toBe(h);
    s.agents.push(agent('bramble#0', -100, 50, { native: false, released: true }));
    const arrive = story({ id: 'arrive:bramble#0', kind: 'event', tag: 'arrive', subject: 'bramble#0', actors: ['bramble#0'], species: ['bramble'],
      at: { x: -100, z: 50 }, interest: HIGH, released: true });
    s.stories.push(arrive);
    s.step();
    expect(s.planner.scene).toBe(arrive);
  });

  function hunt2(s: Scene) {
    s.agents.push(agent('wolf#0', -200, 100, { doing: 'chase', focus: 'deer#9', hunter: true, size: 1.5, bodyLength: 1.3 }));
    s.agents.push(agent('deer#9', -180, 100));
    s.stories.push(story({ id: 'hunt:wolf#0', kind: 'event', tag: 'chase', subject: 'wolf#0', actors: ['wolf#0', 'deer#9'], species: ['wolf', 'deer'],
      at: { x: -200, z: 100 }, interest: HIGH, hunt: { hunter: 'wolf#0', prey: 'deer#9', beat: 'chase' } }));
  }
});

describe('Planner: the subject going', () => {
  it('the subject going mid-shot ends the scene cleanly: the next shot within one update, no NaN in any pose', () => {
    for (const kind of ['establishing', 'tracking', 'close', 'group'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const s = new Scene(seed);
        const h = herd(s, 20, 10, 3);
        s.step();
        while (s.planner.scene === h && s.shots.at(-1)!.shot.kind !== kind && s.now < 80) s.step();
        if (s.shots.at(-1)!.shot.kind !== kind) continue;
        // the whole herd goes (sent exploring, taken back)
        s.agents = [];
        s.stories = [];
        const next = s.step();
        expect(next).not.toBeNull();
        expect(s.planner.scene).not.toBe(h);
        expectSanePoses(s.shots.map((x) => x.shot));
      }
    }
  });
});

describe('Planner: nothing to film', () => {
  it('an empty story list gives vista scenes from the viewpoints; every shot s ≥ 4; at most one scene per 20 s over 10 minutes', () => {
    for (const lapses of [false, true]) {
      const s = new Scene(11);
      s.timelapses = lapses;
      s.run(600, 0.25);
      expect(s.shots.length).toBeGreaterThan(5);
      const scenes = s.scenes.filter((x) => x.scene);
      expect(scenes.length).toBeLessThanOrEqual(600 / 20 + 1);
      for (let i = 1; i < scenes.length; i++) expect(scenes[i].at - scenes[i - 1].at).toBeGreaterThanOrEqual(20);
      for (const { shot } of s.shots) {
        expect(shot.s).toBeGreaterThanOrEqual(4);
        expect(shot.move).toBeDefined();
      }
      for (const { scene } of scenes) expect(scene!.tag).toBe('vista');
      expect(new Set(scenes.map((x) => x.scene!.id)).size).toBeGreaterThan(1);
      expectSanePoses(s.shots.map((x) => x.shot));
    }
  });

  it('even with no viewpoints and no animals, it films something calm and never loops fast', () => {
    const s = new Scene(12, []);
    s.run(300, 0.25);
    expect(s.shots.length).toBeGreaterThan(0);
    for (const { shot } of s.shots) expect(shot.s).toBeGreaterThanOrEqual(4);
    const scenes = s.scenes.filter((x) => x.scene);
    for (let i = 1; i < scenes.length; i++) expect(scenes[i].at - scenes[i - 1].at).toBeGreaterThanOrEqual(20);
    expectSanePoses(s.shots.map((x) => x.shot));
  });
});

describe('Planner: line cues', () => {
  it(`one opener ~${OPENER_AT_S} s into a scene`, () => {
    const s = new Scene(13);
    s.run(400);
    const scenes = s.scenes.filter((x) => x.scene);
    expect(scenes.length).toBeGreaterThan(3);
    for (let i = 0; i < scenes.length - 1; i++) {
      const { at } = scenes[i], end = scenes[i + 1].at;
      const openers = s.lines.filter((l) => l.at >= at && l.at < end && l.cue.beat === 'opener');
      expect(openers).toHaveLength(1);
      expect(openers[0].at - at).toBeGreaterThanOrEqual(OPENER_AT_S - 0.01);
      expect(openers[0].at - at).toBeLessThanOrEqual(OPENER_AT_S + 0.5);
      expect(openers[0].cue.story).toBe(scenes[i].scene);
    }
  });

  it('a peak cue for hunts (creep, chase, catch or escape)', () => {
    const s = new Scene(14);
    const h = hunt(s);
    s.run(20);
    h.hunt!.beat = 'chase';
    s.run(5);
    h.hunt!.beat = 'catch';
    s.run(15);
    const beats = s.lines.map((l) => l.cue.beat);
    expect(beats).toContain('creep');
    expect(beats).toContain('chase');
    expect(beats).toContain('catch');
    for (const b of ['creep', 'chase', 'catch']) expect(beats.filter((x) => x === b)).toHaveLength(1);
    for (const l of s.lines) if (l.cue.beat !== 'opener') expect(l.cue.story).toBe(h);
  });
});

describe('Planner: time-lapses', () => {
  it('a day time-lapse after a quiet spell: the clock at Fastest, 20–40 s, a barely drifting move pitched up to the sky', () => {
    const s = new Scene(15);
    s.timelapses = true;
    s.run(260);
    const lapse = s.shots.find((x) => x.shot.kind === 'timelapse');
    expect(lapse).toBeDefined();
    const sh = lapse!.shot;
    expect(sh.clock).toBe('fastest');
    expect(sh.s).toBeGreaterThanOrEqual(20);
    expect(sh.s).toBeLessThanOrEqual(40);
    const a = movePose(sh.move!, 0, valley), b = movePose(sh.move!, sh.move!.s, valley);
    expect(a.pitch).toBeGreaterThan(5 * DEG);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeLessThan(5);
    expect(Math.abs(a.yaw - b.yaw)).toBeLessThan(10 * DEG);
    expect(s.lines.some((l) => l.cue.beat === 'lapse-day')).toBe(true);
    // no other shot plays at Fastest, and at most one day time-lapse in ten minutes
    for (const { shot } of s.shots) if (shot.kind !== 'timelapse') expect(shot.clock).not.toBe('fastest');
    s.run(300);
    expect(s.shots.filter((x) => x.shot.kind === 'timelapse')).toHaveLength(1);
  });

  it('a night time-lapse lasts until the sky lightens, then a dawn scene', () => {
    const s = new Scene(16);
    s.timelapses = true;
    s.night = true;
    s.sunElevation = -30;
    const lapse = () => s.shots.find((x) => x.shot.kind === 'timelapse');
    while (!lapse() && s.now < 400) s.step();
    expect(lapse()).toBeDefined();
    expect(lapse()!.at).toBeGreaterThanOrEqual(180);
    expect(lapse()!.shot.clock).toBe('fastest');
    const n = s.shots.length;
    // the sun climbs back towards the horizon: the lapse holds until it is within 6° below it
    for (let el = -30; el < -6.5; el += 0.25) {
      s.sunElevation = el;
      s.step();
    }
    expect(s.shots.length).toBe(n);
    expect(s.lines.some((l) => l.cue.beat === 'nightfall')).toBe(true);
    // the sky lightening ends it, though the valley still calls it night
    s.sunElevation = -5.9;
    const next = s.step();
    expect(next).not.toBeNull();
    expect(next!.kind).not.toBe('timelapse');
    expect(next!.clock).not.toBe('fastest');
    s.run(3);
    expect(s.lines.some((l) => l.cue.beat === 'dawn')).toBe(true);
  });

  it('no night time-lapse once the sky is lightening, though it is still night', () => {
    const s = new Scene(18);
    s.timelapses = true;
    s.night = true;
    s.sunElevation = -5;
    for (let t = 0; t < 600; t += 0.5) {
      s.sunElevation = Math.min(-0.5, -5 + t / 200); // rising slowly, still below the horizon
      s.step();
    }
    expect(s.shots.some((x) => x.shot.kind === 'timelapse')).toBe(false);
    expect(s.lines.some((l) => l.cue.beat === 'nightfall')).toBe(false);
  });

  it('a night time-lapse lasts at least 10 s, even if the sky lightens at once', () => {
    const s = new Scene(19);
    s.timelapses = true;
    s.night = true;
    s.sunElevation = -30;
    while (!s.shots.some((x) => x.shot.kind === 'timelapse') && s.now < 400) s.step();
    const start = s.now, n = s.shots.length;
    s.sunElevation = -3;
    s.night = false;
    while (s.shots.length === n && s.now - start < 60) s.step();
    expect(s.now - start).toBeGreaterThanOrEqual(10);
  });

  it('no time-lapse when they are off', () => {
    const s = new Scene(17);
    s.run(600);
    expect(s.shots.some((x) => x.shot.kind === 'timelapse')).toBe(false);
  });
});

describe('Planner: for the documentary', () => {
  it('names the opening line to come as the scene begins, until it is cued', () => {
    const s = new Scene(21);
    s.step();
    expect(s.planner.opening).toBe('opener');
    s.run(OPENER_AT_S + 0.5);
    expect(s.lines.map((l) => l.cue.beat)).toContain('opener');
    expect(s.planner.opening).toBeNull();
  });
  it('timelapse() plays one at the next update (time-lapses on), by day and by night', () => {
    const d = new Scene(22);
    d.timelapses = true;
    d.run(5);
    d.planner.timelapse();
    expect(d.step()?.clock).toBe('fastest');
    const n = new Scene(23);
    n.timelapses = true;
    n.night = true;
    n.sunElevation = -20;
    n.run(5);
    n.planner.timelapse();
    expect(n.step()?.clock).toBe('fastest');
    n.run(5);
    expect(n.lines.map((l) => l.cue.beat)).toContain('nightfall');
  });
});

describe('Planner: framing by size', () => {
  it('a flier in the air is established riding along behind it, not from a still vantage it would leave in a moment', () => {
    const s = new Scene(2);
    s.agents.push(agent('hawk#0', 10, 10, { flying: true, altitude: 30, size: 0.55, doing: 'walk' }));
    s.stories.push(story({ id: 'soaring:hawk#0', tag: 'soaring', subject: 'hawk#0', actors: ['hawk#0'], species: ['hawk'] }));
    const first = s.step()!;
    expect(first).toMatchObject({ kind: 'tracking', subject: 'hawk#0', view: 'follow' });
    expect(first.move).toBeUndefined();
  });

  it('a group shot frames the lead\'s whole group, its own herd mates as well as the story\'s actors', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = new Scene(seed);
      herd(s, 20, 10, 2);
      // a herd mate 24 m off, not among the story's actors
      s.agents.push(agent('deer#9', 44, 10, { doing: 'graze', group: 'g1', grazer: true, plural: true, size: 1.6, bodyLength: 1.4 }));
      s.run(30);
      const g = s.shots.find((x) => x.shot.kind === 'group')?.shot;
      if (!g?.move) continue;
      const p = movePose(g.move, 0, valley), c = { x: (20 + 22 + 44) / 3, z: (10 + 11 + 10) / 3 };
      expect(Math.hypot(p.pos.x - c.x, p.pos.z - c.z)).toBeGreaterThan(30); // far enough for a 24 m spread, not a 2 m one
      return;
    }
    throw new Error('no group shot in 12 seeds');
  });
});
