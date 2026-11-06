/**
 * The peek: a small live picture of somewhere else in the valley, drawn into a corner of the main picture (the invitation
 * card's, in free flight). A second camera draws the scene, smaller and simpler than the main view (spec section 4, "The
 * second eye"): 480 × 270, without the ground cover and the senses' trails, without bloom or the lens, but tone mapped and
 * graded like the rest (the post pipeline lays it into its corner before its tone mapping and grade: `peekNode` in post.ts).
 * It draws every other frame, every third, or once (a still) as its tier can afford (`peekCadence`).
 */
import { ColorManagement, DepthTexture, LinearFilter, PerspectiveCamera, RenderTarget, type Camera, type ColorSpace, type Scene, type WebGPURenderer } from 'three/webgpu';
import { GROUND_COVER_LAYER } from '../plants/grass';
import type { TreeFade } from '../plants/fade';
import type { Pose } from '../views/types';
import { TRAIL_LAYER } from '../views/trail-mesh';
import { holdShadows } from '../world/lake';
import { POST, type PeekUniforms } from './post';
import { probe } from './probe';
import type { Tier } from './quality';

/** The peek's picture in pixels (16:9): what is drawn, whatever the size of the screen. */
export const PEEK_W = 480, PEEK_H = 270;
/** On screen the peek is this share of the screen's width, 16:9, this many CSS px in from the left and bottom edges. */
const SHARE = 0.2, MARGIN = 24;
/** Under the picture, room for the invitation card's line and hint: this share of the picture's width. */
export const CARD_TEXT = 0.25;

/** A place on the screen, in CSS px from its top-left corner. */
export type PeekRect = { x: number; y: number; w: number; h: number };

/**
 * Where the peek shows on a screen `w` × `h` CSS px: in its bottom-left corner, 20% of its width, 16:9, 24 px in from the
 * left, with the card's line and hint under it (CARD_TEXT) and 24 px below them.
 */
export function peekRect(screen: { w: number; h: number }): PeekRect {
  const w = screen.w * SHARE, h = (w * 9) / 16;
  return { x: MARGIN, y: screen.h - MARGIN - w * CARD_TEXT - h, w, h };
}

/**
 * How often each tier's peek is drawn: every 2nd frame, every 3rd, or a `'still'` drawn once when it opens. Measured on
 * the owner's PC (High, 1920 × 1080, noon): at Lake Shore, a live peek on the herd across the lake added 6.3 ms a frame
 * drawn every other frame and 4.8 ms every third (the second eye's bands alone, before any drawing, 2.1 ms; one picture
 * about 8.6 ms), against 3 ms allowed; at River Bend, with the herd far off in the main view, 16 and 14.5 ms. A still adds
 * nothing once taken. So every tier shows a still.
 */
export const PEEK_CADENCE: Record<Tier, 2 | 3 | 'still'> = { high: 'still', medium: 'still', low: 'still' };
/**
 * Frames between opening and the first picture: on the first the spot is banded for the peek's camera and the main view
 * meets what it brings (new plant and animal buffers go up then), so the first picture's frame has less to do.
 */
const SETTLE_FRAMES = 1;
/** The most the peek may add to a frame, averaged over its frames (ms). */
const BUDGET_MS = 3;

/**
 * How often to draw the peek, from what drawing it every other frame was measured to add to a frame on average
 * (`measuredMs`; null: not measured, the tier's default): every other frame if that is within 3 ms; every third if that
 * brings it within 3 ms (4.5 ms at every other frame); otherwise a still.
 */
export function peekCadence(tier: Tier, measuredMs: number | null): 2 | 3 | 'still' {
  if (measuredMs === null) return PEEK_CADENCE[tier];
  return measuredMs <= BUDGET_MS ? 2 : (measuredMs * 2) / 3 <= BUDGET_MS + 1e-9 ? 3 : 'still';
}

/** What the peek draws with. `lake` is the lake's mirror switch (the peek's water mirrors the sky). */
export type PeekDeps = {
  renderer: WebGPURenderer; scene: Scene; camera: Camera & { fov: number; near: number; far: number }; post: { peek: PeekUniforms };
  residents: { setSecondEye(camera: Camera | null): void };
  terrain: { centreOn(x: number, z: number): () => void };
  fade: TreeFade; lake?: { mirror(on: boolean): void }; tier: Tier;
};

/** The peek, as the frame and the invitation card use it. */
export type Peek = {
  /**
   * Show the peek from `pose`, with a vertical field of view of `fov` degrees (the main camera's when left out; a card's
   * still narrows it, so a small animal fills the picture from a safe distance): its first picture (or its still) is drawn
   * on the second frame after (SETTLE_FRAMES).
   */
  open(pose: Pose, fov?: number): void;
  /** Move the peek's camera to `pose` (a live peek shows it from its next drawing). */
  aim(pose: Pose): void;
  close(): void;
  /** How much of the picture shows, 0 to 1 (the card fades it in and out); 1 until set. */
  fade(a: number): void;
  /** Its picture (or its still) has been drawn since it opened. */
  readonly drawn: boolean;
  /** Called every frame (`frameNo` counts them), before the main picture: draws the peek when it is due. */
  frame(frameNo: number): void;
  readonly showing: boolean;
  /** The peek's camera while its spot is banded for it (the vegetation's second eye: a live peek, or a still until taken), else null. */
  readonly eye: Camera | null;
  /** How often it draws: every 2nd or 3rd frame, or a still. */
  cadence: 2 | 3 | 'still';
  /**
   * Draw `eye`'s view once, unseen, the way the peek and the scene pass draw (shadows and all): what it shows then has
   * its shaders built for the picture, so neither the peek nor the main view stalls on first seeing it (the animals'
   * warm-up uses it).
   */
  prime(eye: Camera): void;
};

/** Layers the peek never draws: the ground cover (grass, flowers, reeds, lily pads) and the senses' trails and ripples. */
const HIDDEN = (1 << GROUND_COVER_LAYER) | (1 << TRAIL_LAYER);

/**
 * The peek's picture. Its camera draws what the main camera draws but the hidden layers, into a 480 × 270 target that
 * matches the main scene pass's (half float, the same samples, the working colour space, depth24plus), so it shares
 * every pipeline the valley has compiled. For its render the ground's rings and the trees' cross-fade centre on it,
 * the shadow maps are held (the main view's are reused: the cascades stay on the main camera) and the lake mirrors the
 * sky; all put back before the main picture. While it shows, the animals see it as their second eye (and `eye` hands it
 * to the plants).
 *
 * It is drawn one level down, as if from inside the post pipeline like the scene pass (r186's `renderer._callDepth`):
 * three keys every material's built shaders by the render context, and the context by the target's kind AND how deeply
 * the render is nested. Drawn at the top level, every material in the peek built its shaders afresh the first time it
 * was seen there (a 300-800 ms first open at Lake Shore); one level down it shares the scene pass's context, and with it
 * everything the valley has already drawn.
 */
export function createPeek(d: PeekDeps): Peek {
  const { renderer, scene, post, fade } = d;
  const target = new RenderTarget(PEEK_W, PEEK_H, {
    type: renderer.getOutputBufferType(), colorSpace: ColorManagement.workingColorSpace as ColorSpace, samples: POST[d.tier].samples,
    depthTexture: new DepthTexture(PEEK_W, PEEK_H), generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  post.peek.map.value = target.texture;
  const cam = new PerspectiveCamera(d.camera.fov, PEEK_W / PEEK_H, d.camera.near, d.camera.far);
  const eyeWas = fade.eye.value.clone();
  let showing = false, due = false, seeing = false; // seeing: the animals and plants are shown to its camera
  let drawn = false, strength = 1; // its picture is in the corner, and how much of it shows
  let lens: number | null = null; // the field of view it was opened with (null: the main camera's)
  let settle = 0; // frames before the first picture (SETTLE_FRAMES)
  const nest = renderer as unknown as { _callDepth?: number };
  const nested = probe(typeof nest._callDepth === 'number',
    "three's renderer has no `_callDepth`, so the peek draws at the top level and builds every material's shaders afresh the first time it sees them (peek.ts)");

  const place = (pose: Pose) => {
    cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    cam.rotation.set(pose.pitch, pose.yaw, pose.roll ?? 0, 'YXZ');
    cam.updateMatrixWorld();
  };
  /** The peek's lens: its own field of view (or the main camera's), the main camera's near and far. */
  const lensUp = () => {
    const main = d.camera, fov = lens ?? main.fov;
    if (cam.fov !== fov || cam.near !== main.near || cam.far !== main.far) {
      Object.assign(cam, { fov, near: main.near, far: main.far });
      cam.updateProjectionMatrix();
    }
  };
  /** Where the corner is on the screen now, as a share of it. */
  const corner = () => {
    const el = renderer.domElement, w = el.clientWidth || el.width, h = el.clientHeight || el.height;
    const r = peekRect({ w, h });
    post.peek.rect.value.set(r.x / w, r.y / h, r.w / w, r.h / h);
  };
  /** One render of `eye`'s view into the peek's target, one level down (see above). */
  const render = (eye: Camera) => {
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    if (nested) nest._callDepth!++;
    try {
      renderer.render(scene, eye);
    } finally {
      if (nested) nest._callDepth!--;
      renderer.setRenderTarget(was);
    }
  };
  const draw = () => {
    const main = d.camera;
    cam.layers.mask = main.layers.mask & ~HIDDEN;
    lensUp();
    eyeWas.copy(fade.eye.value);
    let undoGround: (() => void) | null = null, shadows: ReturnType<typeof holdShadows> | null = null;
    try {
      undoGround = d.terrain.centreOn(cam.position.x, cam.position.z);
      fade.eye.value.copy(cam.position);
      shadows = holdShadows(scene);
      d.lake?.mirror(false);
      render(cam);
    } finally { // the main picture's ground, fade, shadows and mirror come back whatever happened
      d.lake?.mirror(true);
      shadows?.release();
      fade.eye.value.copy(eyeWas);
      undoGround?.();
    }
  };

  const peek: Peek = {
    cadence: PEEK_CADENCE[d.tier],
    open(pose, fov) {
      lens = fov ?? null;
      lensUp(); // the animals and plants are banded for the frustum it will draw
      place(pose);
      d.residents.setSecondEye(cam);
      showing = due = seeing = true; // the still, or the live peek's first picture, drawn once the spot has settled
      drawn = false;
      settle = SETTLE_FRAMES;
    },
    aim: place,
    prime: render,
    close() {
      // the second eye is given back only while it is the peek's: a still's is back already, and may be a warm's by now
      if (seeing) d.residents.setSecondEye(null);
      showing = due = seeing = drawn = false;
      post.peek.strength.value = 0;
    },
    fade(a) {
      strength = Math.max(0, Math.min(1, a));
      if (drawn) post.peek.strength.value = strength;
    },
    frame(frameNo) {
      if (!showing) return;
      if (settle > 0) return void settle--;
      const c = peek.cadence;
      if (due || (c !== 'still' && frameNo % c === 0)) {
        draw();
        due = false;
        drawn = true;
        post.peek.strength.value = strength;
        // a still needs its spot no more: the animals and plants there go back to the main camera's bands
        if (c === 'still' && seeing) {
          seeing = false;
          d.residents.setSecondEye(null);
        }
      }
      corner();
    },
    get showing() {
      return showing;
    },
    get drawn() {
      return drawn;
    },
    get eye() {
      return seeing ? cam : null;
    },
  };
  return peek;
}
