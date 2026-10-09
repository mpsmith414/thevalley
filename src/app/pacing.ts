import { AutoPick, type Tier } from '../render/quality';
import { ResolutionScaler } from '../world/resolution';
import { tierLabel } from './menu';

/** Seconds of frames Auto lets pass after `startAuto` before it measures (the first frames after a press can hitch). */
export const AUTO_SETTLE = 1;

/** The part of the renderer pacing touches. */
export type PixelRatioTarget = { getPixelRatio(): number; setPixelRatio(ratio: number): void };

export type PacingOptions = {
  renderer: PixelRatioTarget;
  /** The dynamic resolution floor (the tier's `minScale`). */
  min: number;
  /** The tier running now, and whether Auto should measure this visit. */
  tier: Tier;
  measure: boolean;
  /** Resolves when the GPU has finished the work submitted so far (WebGPU), or null (WebGL 2). */
  done: (() => Promise<unknown>) | null;
  /** Keep Auto's pick for next time. */
  remember(pick: Tier): void;
  /** Show a label (Auto's note for next time). */
  label(text: string): void;
  now?: () => number;
};

/** The renderer's "GPU finished" signal (WebGPU), or null when there is none (WebGL 2). */
export function gpuDone(renderer: { backend: unknown }): (() => Promise<unknown>) | null {
  const device = (renderer.backend as { device?: GPUDevice }).device;
  return device ? () => device.queue.onSubmittedWorkDone() : null;
}

/**
 * Dynamic resolution and Auto quality, fed by the live loop's real frames only (the dev `step` resets it and stops feeding).
 * Auto waits for `startAuto` (called once the start screen has gone and the animals' shaders are built, so loading stalls
 * never count), lets `AUTO_SETTLE` s of frames pass, then measures for `AUTO_SECONDS` at full resolution (a lowered
 * resolution would flatter the frame rate). The scaler runs before that and after, and sits out the settle and measurement.
 * The scale only ever changes the pixel ratio, and `resize` only the CSS size, so the two never undo each other.
 *
 * What a frame cost: the shorter of its interval and its working time (from its start to the GPU finishing it; WebGPU only).
 * The interval alone is capped by the screen (on a 60 Hz screen it never drops below 16.7 ms, so the scaler could never see
 * a light frame and come back to full resolution, and Auto could not tell a fast computer from a capped screen); the working
 * time alone counts the GPU's queue of earlier frames when frames overlap (it read 21 ms at 85 fps).
 */
export function pacing(o: PacingOptions) {
  const now = o.now ?? (() => performance.now());
  const base = o.renderer.getPixelRatio();
  let scaler = new ResolutionScaler(o.min), applied = 1;
  let auto = o.measure ? new AutoPick() : null;
  let started = false, settle = 0; // Auto started, and the seconds it still lets pass before it measures
  let generation = 0; // a reset drops the frames still waiting on the GPU
  const recent: number[] = []; // the last second or two of frame costs (for the dev hook)
  const apply = () => {
    if (scaler.scale === applied) return;
    applied = scaler.scale;
    o.renderer.setPixelRatio(base * applied);
  };
  /** One frame's interval `dt` (s) and cost (ms): to Auto while it measures, then to the scaler. */
  const feed = (dt: number, costMs: number) => {
    if (auto && started) {
      if (settle > 1e-9) return void (settle -= dt);
      const pick = auto.push(dt, costMs / 1000);
      if (!pick) return;
      auto = null;
      // Auto keeps its pick for next time. It never reloads mid-play: this visit carries on (the scaler holds the frame
      // rate meanwhile) and the next one starts on the pick.
      o.remember(pick);
      if (pick !== o.tier) o.label(`Next time: ${tierLabel(pick)} quality`);
      return;
    }
    scaler.push(costMs);
    apply();
    recent.push(costMs);
    if (recent.length > 120) recent.shift();
  };
  let warned = false;
  /** Back to full resolution with a fresh history. */
  const reset = () => {
    generation++;
    scaler = new ResolutionScaler(o.min);
    apply();
  };
  return {
    base,
    get scale() {
      return applied;
    },
    /** One live frame, just after its render: `dt` its interval (s), `t0` when its work began (ms, `now`'s clock). */
    frame(dt: number, t0: number) {
      if (!(dt > 0)) return;
      // WebGL 2 has no GPU-done signal, so it feeds the raw interval: on a screen that caps the frame rate (16.7 ms at
      // 60 Hz) the frames never read as light, so once lowered the resolution only comes back on faster screens.
      if (!o.done) return feed(dt, dt * 1000);
      const g = generation;
      void o.done().then(() => g === generation && feed(dt, Math.min(dt * 1000, now() - t0)), (e) => {
        if (!warned) console.warn('pacing: the GPU-done signal failed; frames go unmeasured', e);
        warned = true;
      });
    },
    feed,
    reset,
    /** Start Auto's measurement (after `AUTO_SETTLE` s): back to full resolution while it runs. Once only. */
    startAuto() {
      if (!auto || started) return;
      started = true;
      settle = AUTO_SETTLE;
      reset();
    },
    /** Median cost (ms) of the last frames the scaler saw. */
    get workMs() {
      return recent.length ? [...recent].sort((a, b) => a - b)[recent.length >> 1] : NaN;
    },
    /** Has Auto still to pick (waiting to start, settling or measuring)? */
    get measuring() {
      return !!auto;
    },
  };
}
export type Pacing = ReturnType<typeof pacing>;
