import { Vector3 } from 'three/webgpu';
import type { HostSend } from '../bring/protocol';
import { Workshop } from '../bring/workshop';
import { surfaceAt } from '../camera/freefly';
import { CAST } from '../cast';
import { DesignerResting, type DesignerApi } from '../designer/api';
import { designCreature, tweakCreature } from '../designer/loop';
import type { ImageIn, KidCards } from '../designer/types';
import type { Recipe } from '../recipe/schema';
import { viewpointPose } from '../camera/viewpoints';
import type { QualityChoice, Tier } from '../render/quality';
import { stored } from '../shared/settings';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Needs, type Pt } from '../sim/types';
import { VALLEY } from '../valley/layout';
import { PRESETS } from '../world/clock';
import type { World } from './main';
import { gpuDone, type Pacing } from './pacing';

/**
 * The live loop's dev controls: `paused` freezes the world (`step`), `heavy` adds busy ms per frame, `onFrame` samples fps,
 * `onDrawn` gets each live frame's animation-frame time and its working ms (tick, render submit and pacing) once drawn.
 */
export type Loop = {
  paused: boolean; heavy: number; onFrame: ((dt: number) => void) | null; onDrawn: ((now: number, workMs: number) => void) | null;
};
/** One live frame in `__valley.frames`' log: when (ms), the interval since the frame before, its working ms, the valley hour. */
type FrameRow = { at: number; interval: number; work: number; hour: number };
/** What the hooks need from the page. */
export type DevContext = { canvas: HTMLCanvasElement; ui: HTMLElement; tier: Tier; quality: { choice: QualityChoice; tier: Tier; measure: boolean } };

/** Dev only: `window.__valley`, the hooks the browser checks use (shots, stepping, the camera, the clock, sound, pacing). */
export function devHooks(w: World, pace: Pacing, loop: Loop, ctx: DevContext) {
  const { renderer, scene, camera, tick, clock, light } = w;
  const { canvas, ui, tier, quality } = ctx;
  const fps: number[] = [];
  loop.onFrame = (dt) => {
    if (dt > 0) fps.push(1 / dt);
    if (fps.length > 240) fps.shift();
  };
  // ---------- live frame log: real frames of the live loop, for finding stalls (pipeline compiles and the like) ----------
  let log: FrameRow[] | null = null, prev = 0;
  loop.onDrawn = (now, work) => {
    if (log && prev) log.push({ at: now, interval: now - prev, work, hour: clock.hour });
    prev = now;
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const stats = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b), at = (q: number) => r1(s[Math.floor(q * (s.length - 1))] ?? NaN);
    return { median: at(0.5), p99: at(0.99), max: r1(s[s.length - 1] ?? NaN) };
  };
  /** Summarise the log: frame intervals and working ms, and every frame slower than `slow` ms (with the hour it came at). */
  const summary = (rows: FrameRow[], slow: number) => ({
    frames: rows.length, seconds: r1(rows.length ? (rows[rows.length - 1].at - rows[0].at + rows[0].interval) / 1000 : 0),
    interval: stats(rows.map((r) => r.interval)), work: stats(rows.map((r) => r.work)),
    slow: rows.filter((r) => r.interval > slow || r.work > slow).map((r) => ({ hour: Math.round(r.hour * 1000) / 1000, interval: r1(r.interval), work: r1(r.work) })),
  });
  const frames = {
    /** Start a fresh log of live frames. */
    start: () => ((log = []), (prev = 0), 'recording'),
    /** Stop logging and summarise (frames with an interval or working time over `slow` ms are listed). */
    stop: (slow = 50) => {
      const rows = log ?? [];
      log = null;
      return summary(rows, slow);
    },
    /** The log so far, summarised, without stopping it. */
    peek: (slow = 50) => summary(log ?? [], slow),
    /**
     * Hidden window: animation frames stop, so drive the live loop from a timer instead (`on = false` puts the animation frames
     * back). Like a screen's frames, the next one waits for the GPU to finish the one before (so a GPU stall, such as a pipeline
     * compile, lengthens the interval), and comes no sooner than 16 ms after the last began. Every frame still runs the live
     * loop's own code; only what calls it changes.
     */
    pump: (on = true) => {
      type Cb = ((t: number) => void) | null;
      type Anim = { stop(): void; start(): void; setContext(c: unknown): void; getAnimationLoop(): Cb; setAnimationLoop(cb: Cb): void };
      const anim = (renderer as unknown as { _animation: Anim })._animation, cb = anim.getAnimationLoop(), done = gpuDone(renderer);
      anim.stop(); // cancels through the context that scheduled the next frame
      let current = 0, began = performance.now();
      const timers = {
        requestAnimationFrame: (f: (t: number) => void) => {
          const id = ++current;
          // called at the start of a frame: wait until the frame has been submitted, then for the GPU, then for the 16 ms
          setTimeout(() => void (done?.() ?? Promise.resolve()).then(() => {
            setTimeout(() => {
              if (id !== current) return;
              began = performance.now();
              f(began);
            }, Math.max(0, 16 - (performance.now() - began)));
          }), 0);
          return id;
        },
        cancelAnimationFrame: () => void current++,
      };
      anim.setContext(on ? timers : self);
      anim.setAnimationLoop(null); // `start` runs one frame at once with no time: not through the live loop
      anim.start();
      anim.setAnimationLoop(cb);
      return on ? 'timer' : 'animation frames';
    },
    /** Is the page visible (animation frames run)? */
    get visible() {
      return document.visibilityState;
    },
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
  /** The whole screen (3D view plus the UI on top) saved as .shots/<name>.png; `fonts` embeds the page's web font (slower). */
  const screen = async (name: string, fonts = false) => {
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
      uiCanvas = await toCanvas(ui, { width: cw, height: ch, pixelRatio: canvas.width / cw, skipFonts: !fonts });
    } finally {
      window.requestAnimationFrame = raf;
    }
    g.drawImage(uiCanvas, 0, 0, out.width, out.height);
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: out.toDataURL('image/png') });
    return name;
  };
  /** Freeze the live loop and step the world by hand (works while the window is hidden). */
  const step = (frames: number, dt = 1 / 60) => {
    if (!loop.paused) pace.reset(); // full resolution for the shots that follow
    loop.paused = true;
    for (let i = 0; i < frames; i++) tick(dt);
  };
  /** Jump the clock forward to `hour` o'clock and relight at once (a following `shot` shows it). */
  const time = (hour: number) => {
    clock.jumpTo(hour);
    light(Infinity);
    return clock.hour;
  };
  const views = VALLEY.viewpoints.length;
  /**
   * The contact sheet's shots: every viewpoint at dawn, noon, golden hour and night. Each goes to the viewpoint's end pose
   * (where its glide lands), steps 120 frames (the plants fade in, the animals move on) and saves .shots/<prefix>-v<n>-<time>.png.
   */
  const tour = async (prefix = 'tour') => {
    const names: string[] = [];
    for (let n = 1; n <= views; n++) {
      for (const [id, hour] of Object.entries(PRESETS)) {
        w.view(n);
        time(hour);
        step(120);
        names.push(await shot(`${prefix}-v${n}-${id}`));
      }
    }
    return names;
  };
  /**
   * Frame cost at every viewpoint at noon, at full resolution: 180 frames each, one at a time, each timed from its start to
   * the GPU finishing it (pacing's working time, with no overlap between frames, so a little pessimistic). Returns the
   * median ms, the draw calls and the triangles of a frame (shadow passes and the lake's mirror included).
   */
  const perf = async (frames = 180, hour: number = PRESETS.noon) => {
    const done = gpuDone(renderer);
    if (!done) return 'no GPU timing on WebGL 2';
    const rows: { view: string; ms: number; p90: number; drawCalls: number; triangles: number }[] = [];
    for (let n = 1; n <= views; n++) {
      const name = w.view(n);
      time(hour);
      step(120);
      await renderer.compileAsync(scene, camera);
      const ms: number[] = [];
      let drawCalls = 0, triangles = 0;
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        tick(1 / 60);
        renderer.info.reset(); // the live loop's animation resets it; stepping by hand must
        renderer.render(scene, camera);
        ({ drawCalls, triangles } = renderer.info.render);
        await done();
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      const at = (q: number) => Math.round(ms[Math.floor(q * (ms.length - 1))] * 10) / 10;
      rows.push({ view: `${n} ${name}`, ms: at(0.5), p90: at(0.9), drawCalls, triangles });
    }
    console.table(rows);
    return rows;
  };
  /** Put the camera `h` m above the ground (or water) at (x, z), looking at the point `lh` m above (lx, lz). */
  const at = (x: number, z: number, h: number, lx: number, lz: number, lh = 0) => {
    const p = viewpointPose({ name: 'dev', pos: { x, z, h }, look: { x: lx, z: lz, h: lh } }, w.valley);
    Object.assign(w.fly, { pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, vel: { x: 0, y: 0, z: 0 }, walk: false });
    w.fly.apply(camera);
  };
  const simDev = simHooks(w, at, time);
  const fpsNow = () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0);
  Object.assign(window, {
    __valley: {
      ...w, tier, step, shot, screen, pace,
      resume: () => (loop.paused = false),
      at,
      time, tour, perf, frames,
      sim: simDev,
      /** Stage a scene for a shot (as `sim.stage`). */
      stage: simDev.stage,
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
        p.y = Math.max(p.y, surfaceAt(w.valley, p.x, p.z) + 0.25);
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
      heavy: (ms: number) => (loop.heavy = ms),
      /** The quality setting and the tier running. */
      quality: {
        ...quality,
        /** Auto's remembered pick (read fresh: it is stored once Auto has measured). */
        get picked() {
          return stored<unknown>('valley.autoTier', null);
        },
      },
      /** Median frames per second over the last few seconds. */
      fps: fpsNow,
      /** Milliseconds since navigation to each startup mark (`valley-*`, in the order they came; see `start` in main.ts). */
      get timings() {
        const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('valley-')).sort((a, b) => a.startTime - b.startTime);
        return Object.fromEntries(marks.map((m) => [m.name.slice(7), Math.round(m.startTime)]));
      },
    },
    __bring: bringHooks(w, screen),
  });
}

// ---------- the simulation: its state and moments, needs, running ahead, and staged scenes ----------
/** The scenes `__valley.sim.stage` sets up. */
type Stage = 'fox-rabbits' | 'wolves-deer' | 'hawk' | 'dusk-ducks' | 'drink';
/** A staged hunter starts this far (m) from its prey's middle; the hawk this far off, up where it soars. */
const STAGE_GAP: Record<'fox' | 'wolf' | 'hawk', number> = { fox: 40, wolf: 60, hawk: 30 };

/**
 * Dev: `__valley.sim` reads the simulation's state and its last moments, sets an animal's needs, runs it ahead headless
 * (the view jumps), and stages a scene for shots: a hungry hunter near its prey, the ducks at dusk, the herd drinking.
 */
function simHooks(w: World, at: (x: number, z: number, h: number, lx: number, lz: number, lh?: number) => void, time: (hour: number) => number) {
  const sim = () => w.residents.sim;
  /** The animals of a species (not those going back to the earth). */
  const of = (species: string) => sim().agents.filter((a) => a.species === species && a.doing !== 'returning');
  const middle = (pts: Pt[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });
  /** Moves `a` to `p` (its smoothing too, so the view does not slide it there) to choose afresh. */
  const put = (a: Agent, p: Pt) => {
    const s = sim();
    s.ctx.become(a, 'watch');
    Object.assign(a.motion, { x: p.x, z: p.z, target: null, speed: 0 });
    Object.assign(s.prev(a.id)!, a.motion);
    s.ctx.done(a);
  };
  /** The camera off to one side of the line through `pts` (from `a` to `b`), far enough back to have them all in the picture. */
  const frame = (pts: Pt[]) => {
    const c = middle(pts), a = pts[0], b = pts[pts.length - 1];
    const spread = Math.max(8, ...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
    const d = Math.hypot(b.x - a.x, b.z - a.z), ux = d > 1e-6 ? -(b.z - a.z) / d : 1, uz = d > 1e-6 ? (b.x - a.x) / d : 0; // across the line
    const back = Math.max(25, spread * 1.6);
    at(c.x + ux * back, c.z + uz * back, back * 0.35, c.x, c.z, 1);
  };
  /** A hungry `hunter` (and its group) `STAGE_GAP` m from the middle of its `prey`, on dry ground, the camera framing both. */
  const hunt = (hunter: 'fox' | 'wolf' | 'hawk', prey: string) => {
    const s = sim(), quarry = of(prey), first = of(hunter)[0];
    if (!quarry.length || !first) return null;
    const c = middle(quarry.map((a) => a.motion)), pack = first.group ? of(hunter).filter((a) => a.group === first.group) : [first];
    const toward = Math.atan2(first.motion.z - c.z, first.motion.x - c.x), r = STAGE_GAP[hunter];
    let spot: Pt | null = null;
    for (let k = 0; k < 12 && !spot; k++) {
      const ang = toward + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6), x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      if (!w.valley.isWater(x, z) && w.valley.inside(x, z, 20)) spot = { x, z };
    }
    if (!spot) return null;
    pack.forEach((a, k) => {
      put(a, { x: spot!.x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3, z: spot!.z });
      s.setNeeds(a.id, { hunger: 1, tired: 0, thirst: 0 });
    });
    frame([spot, c]);
    return pack.map((a) => a.id);
  };
  const stages: Record<Stage, () => unknown> = {
    'fox-rabbits': () => hunt('fox', 'rabbit'),
    'wolves-deer': () => hunt('wolf', 'deer'),
    hawk: () => hunt('hawk', 'rabbit'),
    'dusk-ducks': () => {
      time(20.5);
      const ducks = of('duck');
      if (ducks.length) frame(ducks.map((a) => a.motion));
      return ducks.map((a) => a.id);
    },
    drink: () => {
      const deer = of('deer');
      for (const a of deer) {
        sim().setNeeds(a.id, { thirst: 1 });
        sim().ctx.done(a);
      }
      if (deer.length) frame(deer.map((a) => a.motion));
      return deer.map((a) => a.id);
    },
  };
  return {
    /** The simulation's whole state (a deep copy). */
    state: () => sim().state(),
    /** The last `n` moments, oldest first. */
    moments: (n = 20) => sim().moments.recent().slice(-n),
    /** Set some of animal `id`'s needs; returns them all. */
    needs: (id: string, partial: Partial<Needs>) => (sim().setNeeds(id, partial), sim().get(id)?.needs),
    /** Run the simulation `hours` valley hours ahead, headless (16 ticks a step), the clock with it; the view jumps there. */
    ahead: (hours: number) => {
      const s = sim(), step = 16 * TICK, n = Math.round((hours * ANIMAL_S_PER_HOUR) / step);
      for (let i = 0; i < n; i++) {
        w.clock.hours += step / ANIMAL_S_PER_HOUR;
        s.step(step, w.clock.hours);
      }
      w.light(Infinity);
      return w.clock.hour;
    },
    /** Stage a scene (`fox-rabbits`, `wolves-deer`, `hawk`, `dusk-ducks`, `drink`), the camera framing it; returns who is in it. */
    stage: (name: Stage) => stages[name]?.() ?? null,
  };
}

// ---------- the workshop without the designer: a stand-in turn, one call at a time ----------
type Scenario = 'ok' | 'fail' | 'declined';
/** A kid's creature made from the fox: purple, with a sunshine-yellow tail tip (what the stand-in drawing shows). */
function sparkleFox(): { recipe: Recipe; cards: KidCards } {
  const r = structuredClone(CAST.find((c) => c.recipe.id === 'fox')!.recipe);
  const colours: Record<string, [string, string | null]> = {
    body: ['#8a5cd6', '#efe4ff'], snout: ['#8a5cd6', '#f5edff'], ears: ['#4a2c86', null], socks: ['#3a2366', null], brush: ['#7d4fcc', '#c6a8f0'], tip: ['#ffd23a', null],
  };
  for (const g of r.skin.regions) if (colours[g.id]) [g.color, g.belly] = colours[g.id];
  r.skin.eyes.color = '#3aa05a';
  return {
    recipe: { ...r, id: 'sparkle-fox', name: 'Sparkle Fox', seed: 77 },
    cards: { name: 'Sparkle Fox', eats: 'strawberries 🍓', speed: 'zooms about 💨', mood: 'giggly 😄', special: 'a sunshine-yellow tail tip' },
  };
}
/** A crayon drawing of it, as a phone would send it (PNG on white). */
function doodle(): ImageIn {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 700;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.lineCap = g.lineJoin = 'round';
  const crayon = (colour: string, width: number, path: () => void, fill?: string) => {
    g.beginPath();
    path();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.stroke();
  };
  crayon('#4caf50', 10, () => {
    for (let x = 30; x < 880; x += 26) {
      g.moveTo(x, 640);
      g.lineTo(x + 10, 600 - (x % 3) * 8);
    }
  });
  crayon('#f2b705', 8, () => g.arc(790, 110, 56, 0, Math.PI * 2), '#ffe066');
  crayon('#5b2a9e', 9, () => g.ellipse(420, 400, 190, 105, -0.05, 0, Math.PI * 2), '#a57be8');
  for (const x of [300, 360, 480, 540]) {
    crayon('#3a2366', 14, () => {
      g.moveTo(x, 470);
      g.lineTo(x - 6, 610);
      g.lineTo(x + 26, 612);
    });
  }
  crayon('#5b2a9e', 9, () => {
    g.moveTo(240, 380);
    g.quadraticCurveTo(110, 300, 90, 170);
    g.quadraticCurveTo(170, 230, 250, 330);
  }, '#9a6be0');
  crayon('#d9a400', 9, () => {
    g.moveTo(90, 170);
    g.quadraticCurveTo(80, 120, 110, 95);
    g.quadraticCurveTo(125, 150, 128, 205);
  }, '#ffd23a');
  crayon('#5b2a9e', 9, () => g.ellipse(640, 270, 92, 80, 0, 0, Math.PI * 2), '#a57be8');
  for (const [a, b] of [[585, 205], [665, 195]]) {
    crayon('#3a2366', 8, () => {
      g.moveTo(a, b + 10);
      g.lineTo(a + 18, b - 80);
      g.lineTo(a + 52, b + 4);
    }, '#4a2c86');
  }
  crayon('#222', 6, () => g.arc(615, 255, 13, 0, Math.PI * 2), '#3aa05a');
  crayon('#222', 6, () => g.arc(675, 252, 13, 0, Math.PI * 2), '#3aa05a');
  crayon('#222', 7, () => g.arc(690, 300, 24, 0.3, 2.4));
  crayon('#222', 5, () => g.arc(728, 285, 10, 0, Math.PI * 2), '#222');
  return { base64: c.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), mediaType: 'image/png' };
}

/**
 * Dev: `__bring` drives the workshop on the valley's screen with a stand-in designer (no API is spent): `fake(scenario)`
 * starts a turn whose every designer call and build waits for `next()` (or `{ auto: ms }` each), `until(call)` waits for
 * one to be waiting, then `tweak`, `release`, `back`, `state()`, and `screen(name)` saves the whole screen with the stage.
 */
function bringHooks(w: World, screen: (name: string, fonts?: boolean) => Promise<string>) {
  const { recipe, cards } = sparkleFox();
  type Run = {
    ws: Workshop; sent: HostSend[]; waiting: { call: string; go: () => void } | null; auto: number | null; scenario: Scenario;
    /** How the release (or a Back) ended, once it has: `released`, `kept` or `failed`. */
    outcome: string | null;
  };
  let run: Run | null = null;
  const gate = (call: string) => new Promise<void>((go) => {
    const r = run;
    if (!r) return go();
    if (r.auto !== null) return void setTimeout(go, r.auto);
    r.waiting = { call, go: () => ((r.waiting = null), go()) };
  });
  const api: DesignerApi = {
    read: async () => {
      await gate('read');
      if (run?.scenario === 'fail') throw new DesignerResting('fake');
      if (run?.scenario === 'declined') return { status: 'declined', message: 'Let’s draw a friendly creature instead!' };
      return { status: 'ok', recipe, checklist: ['4 legs', 'a big tail'], view: { angle: 'side', facing: 'left' }, cards, fixes: [] };
    },
    lookAgain: async (q) => {
      await gate(`look ${q.pass}`);
      return q.pass === 1
        ? { status: 'ok', verdict: 'edits', edits: [{ op: 'set', path: 'parts.ear.length', valueJson: '0.13' }, { op: 'set', path: 'parts.ear.r0', valueJson: '0.05' }], note: 'The ears should be bigger…' }
        : { status: 'ok', verdict: 'matches', edits: [], note: 'That looks just right!' };
    },
    tweak: async (q) => {
      await gate('tweak');
      const fluffier = (id: string, len: number, fluff: number) => [
        { op: 'set' as const, path: `skin.regions.${id}.furLength`, valueJson: String(len) },
        { op: 'set' as const, path: `skin.regions.${id}.fluff`, valueJson: String(fluff) },
      ];
      return { status: 'ok', note: 'Now it’s extra fluffy!', cards: { ...q.cards, special: 'the fluffiest tail in the valley' }, edits: [...fluffier('body', 0.04, 0.8), ...fluffier('brush', 0.07, 1)] };
    },
  };
  return {
    /** Start a stand-in turn (Mia's purple fox drawing): `ok`, `fail` (the designer rests) or `declined`; `words` sends no drawing. */
    fake(scenario: Scenario = 'ok', opts: { auto?: number; words?: boolean } = {}) {
      const sent: HostSend[] = [];
      const ws = new Workshop({
        design: designCreature, tweak: tweakCreature, api, studio: w.shop.studio, ui: w.shop, now: () => performance.now(),
        build: async (r) => (await gate('build'), w.builder.build(r)),
        send: async (_t, m) => (sent.push(m), true),
      });
      run = { ws, sent, waiting: null, auto: opts.auto ?? null, scenario, outcome: null };
      void ws.turn('fake', { name: 'Mia', badge: '🦊' }, { image: opts.words ? null : doodle(), words: 'A purple fox with a sunshine tail' });
      return 'started';
    },
    /** Let the waiting call go; returns its name. */
    next() {
      const c = run?.waiting;
      c?.go();
      return c?.call ?? null;
    },
    /** Wait (up to `ms`) until `call` is waiting; `'preview'` waits for the reveal (or a tweak's answer), `'closed'` for the screen to clear. */
    async until(call: string, ms = 30000) {
      const end = performance.now() + ms;
      const there = () => (call === 'preview' ? !!run?.sent.some((m) => m.type === 'preview' || m.type === 'tweaked')
        : call === 'closed' ? !w.shop.showing : run?.waiting?.call === call);
      while (!there() && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
      return there();
    },
    tweak: (words = 'Fluffier!') => void run?.ws.tweak('fake', words),
    /** Release the made creature into the valley, as the phone's button does (the real release: saved, glide, arrival). */
    release() {
      const r = run, made = r?.ws.release('fake');
      if (made) void w.hooks.onRelease(made).then((o) => (r!.outcome = o));
      return made?.cards.name ?? null;
    },
    back: async () => (run ? ((await run.ws.cancel('fake'))?.cards.name ?? null) : null),
    state: () => ({
      showing: w.shop.showing, busy: run?.ws.busy ?? false, waiting: run?.waiting?.call ?? null,
      sent: run?.sent.map((m) => (m.type === 'step' ? `step ${m.step.kind}` : m.type)) ?? [], outcome: run?.outcome ?? null,
    }),
    /** The whole screen, the stage included, as .shots/<name>.png. */
    async screen(name: string) {
      w.shop.still(true);
      try {
        return await screen(name, true); // in Nunito: the TV's words wrap as they do on the page
      } finally {
        w.shop.still(false);
      }
    },
  };
}
