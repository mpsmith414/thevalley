/**
 * The Valley's ambient sound: six looping layers (wind, birds, night, lake, river, forest) each through its own gain into a
 * master gain, eased towards `mixAt` for the camera. Each layer plays `assets/audio/<layer>.ogg`, or, when that file is missing
 * or will not decode, a synthesised stand-in. An owl calls now and then at night (`owl.ogg`, or a synthesised hoot).
 */
import { remember, stored } from '../shared/settings';
import { between, mulberry32 } from '../util/rng';
import { LAYERS, mixAt, type Layer, type Listener } from './mix';
import { brownNoise, crickets, pinkNoise, seamless, whiteNoise } from './synth';

/** Seconds: the gains' easing time constant, and how far ahead bird chirps are scheduled. */
export const EASE = 0.8;
const AHEAD = 0.25;
/** Each layer's loudness at full mix (the recordings are levelled to about -20 dBFS RMS), and the owl's at full night. */
const TRIM: Record<Layer, number> = { wind: 0.5, birds: 0.5, night: 0.35, lake: 0.8, river: 0.7, forest: 0.45 };
const OWL = 0.35;
/** Seconds between owl calls at night. */
const OWL_GAP = [25, 70] as const;
const VOLUME_KEY = 'valley.volume', MUTED_KEY = 'valley.muted';

/** Move `g` towards `target` over `dt` seconds with time constant `tau`. */
export const ease = (g: number, target: number, dt: number, tau = EASE) => target + (g - target) * Math.exp(-dt / tau);
/** A remembered volume, made safe: a finite number clamped to 0..1, anything else the default 0.8. */
export const toVolume = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8);
/** A remembered mute, made safe: only `true` mutes. */
export const toMuted = (v: unknown) => v === true;

/** `off`: neither the file nor the stand-in would play (the layer stays silent). */
export type Source = 'loading' | 'file' | 'synth' | 'off';
export type Soundscape = {
  /** Resolves once every layer is playing (from its file or synthesised). */
  readonly ready: Promise<void>;
  /** Mix for the listener and ease the gains (once a frame). */
  update(l: Listener, dt: number): void;
  /** The layers' current (eased) gains, 0..1, before the layer trims and the master volume. */
  gains(): Record<Layer, number>;
  /** What each layer (and the owl) plays. */
  sources(): Record<Layer | 'owl', Source>;
  readonly volume: number;
  readonly muted: boolean;
  /** Master volume 0..1 (remembered). */
  setVolume(v: number): void;
  /** Silence everything, or bring it back (remembered). */
  mute(on: boolean): void;
};

/** `synth: true` skips the files (every layer synthesised). */
export function createSoundscape(ctx: BaseAudioContext, opts: { base?: string; seed?: number; synth?: boolean } = {}): Soundscape {
  const base = opts.base ?? `${import.meta.env.BASE_URL}assets/audio/`;
  const rng = mulberry32(opts.seed ?? 0x5017d);
  let volume = toVolume(stored<unknown>(VOLUME_KEY, 0.8)), muted = toMuted(stored<unknown>(MUTED_KEY, false));
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);
  const setMaster = () => master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);

  const out = {} as Record<Layer, GainNode>, gain = {} as Record<Layer, number>, source = {} as Record<Layer | 'owl', Source>;
  for (const k of LAYERS) {
    out[k] = ctx.createGain();
    out[k].gain.value = 0;
    out[k].connect(master);
    gain[k] = 0;
    source[k] = 'loading';
  }
  source.owl = 'loading';

  // ---------- building blocks ----------
  const rate = ctx.sampleRate;
  const buffer = (x: Float32Array) => {
    const b = ctx.createBuffer(1, x.length, rate);
    b.getChannelData(0).set(x);
    return b;
  };
  /** A seamless `seconds`-long loop of `gen`'s noise. */
  const noise = (gen: typeof whiteNoise, seconds: number) => buffer(seamless(gen(Math.round((seconds + 0.5) * rate), rng), Math.round(seconds * rate)));
  const loop = (b: AudioBuffer, to: AudioNode) => {
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(to);
    s.start(0, rng() * b.duration);
    return s;
  };
  const filter = (type: BiquadFilterType, frequency: number, Q = 0.707) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  };
  const amp = (g: number) => {
    const a = ctx.createGain();
    a.gain.value = g;
    return a;
  };
  /** A slow sine wobble of `depth` around a param's value. */
  const lfo = (hz: number, depth: number, param: AudioParam) => {
    const o = ctx.createOscillator(), d = amp(depth);
    o.frequency.value = hz;
    o.connect(d).connect(param);
    o.start();
    return o;
  };
  /** Chain nodes left to right; returns the first. */
  const chain = (...nodes: AudioNode[]) => {
    nodes.reduce((a, b) => a.connect(b));
    return nodes[0];
  };

  // ---------- the synthesised stand-ins (each levelled to about its recording's loudness) ----------
  let windFilter: BiquadFilterNode | null = null, forestAmp: GainNode | null = null;
  let birdsSynth = false;
  const synth: Record<Layer, () => void> = {
    // pink noise through a lowpass that opens (400–900 Hz) with the gusts, wandering a little on its own
    wind() {
      windFilter = filter('lowpass', 600, 0.6);
      lfo(0.07, 90, windFilter.frequency);
      loop(noise(pinkNoise, 7), chain(windFilter, amp(0.6), out.wind));
    },
    // brown noise through a 300 Hz bandpass, swelling slowly like small waves, with a little wash on top
    lake() {
      const swell = amp(0.55);
      lfo(0.12, 0.3, swell.gain);
      lfo(0.29, 0.15, swell.gain);
      swell.connect(out.lake);
      loop(noise(brownNoise, 9), chain(filter('bandpass', 300, 0.7), amp(0.75), swell));
      loop(noise(whiteNoise, 5), chain(filter('bandpass', 900, 1.2), amp(0.065), swell));
    },
    // white noise through a 1.2 kHz bandpass, with a lower body and a quick burble
    river() {
      const burble = amp(1);
      lfo(1.3, 0.12, burble.gain);
      burble.connect(out.river);
      loop(noise(whiteNoise, 6), chain(filter('bandpass', 1200, 0.8), amp(0.33), burble));
      loop(noise(whiteNoise, 5), chain(filter('bandpass', 450, 1), amp(0.18), burble));
    },
    // ~4.5 kHz sine bursts at 15 Hz in groups, a few crickets together
    night() {
      loop(buffer(crickets(Math.round(7.3 * rate), rate, rng)), chain(amp(1.5), out.night));
    },
    // short FM chirps at random intervals (scheduled in `update`)
    birds() {
      birdsSynth = true;
    },
    // noise through a 2 kHz highpass, gentle, rustling slowly
    forest() {
      forestAmp = amp(0.5);
      lfo(0.23, 0.15, forestAmp.gain);
      lfo(0.61, 0.08, forestAmp.gain);
      loop(noise(pinkNoise, 6), chain(filter('highpass', 2000, 0.5), filter('lowpass', 7000, 0.5), amp(2), forestAmp, out.forest));
    },
  };

  /** One bird's phrase at `t0`: 1–5 FM-wobbled notes, either high quick trills or lower slurred whistles. */
  const chirp = (t0: number) => {
    const trill = rng() < 0.6, notes = trill ? 2 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 3);
    const f = trill ? between(rng, 3200, 5200) : between(rng, 1800, 3000), loud = between(rng, 0.6, 1.2);
    let t = t0;
    for (let n = 0; n < notes; n++) {
      const dur = trill ? between(rng, 0.04, 0.09) : between(rng, 0.12, 0.25);
      const f0 = f * between(rng, 0.9, 1.1), f1 = f0 * (trill ? between(rng, 0.75, 1.3) : between(rng, 0.8, 1.5));
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), depth = amp(f0 * between(rng, 0.03, 0.12)), env = ctx.createGain();
      car.frequency.setValueAtTime(f0, t);
      car.frequency.exponentialRampToValueAtTime(f1, t + dur);
      mod.frequency.value = between(rng, 20, 60);
      mod.connect(depth).connect(car.frequency);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(loud, t + Math.min(0.015, dur / 3));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      car.connect(env).connect(out.birds);
      car.start(t);
      mod.start(t);
      car.stop(t + dur + 0.02);
      mod.stop(t + dur + 0.02);
      t += dur + (trill ? between(rng, 0.02, 0.06) : between(rng, 0.08, 0.2));
    }
  };

  // ---------- the owl ----------
  let owlBuffer: AudioBuffer | null = null;
  /** A synthesised tawny-owl call: "hoo … hoo-hoo-hoooo", a soft low sine with a little vibrato. */
  const hoot = (t0: number, to: AudioNode) => {
    const f = between(rng, 370, 420), lp = filter('lowpass', 900);
    lp.connect(to);
    for (const [at, dur, fall] of [[0, 0.45, 0.97], [1.1, 0.2, 0.98], [1.4, 0.2, 0.98], [1.7, 0.9, 0.9]] as const) {
      const o = ctx.createOscillator(), env = ctx.createGain(), t = t0 + at;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * fall, t + dur);
      lfo(5.5, 4, o.frequency).stop(t + dur + 0.1);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.6, t + 0.06);
      env.gain.setTargetAtTime(0, t + dur - 0.1, 0.06);
      o.connect(env).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  };
  const owl = (t: number, loud: number) => {
    const g = amp(loud);
    g.connect(master);
    if (owlBuffer) {
      const s = ctx.createBufferSource();
      s.buffer = owlBuffer;
      s.connect(g);
      s.start(t);
    } else hoot(t, g);
  };

  // ---------- the files, with the stand-ins as fallback ----------
  const load = async (name: string): Promise<AudioBuffer> => {
    const r = await fetch(`${base}${name}.ogg`);
    if (!r.ok) throw new Error(`${name}.ogg: ${r.status}`);
    return ctx.decodeAudioData(await r.arrayBuffer()); // a dev server's HTML fallback fails here too
  };
  /** Why a file was not used (quiet when the stand-ins were asked for). */
  const fellBack = (name: string, e: unknown) => {
    if (!opts.synth) console.warn(`sound: ${name}.ogg did not load (${e instanceof Error ? e.message : e}); synthesising it instead`);
  };
  const ready = Promise.all([
    ...LAYERS.map(async (k) => {
      try {
        if (opts.synth) throw new Error('synth only');
        loop(await load(k), out[k]);
        source[k] = 'file';
        return;
      } catch (e) {
        fellBack(k, e);
      }
      try {
        synth[k]();
        source[k] = 'synth';
      } catch (e) {
        source[k] = 'off';
        console.warn(`sound: the ${k} layer could not be synthesised either; it stays silent`, e);
      }
    }),
    (async () => {
      try {
        if (opts.synth) throw new Error('synth only');
        owlBuffer = await load('owl');
        source.owl = 'file';
      } catch (e) {
        fellBack('owl', e);
        source.owl = 'synth';
      }
    })(),
  ]).then(() => {}, (e) => console.warn('sound: a layer failed to start', e)); // never rejects

  let nextChirp = 0, nextOwl = between(rng, 5, OWL_GAP[1]);
  return {
    ready,
    update(l, dt) {
      const target = mixAt(l), now = ctx.currentTime;
      for (const k of LAYERS) {
        gain[k] = ease(gain[k], target[k], dt);
        out[k].gain.setTargetAtTime(gain[k] * TRIM[k], now, 0.05);
      }
      windFilter?.frequency.setTargetAtTime(400 + 500 * l.gust, now, 0.5);
      forestAmp?.gain.setTargetAtTime(0.35 + 0.3 * l.gust, now, 0.5);
      if (birdsSynth) {
        if (nextChirp < now) nextChirp = now + between(rng, 0.05, 0.6); // fell behind (the page was hidden): start afresh
        for (; nextChirp < now + AHEAD; nextChirp += between(rng, 0.35, 2.4)) if (gain.birds > 0.02) chirp(nextChirp);
      }
      if (now >= nextOwl) {
        if (gain.night > 0.5 && source.owl !== 'loading') owl(now + 0.05, OWL * gain.night);
        nextOwl = now + between(rng, OWL_GAP[0], OWL_GAP[1]);
      }
    },
    gains: () => ({ ...gain }),
    sources: () => ({ ...source }),
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    setVolume(v) {
      volume = toVolume(v);
      remember(VOLUME_KEY, volume);
      setMaster();
    },
    mute(on) {
      muted = on;
      remember(MUTED_KEY, muted);
      setMaster();
    },
  };
}

/** A soundscape that does nothing: what the valley uses when the browser cannot make sound at all. */
export function silentSoundscape(): Soundscape {
  const zero = () => Object.fromEntries(LAYERS.map((k) => [k, 0])) as Record<Layer, number>;
  let volume = toVolume(stored<unknown>(VOLUME_KEY, 0.8)), muted = toMuted(stored<unknown>(MUTED_KEY, false));
  return {
    ready: Promise.resolve(),
    update() {},
    gains: zero,
    sources: () => Object.fromEntries([...LAYERS, 'owl'].map((k) => [k, 'off'])) as Record<Layer | 'owl', Source>,
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    setVolume(v) {
      volume = toVolume(v);
      remember(VOLUME_KEY, volume);
    },
    mute(on) {
      muted = on;
      remember(MUTED_KEY, muted);
    },
  };
}
