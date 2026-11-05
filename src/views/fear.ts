/**
 * Fear, prey's sense: the screen's edges darken and pulse gently with the animal's heartbeat, which quickens as its fear
 * rises (50 to 140 beats a minute), and a soft synthesized heartbeat plays under the soundscape. The beat's numbers are
 * pure (tested); `Heartbeat` is its sound. Calm, it is a slow, faint pulse on a still screen; never a flash.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The heart's rate (beats a minute) at `fear` (0..1): 50 calm, 140 at its most afraid. */
export const bpm = (fear: number) => 50 + 90 * clamp(fear, 0, 1);

/** The edges are never darker than this (a share of the picture's light taken away): never fully dark. */
export const MAX_EDGE = 0.6;
/**
 * Between beats the edges stay this dark, calm and at its most afraid; each beat darkens them this much more at its
 * height (calm and afraid; in between, as far between as the fear is). At its most afraid the top of a beat is MAX_EDGE.
 */
const REST = { calm: 0.08, afraid: 0.35 }, SWING = { calm: 0.08, afraid: MAX_EDGE - 0.35 };
/**
 * One beat's shape (shares of a beat): the lub, a soft rise and fall centred at LUB.at, LUB.half either side; then the
 * quieter dub (DUB.size of the lub) centred at DUB.at. Wide enough that even at 140 a minute the edges never move by
 * more than a twentieth between two frames at 120 a second.
 */
export const LUB = { at: 0.2, half: 0.2 };
const DUB = { at: 0.45, half: 0.18, size: 0.6 };

/** A soft bump (a raised cosine) centred at `at`, `half` wide each side, 1 at its top and 0 outside. */
const bump = (x: number, at: number, half: number) => (Math.abs(x - at) < half ? 0.5 + 0.5 * Math.cos((Math.PI * (x - at)) / half) : 0);

/** How dark the edges are (0..MAX_EDGE) at `phase` (0..1) of a beat, at `fear`. */
function edgeAt(phase: number, fear: number): number {
  const f = clamp(fear, 0, 1), beat = Math.min(1, bump(phase, LUB.at, LUB.half) + DUB.size * bump(phase, DUB.at, DUB.half));
  return REST.calm + (REST.afraid - REST.calm) * f + (SWING.calm + (SWING.afraid - SWING.calm) * f) * beat;
}

/** How dark the edges are (0..MAX_EDGE) `t` seconds into a steady beat at `fear`: a smooth beat, never a step. */
export function pulse(t: number, fear: number): number {
  const beats = (t * bpm(fear)) / 60;
  return edgeAt(beats - Math.floor(beats), fear);
}

/** The pulse as the fear changes: it carries the beat's phase on, so a quickening heart never jumps. */
export class FearBeat {
  private phase = 0;

  /** `dt` seconds more of the beat at `fear`: how dark the edges are now. */
  step(dt: number, fear: number): number {
    this.phase = (this.phase + (dt * bpm(fear)) / 60) % 1;
    return edgeAt(this.phase, fear);
  }

  /** Start a fresh beat (switching Fear on): the first lub comes LUB.at of a beat in. */
  reset(): void {
    this.phase = 0;
  }

  /** How far through its beat it is now (0..1), for the heartbeat's sound to keep in step. */
  get at(): number {
    return this.phase;
  }
}

/** The thumps are scheduled this far ahead (s), so a slow frame never makes one late. */
const AHEAD = 0.25;
/** A thump's loudness at its top, calm and at 140 a minute (before the master volume): soft, under the soundscape. */
const LOUD = { calm: 0.22, afraid: 0.35 };
/** A thump falls from THUMP.from to THUMP.to Hz over THUMP.fall s, rising in THUMP.attack s and dying away with THUMP.decay. */
const THUMP = { from: 95, to: 48, fall: 0.1, attack: 0.012, decay: 0.05, ring: 0.4 };
/** Switched off, a thump that is sounding fades out with this time constant (s), and is stopped STOP_AFTER of them later; one not yet begun never plays. */
const HUSH = 0.01, STOP_AFTER = 6;

/**
 * The heartbeat's sound: a soft synthesized lub-dub (two low thumps) at the rate asked, through `out` (the soundscape's
 * master: the volume and mute hold for it too). Off, it makes nothing at all; on, a couple of short-lived oscillators a
 * beat. Switched off, nothing it has scheduled plays on: a thump sounding fades at once. Switching on (or catching up
 * after the page was hidden) its first lub lands where the edges' does, given `phase` (`FearBeat.at`).
 */
export class Heartbeat {
  /** When the next lub is due (the audio clock's s), or null while off. */
  private next: number | null = null;
  /** The thumps scheduled or sounding (each leaves once it has ended), and when each begins (the audio clock's s). */
  private live = new Set<{ o: OscillatorNode; env: GainNode; t: number }>();

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode) {}

  /** Once a frame: beating at `rate` beats a minute, `phase` (0..1) of the way through the edges' beat now, or silent (`on` false). */
  set(rate: number, on: boolean, phase = 0): void {
    if (!on) {
      if (this.next !== null) this.hush();
      return;
    }
    const now = this.ctx.currentTime, beat = 60 / clamp(rate, 30, 200);
    // switched on, or fell behind (the page was hidden): the next lub where the edges' next one is
    if (this.next === null || this.next < now) this.next = now + ((((LUB.at - phase) % 1) + 1) % 1) * beat;
    const f = clamp((rate - 50) / 90, 0, 1), loud = LOUD.calm + (LOUD.afraid - LOUD.calm) * f;
    for (; this.next < now + AHEAD; this.next += beat) {
      this.thump(this.next, loud);
      this.thump(this.next + (DUB.at - LUB.at) * beat, loud * DUB.size);
    }
  }

  /** One soft low thump at `t` (the audio clock's s), `loud` at its top. */
  private thump(t: number, loud: number): void {
    const { ctx } = this, o = ctx.createOscillator(), env = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(THUMP.from, t);
    o.frequency.exponentialRampToValueAtTime(THUMP.to, t + THUMP.fall);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(loud, t + THUMP.attack);
    env.gain.setTargetAtTime(0, t + THUMP.attack, THUMP.decay);
    o.connect(env).connect(this.out);
    o.start(t);
    o.stop(t + THUMP.ring);
    const v = { o, env, t };
    this.live.add(v);
    o.onended = () => this.live.delete(v);
  }

  /** Off: every thump not yet begun is stopped before it starts, and one sounding fades out at once. */
  private hush(): void {
    const now = this.ctx.currentTime;
    this.next = null;
    for (const { o, env, t } of this.live) {
      if (t > now) o.stop(now); // stopped before its start: it never plays
      else {
        const g = env.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, HUSH);
        o.stop(now + STOP_AFTER * HUSH);
      }
    }
    this.live.clear();
  }
}
