import { Vector3 } from 'three/webgpu';
import { surfaceAt } from '../camera/freefly';
import { viewpointPose } from '../camera/viewpoints';
import type { QualityChoice, Tier } from '../render/quality';
import { stored } from '../shared/settings';
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
  const fpsNow = () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0);
  Object.assign(window, {
    __valley: {
      ...w, tier, step, shot, screen, pace,
      resume: () => (loop.paused = false),
      /** Put the camera `h` m above the ground (or water) at (x, z), looking at the point `lh` m above (lx, lz). */
      at: (x: number, z: number, h: number, lx: number, lz: number, lh = 0) => {
        const p = viewpointPose({ name: 'dev', pos: { x, z, h }, look: { x: lx, z: lz, h: lh } }, w.valley);
        Object.assign(w.fly, { pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, vel: { x: 0, y: 0, z: 0 }, walk: false });
        w.fly.apply(camera);
      },
      time, tour, perf, frames,
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
  });
}
