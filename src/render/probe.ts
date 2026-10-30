import { renderOutput, skinning } from 'three/tsl';
import type { RenderPipeline, WebGPURenderer } from 'three/webgpu';

/**
 * Dev-mode checks on the three.js internals the valley leans on (written against r186; see HANDOFF's "three r186
 * workarounds"). `probe(ok, what)` warns once per `what` when `ok` is false, so an upgrade that moves one shows up in the
 * console instead of as a quiet slowdown or a wrong picture. Production builds skip the warning. Returns `ok`.
 */
const warned = new Set<string>();
export function probe(ok: boolean, what: string): boolean {
  if (!ok && import.meta.env.DEV && !warned.has(what)) {
    warned.add(what);
    console.warn(`three workaround: ${what}. Check it against the installed three (written for r186).`);
  }
  return ok;
}

/**
 * True when three's skinning poses a geometry's `tangent` attribute along with its normal: r186's `skinning`
 * (nodes/accessors/Skinning.js) assigns `tangentLocal` the skinned tangent when the geometry has a `tangent` attribute.
 * The creatures carry their groom (hair direction) in that attribute so the fur follows the pose (see `lodGeometry`).
 * Checked on the source of `skinning`'s function (dev builds keep it readable; production skips the warning anyway).
 * If it fails, the hair keeps its rest direction when the animal moves (no error, just fur that doesn't turn with the head).
 */
let tangentChecked: boolean | null = null;
export function skinsTangent(): boolean {
  if (tangentChecked === null) {
    const src = String((skinning as unknown as { shaderNode?: { jsFunc?: unknown } }).shaderNode?.jsFunc ?? '');
    tangentChecked = probe(/hasGeometryAttribute\(\s*['"]tangent['"]\s*\)[\s\S]{0,200}?tangentLocal\w*\.assign\(/.test(src),
      "three's skinning no longer assigns tangentLocal from a `tangent` attribute, so the fur's groom stays in the rest pose (fur.ts; creature.ts binds the groom as `tangent`)");
  }
  return tangentChecked;
}

/**
 * True when the post pipeline can grade after tone mapping: r186's `RenderPipeline` has an `outputColorTransform` switch
 * (off: the app places the tone mapping and output colour space itself, with `renderOutput`). If either has gone, `createPost`
 * draws straight with `renderer.render` instead (no bloom, no grade, no MSAA from the pass: the canvas's own antialiasing).
 */
export function pipelineOutput(pipeline: RenderPipeline): boolean {
  return probe(typeof renderOutput === 'function' && typeof (pipeline as { outputColorTransform?: unknown }).outputColorTransform === 'boolean',
    "three's RenderPipeline has no `outputColorTransform` (or `renderOutput` has gone), so the valley and the lab draw without post-processing (post.ts)");
}

/** The part of three's node frame the post pipeline uses. */
export type NodeFrameLike = { frameId: number; update(): void };
/**
 * The renderer's node frame (r186: `renderer._nodes.nodeFrame`, set by `init`). The post pipeline advances it when it renders
 * twice in one animation frame (see `createPost`), and the workshop's studio, drawn from the valley's loop, advances it before
 * each of its frames. Null, with a warning naming `loss` (what the caller loses without it), if it has moved.
 */
export function nodeFrameOf(renderer: WebGPURenderer,
  loss = 'the post pipeline cannot start a new frame for shots and snapshots, which repeat the frame before (post.ts)'): NodeFrameLike | null {
  const f = (renderer as unknown as { _nodes?: { nodeFrame?: Partial<NodeFrameLike> } })._nodes?.nodeFrame;
  const ok = !!f && typeof f.frameId === 'number' && typeof f.update === 'function';
  return probe(ok, `three's renderer has no \`_nodes.nodeFrame\` (update, frameId), so ${loss}`) ? (f as NodeFrameLike) : null;
}
