import { HalfFloatType, PerspectiveCamera, Scene, Vector3, type Camera, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import type { TreeFade } from '../../src/plants/fade';
import { CARD_TEXT, PEEK_CADENCE, createPeek, peekCadence, peekRect } from '../../src/render/peek';
import { peekUniforms } from '../../src/render/post';
import { TIERS } from '../../src/render/quality';

describe('peekRect', () => {
  it("sits in the bottom-left corner, 24 px in from the left, the card's line and hint under it and 24 px below them", () => {
    const r = peekRect({ w: 1920, h: 1080 });
    expect(r.x).toBe(24);
    expect(CARD_TEXT).toBe(0.25);
    expect(r.y + r.h).toBeCloseTo(1080 - 24 - 96);
  });
  it('is 20% of the screen wide and 16:9', () => {
    const r = peekRect({ w: 1920, h: 1080 });
    expect(r.w).toBeCloseTo(384);
    expect(r.h).toBeCloseTo(216);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
  });
  it('follows the screen it is given', () => {
    const r = peekRect({ w: 1280, h: 720 });
    expect(r).toEqual({ x: 24, y: 720 - 24 - 64 - 144, w: 256, h: 144 });
  });
});

describe('peekCadence', () => {
  it('draws every other frame when that adds 3 ms or less', () => {
    expect(peekCadence('high', 1.2)).toBe(2);
    expect(peekCadence('high', 3)).toBe(2);
  });
  it('draws every third frame when every other frame adds up to 4.5 ms (3 ms or less at every third)', () => {
    expect(peekCadence('high', 3.01)).toBe(3);
    expect(peekCadence('medium', 4.5)).toBe(3);
  });
  it('falls back to a still when even every third frame would add over 3 ms', () => {
    expect(peekCadence('high', 4.51)).toBe('still');
    expect(peekCadence('low', 20)).toBe('still');
  });
  it("uses the tier's default before anything is measured", () => {
    for (const t of TIERS) expect(peekCadence(t, null)).toBe(PEEK_CADENCE[t]);
  });
});

describe('createPeek: the second eye', () => {
  /** A peek over fakes: a renderer that draws nothing, and the residents' second eye as it is set. */
  const setup = () => {
    const eyes: (Camera | null)[] = [];
    const renderer = { getOutputBufferType: () => HalfFloatType, render() {}, getRenderTarget: () => null, setRenderTarget() {},
      domElement: { clientWidth: 1920, clientHeight: 1080 }, _callDepth: 0 } as unknown as WebGPURenderer;
    const peek = createPeek({ renderer, scene: new Scene(), camera: new PerspectiveCamera(55, 16 / 9, 0.1, 8000), post: { peek: peekUniforms() },
      residents: { setSecondEye: (c) => void eyes.push(c) }, terrain: { centreOn: () => () => {} },
      fade: { eye: uniform(new Vector3()), start: uniform(0) } as unknown as TreeFade, tier: 'high' });
    return { peek, eyes };
  };
  const pose = { pos: { x: 0, y: 10, z: 0 }, yaw: 0, pitch: 0 };

  it("a still gives the eye back once drawn; closing it later leaves alone an eye that is no longer the peek's", () => {
    const { peek, eyes } = setup();
    peek.cadence = 'still';
    peek.open(pose);
    for (let f = 0; f < 4; f++) peek.frame(f);
    expect(peek.drawn).toBe(true);
    expect(eyes).toHaveLength(2);
    expect(eyes[1]).toBeNull(); // the still is taken: given back
    peek.close(); // fading out after the documentary's warm took the eye: not cleared
    expect(eyes).toHaveLength(2);
  });

  it('closing a peek that still holds the eye gives it back', () => {
    const { peek, eyes } = setup();
    peek.cadence = 2;
    peek.open(pose);
    for (let f = 0; f < 4; f++) peek.frame(f);
    peek.close();
    expect(eyes.at(-1)).toBeNull();
    expect(eyes).toHaveLength(2);
  });
});
