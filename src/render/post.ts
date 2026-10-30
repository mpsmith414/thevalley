import { ColorManagement, RenderPipeline, type Camera, type ColorSpace, type Node, type PassNode, type Scene, type WebGPURenderer } from 'three/webgpu';
import { pass, renderOutput, vec4 } from 'three/tsl';
import { bloom, type default as BloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { NEUTRAL_GRADE, gradeNode, gradeUniforms, type Grade, type GradeUniforms } from './grade';
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
 * through the pipeline; `grade` holds the colour grade's uniforms.
 */
export type Post = { render(scene?: Scene, camera?: Camera): void; grade: GradeUniforms; setTier(t: Tier): void; dispose(): void };

/** The scene pass's MSAA samples: as asked, or one on WebGL 2 when the context cannot multisample a half-float target. */
function passSamples(renderer: WebGPURenderer, want: number): number {
  const gl = (renderer.backend as { gl?: WebGL2RenderingContext }).gl;
  if (!gl || want <= 1) return want;
  const float = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  return float && gl.getParameter(gl.MAX_SAMPLES) >= want ? want : 0; // 0: one sample, no multisampled renderbuffer
}

/**
 * The post-processing pipeline: an MSAA scene pass into a half-float target, bloom on the HDR picture (High and Medium),
 * then `renderOutput` (the renderer's tone mapping, exposure and output colour space) and the grade on the display-referred
 * picture. The pass's target matches the renderer's own frame buffer target (half float, 4 samples, linear working colour
 * space, depth24plus), so the pipelines `compileTogether` builds for the canvas are the ones the pass draws with. The
 * pipeline's own quad materials compile on the first `render()`.
 *
 * If this three build cannot place the output transform itself (see `pipelineOutput`), it draws straight with
 * `renderer.render`: no bloom, no grade.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, tier: Tier, grade: Grade = NEUTRAL_GRADE): Post {
  const u = gradeUniforms(grade);
  const pipeline = new RenderPipeline(renderer);
  if (!pipelineOutput(pipeline)) {
    pipeline.dispose();
    return { render: (s = scene, c = camera) => renderer.render(s, c), grade: u, setTier: () => {}, dispose: () => {} };
  }
  pipeline.outputColorTransform = false; // renderOutput below does it, so the grade can follow
  let scenePass: PassNode | null = null, glow: BloomNode | null = null;
  const build = (t: Tier) => {
    const s = POST[t];
    scenePass?.dispose();
    glow?.dispose();
    scenePass = pass(scene, camera, { samples: passSamples(renderer, s.samples), colorSpace: ColorManagement.workingColorSpace as ColorSpace });
    let hdr: Node<'vec4'> = scenePass.getTextureNode();
    glow = s.bloom ? bloom(hdr, s.bloomStrength, s.bloomRadius, s.bloomThreshold) : null;
    // the glow's alpha is 1: add its colour only, so the scene's own alpha (under 1 where the sky is drawn) still
    // unpremultiplies as it does without bloom
    if (glow) hdr = vec4(hdr.rgb.add(glow.rgb), hdr.a);
    pipeline.outputNode = gradeNode(renderOutput(hdr), u);
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
  const draw = () => {
    if (frame) {
      if (frame.frameId === drawn) frame.update();
      drawn = frame.frameId;
    }
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
    setTier: build, // tiers change on a reload today; this rebuilds the graph (bloom on or off, samples) when called
    dispose() {
      scenePass?.dispose();
      glow?.dispose();
      pipeline.dispose();
    },
  };
}
