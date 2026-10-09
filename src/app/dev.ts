import { Vector3 } from 'three/webgpu';
import { viewpointPose } from '../camera/viewpoints';
import type { QualityChoice, Tier } from '../render/quality';
import { stored } from '../shared/settings';
import type { World } from './main';
import type { Pacing } from './pacing';

/** The live loop's dev controls: `paused` freezes the world (`step`), `heavy` adds busy ms per frame, `onFrame` samples fps. */
export type Loop = { paused: boolean; heavy: number; onFrame: ((dt: number) => void) | null };
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
  const fpsNow = () => (fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length / 2)] : 0);
  const mark = (name: string) => Math.round(performance.getEntriesByName(name)[0]?.startTime ?? NaN);
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
      /** Milliseconds since navigation until the data arrived, the ground textures were in, and the first frame was ready. */
      get timings() {
        return { data: mark('valley-data'), ground: mark('valley-ground'), trees: mark('valley-trees'), scene: mark('valley-scene'), animals: mark('valley-animals'), ready: mark('valley-ready'), animalsShown: mark('valley-animals-shown') };
      },
    },
  });
}
