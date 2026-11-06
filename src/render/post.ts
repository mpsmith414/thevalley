import { ColorManagement, DepthTexture, RenderPipeline, RenderTarget, Texture, Vector4, type Camera, type ColorSpace, type Node, type PassNode, type Scene, type TextureNode, type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { Fn, If, abs, float, max, mix, pass, renderOutput, screenUV, texture, uniform, vec4 } from 'three/tsl';
import { bloom, type default as BloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { NEUTRAL_GRADE, gradeNode, gradeUniforms, type Grade, type GradeUniforms } from './grade';
import { lensColourNode, lensSceneNode, lensUniforms, type LensUniforms } from './lens';
import { nodeFrameOf, pipelineOutput } from './probe';
import type { Tier } from './quality';

/** Per-tier post-processing: bloom (on the HDR picture, before tone mapping) and the scene pass's MSAA samples. */
export type PostSettings = { bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number; samples: number };

// Only the sun, the glow round it and the glints on the water bloom. The threshold is on the HDR picture before exposure:
// the noon sky reaches over 3 in places (at 1 it hazed the tree tops and mountains), the sun's glow and glints go well past 5.
const BLOOM = { bloomStrength: 0.15, bloomRadius: 0.4, bloomThreshold: 5 };
export const POST: Record<Tier, PostSettings> = {
  high: { bloom: true, ...BLOOM, samples: 4 },
  medium: { bloom: true, ...BLOOM, bloomStrength: BLOOM.bloomStrength * 0.8, samples: 4 },
  low: { bloom: false, ...BLOOM, samples: 4 },
};

/**
 * The picture's last stage. `render()` draws the scene (or, for a one-off such as a snapshot, another `scene` and `camera`)
 * through the pipeline; `grade` holds the colour grade's uniforms, `lens` the Eyes view's lens's (all off but in Eyes),
 * `peek` the corner the peek is laid into (closed but while it shows; see peek.ts).
 */
export type Post = { render(scene?: Scene, camera?: Camera): void; grade: GradeUniforms; lens: LensUniforms; peek: PeekUniforms; setTier(t: Tier): void; dispose(): void };

/**
 * The corner the post pipeline lays the peek into: `strength` 0 (closed: the picture is untouched and the work is
 * skipped) to 1, `rect` its place as a share of the screen (x, y from the top-left, width, height) and `map` its picture.
 */
export type PeekUniforms = { strength: UniformNode<'float', number>; rect: UniformNode<'vec4', Vector4>; map: TextureNode };

/** The corner's uniforms, closed (the peek sets its picture into `map` when it is made). */
export function peekUniforms(): PeekUniforms {
  return { strength: uniform(0), rect: uniform(new Vector4(0, 0, 0, 0)), map: texture(new Texture()) };
}

/**
 * The HDR picture `color` with the peek laid into its corner (before tone mapping, so the peek is tone mapped and graded
 * with the rest). With `strength` 0 a branch on the uniform skips it all.
 */
export function peekNode(color: Node, u: PeekUniforms): Node {
  return Fn(() => {
    const out = vec4(color as Node<'vec4'>).toVar();
    If(u.strength.greaterThan(0), () => {
      const p = screenUV.sub(u.rect.xy).div(u.rect.zw).toVar(); // 0..1 across the corner
      const off = abs(p.sub(0.5));
      If(max(off.x, off.y).lessThanEqual(0.5), () => {
        // the top level by name: a branch on the pixel's place may not take a texture's derivatives
        out.assign(mix(out, u.map.sample(p).level(float(0)), u.strength));
      });
    });
    return out;
  })();
}

/** The scene pass's MSAA samples: as asked, or one on WebGL 2 when the context cannot multisample a half-float target. */
function passSamples(renderer: WebGPURenderer, want: number): number {
  const gl = (renderer.backend as { gl?: WebGL2RenderingContext }).gl;
  if (!gl || want <= 1) return want;
  const float = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  return float && gl.getParameter(gl.MAX_SAMPLES) >= want ? want : 0; // 0: one sample, no multisampled renderbuffer
}

/**
 * The post-processing pipeline: an MSAA scene pass into a half-float target, bloom on the HDR picture (High and Medium),
 * the Eyes view's lens on the HDR picture (its shape and exposure), then `renderOutput` (the renderer's tone mapping,
 * exposure and output colour space), the lens's colour and the grade on the display-referred picture. The lens is built
 * in once with its strengths as uniforms (see `lens.ts`): off, it hands the picture on untouched. The pass's target
 * matches the renderer's own frame buffer target (half float, 4 samples, linear working colour space, depth24plus), so
 * the pipelines `compileTogether` builds for the canvas are the ones the pass draws with. The peek (peek.ts), when it
 * shows, is laid into its corner after the lens's shape and before the tone mapping. The pipeline's own quad
 * materials compile on the first `render()`.
 *
 * If this three build cannot place the output transform itself (see `pipelineOutput`), it draws straight with
 * `renderer.render`: no bloom, no grade, no lens.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, tier: Tier, grade: Grade = NEUTRAL_GRADE): Post {
  const u = gradeUniforms(grade), lens = lensUniforms(), peek = peekUniforms();
  const pipeline = new RenderPipeline(renderer);
  if (!pipelineOutput(pipeline)) {
    pipeline.dispose();
    return { render: (s = scene, c = camera) => renderer.render(s, c), grade: u, lens, peek, setTier: () => {}, dispose: () => {} };
  }
  pipeline.outputColorTransform = false; // renderOutput below does it, so the grade can follow
  let scenePass: PassNode | null = null, glow: BloomNode | null = null;
  // The look from under the water reads the scene's depth, but only a fish's Eyes need it: bound into the frame, the
  // multisampled depth costs up to 10 ms a frame in the forest views on the owner's PC (River Bend 29 ms against 21; the
  // read itself waits behind the lens's If). So the picture binds a one-pixel stand-in with the same samples, and the
  // real depth only while the lens is under water (see `bindDepth`).
  let depth: TextureNode | null = null, stand: RenderTarget | null = null;
  const build = (t: Tier) => {
    const s = POST[t], samples = passSamples(renderer, s.samples);
    scenePass?.dispose();
    glow?.dispose();
    stand?.dispose();
    scenePass = pass(scene, camera, { samples, colorSpace: ColorManagement.workingColorSpace as ColorSpace });
    stand = new RenderTarget(1, 1, { samples, depthTexture: new DepthTexture(1, 1) });
    const picture = scenePass.getTextureNode();
    let hdr: Node<'vec4'> = picture;
    glow = s.bloom ? bloom(hdr, s.bloomStrength, s.bloomRadius, s.bloomThreshold) : null;
    // the glow's alpha is 1: add its colour only, so the scene's own alpha (under 1 where the sky is drawn) still
    // unpremultiplies as it does without bloom
    if (glow) hdr = vec4(hdr.rgb.add(glow.rgb), hdr.a);
    // the glow's own texture, for the lens to read at bent places (r186's typings name it `getTexture`; it is `getTextureNode`)
    const glowTex = glow ? (glow as unknown as { getTextureNode(): TextureNode }).getTextureNode() : null;
    // the scene's depth and camera, for the look from under the water
    depth = scenePass.getTextureNode('depth');
    const view = { depth, camera: () => scenePass!.camera };
    const seen = peekNode(lensSceneNode(hdr, picture, glowTex, lens, view), peek);
    pipeline.outputNode = gradeNode(lensColourNode(renderOutput(seen), lens), u);
    pipeline.needsUpdate = true;
  };
  build(tier);
  // The pass and the bloom draw once per node frame (r186: NodeUpdateType.FRAME), and the node frame advances only in the
  // renderer's animation loop (or a compileAsync). Shots, perf and snapshots render more than once between animation frames
  // (or while the window is hidden, with none at all), and the second render would show the first's picture: so a render in
  // a frame that has already been drawn starts a new one. (Updating the pass on every render instead draws the scene twice:
  // the bloom's own passes sample the scene texture, which updates the pass again.)
  const frame = nodeFrameOf(renderer);
  let drawn = -1;
  /** The scene's depth while the lens is under water, the stand-in otherwise (a new pairing rebinds once, then is cached). */
  const bindDepth = () => {
    if (depth) depth.value = lens.underwater.value > 0 ? scenePass!.getTexture('depth') : stand!.depthTexture!;
  };
  const draw = () => {
    if (frame) {
      if (frame.frameId === drawn) frame.update();
      drawn = frame.frameId;
    }
    bindDepth();
    pipeline.render();
  };
  return {
    render(s = scene, c = camera) {
      const p = scenePass!;
      if (s === scene && c === camera) return draw();
      p.scene = s;
      p.camera = c;
      try {
        draw();
      } finally {
        p.scene = scene;
        p.camera = camera;
      }
    },
    grade: u,
    lens,
    peek,
    setTier: build, // tiers change on a reload today; this rebuilds the graph (bloom on or off, samples) when called
    dispose() {
      scenePass?.dispose();
      glow?.dispose();
      stand?.dispose();
      pipeline.dispose();
    },
  };
}
