import { describe, expect, it } from 'vitest';
import { CHIME_NOTES, EASE, createSoundscape, ease, silentSoundscape, toMuted, toVolume } from '../../src/audio/soundscape';

describe('ease', () => {
  it('moves towards the target with a 0.8 s time constant', () => {
    expect(ease(0, 1, 0)).toBe(0);
    expect(ease(0, 1, EASE)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(ease(1, 0, 100)).toBeCloseTo(0, 10);
    // two half steps land where one whole step does
    expect(ease(ease(0.2, 0.9, 0.05), 0.9, 0.05)).toBeCloseTo(ease(0.2, 0.9, 0.1), 12);
  });
});

describe('the arrival chime', () => {
  it('is three rising notes (arrival v2: a short rising chime)', () => {
    expect(CHIME_NOTES).toHaveLength(3);
    expect(CHIME_NOTES[0]).toBeLessThan(CHIME_NOTES[1]);
    expect(CHIME_NOTES[1]).toBeLessThan(CHIME_NOTES[2]);
  });
});

describe('remembered volume and mute', () => {
  it('keeps a good volume, clamps it, and falls back to 0.8 for anything else', () => {
    expect(toVolume(0.3)).toBe(0.3);
    expect(toVolume(0)).toBe(0);
    expect(toVolume(7)).toBe(1);
    expect(toVolume(-2)).toBe(0);
    for (const bad of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}, [0.5], true]) expect(toVolume(bad), String(bad)).toBe(0.8);
  });

  it('mutes only for a stored true', () => {
    expect(toMuted(true)).toBe(true);
    for (const v of [false, 'true', 1, null, undefined, {}]) expect(toMuted(v), String(v)).toBe(false);
  });

  it('has a silent stand-in with the same interface', async () => {
    const s = silentSoundscape();
    await s.ready;
    s.update({} as never, 0.1);
    s.chime(); // silence
    expect(Object.values(s.gains()).every((g) => g === 0)).toBe(true);
    expect(s.sources().owl).toBe('off');
  });
});

describe('ducking the layers for the narrator', () => {
  type Fake = { kind: string; to: Fake[]; calls: [string, number[]][]; [k: string]: unknown };
  /** A bare-bones audio context that remembers how its nodes were wired and what the gains were told. */
  const fakeContext = () => {
    const param = (n: Fake, name: string) => ({ value: 0, setTargetAtTime: (...a: number[]) => n.calls.push([name, a]), setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const nodes: Fake[] = [];
    const node = (kind: string): Fake => {
      const n: Fake = { kind, to: [], calls: [] };
      n.gain = param(n, 'gain');
      n.frequency = param(n, 'frequency');
      n.Q = param(n, 'Q');
      n.connect = (t: Fake) => (n.to.push(t), t);
      n.start = n.stop = () => {};
      n.getChannelData = () => new Float32Array(1e6);
      n.duration = 1;
      nodes.push(n);
      return n;
    };
    const destination = node('destination');
    const ctx = { currentTime: 2, sampleRate: 100, destination, createGain: () => node('gain'), createBuffer: () => node('buffer'), createBufferSource: () => node('source'), createBiquadFilter: () => node('filter'), createOscillator: () => node('osc'), decodeAudioData: async () => node('buffer') };
    return { ctx: ctx as unknown as BaseAudioContext, nodes, destination };
  };

  it('puts one gain between the layers and the master and ramps it -6 dB (and back) without touching the master', () => {
    const { ctx, nodes, destination } = fakeContext();
    const s = createSoundscape(ctx, { synth: true });
    const master = nodes.find((n) => n.to.includes(destination))!;
    const ducker = nodes.find((n) => n !== master && n.to.includes(master))!;
    const layers = nodes.filter((n) => n.to.includes(ducker));
    expect(layers).toHaveLength(6);
    expect(layers.some((n) => n.to.includes(master))).toBe(false);
    s.duck(true);
    const [name, [target, at, tau]] = ducker.calls.at(-1)!;
    expect([name, at]).toEqual(['gain', 2]);
    expect(20 * Math.log10(target)).toBeCloseTo(-6, 1);
    expect(1 - Math.exp(-0.4 / tau)).toBeGreaterThan(0.95); // there within 0.4 s
    s.duck(false);
    expect(ducker.calls.at(-1)![1][0]).toBe(1);
    expect(master.calls.filter(([n]) => n === 'gain')).toHaveLength(0);
    silentSoundscape().duck(true);
  });
});
