/**
 * The far forest: every tree past the mid band drawn as a camera-facing quad showing one of 8 views baked at load.
 *
 * Bake: each tree model the mid band draws (5 kinds × 3 variants, `MID_VARIANTS`) is drawn from 8 azimuths (every 45°,
 * 8° up) by an orthographic camera into two atlases, one row per model and one cell per view: its unlit colour (the plant
 * materials' own colour, sRGB-encoded) and its model-space normal (half size), both premultiplied by coverage so that
 * their mips average only what is covered. Drawn: one instanced quad per tree of the valley (density-thinned, filled
 * once), turned about y towards the camera, showing the two views nearest the camera's angle blended by fraction, alpha
 * tested at 0.5 and lit like any plant (the key light, hemisphere and environment, with the baked normal; fog). The
 * vertex shader folds away trees nearer than `midTree − 10` or beyond `viewDistance`; over those first 10 m the impostor
 * dithers in as the mid tree dithers out (`fade.ts`).
 */
import {
  BufferAttribute, Color, DoubleSide, Group, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute,
  LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, OrthographicCamera, PhysicalLightingModel, RenderTarget,
  Scene, Vector2, Vector4, type Node, type NodeBuilder, type Texture, type WebGPURenderer,
} from 'three/webgpu';
import {
  atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, diffuseColor, dot, float, floor, fract,
  int, max, mix, normalGeometry, positionGeometry, positionWorld, pow, screenCoordinate, select, texture, uniform, uniformArray, uv, varying,
  vec2, vec3, vec4,
} from 'three/tsl';
import { probe } from '../render/probe';
import type { WorldQuality } from '../world/quality';
import { GPU_STRIDE, MID_VARIANTS, collectInstances } from '../world/tiles';
import type { TileData, ValleyData } from '../valley/types';
import { bayer4Node, farFadeNode, FADE } from './fade';
import { tinted, withKind, type PlantMaterial, type PlantMaterials } from './material';
import type { PlantModelSet } from './generator';
import { PLANT_KINDS, TREE_KINDS, VARIANTS } from './species';

export { FADE, bayer4, farFade } from './fade';

export const IMPOSTOR_VIEWS = 8;
/** The bake camera looks down this much (radians): the far forest is mostly seen from a little above. */
export const BAKE_ELEVATION = (8 * Math.PI) / 180;
/** The variants baked (the mid band's: one young, two mature); the others are drawn with these, rescaled to their height. */
const BAKED = [...new Set(MID_VARIANTS)];
/** Atlas rows: one per baked tree model. */
export const IMPOSTOR_ROWS = TREE_KINDS.length * BAKED.length;
/** The layer the impostors are on (the main camera, the far shadow cascades on High and the lake's mirror draw it). */
export const IMPOSTOR_LAYER = 4;
/** The LOD baked: the mid one, which is what the impostor replaces (LOD0's extra twigs made the far crowns browner). */
const BAKE_LOD = 1;
/** Alpha cut of the impostors. */
const CUT = 0.5;

/** The atlas row of a tree of kind `kind` (index into PLANT_KINDS) and variant `variant`. */
export const impostorRow = (kind: number, variant: number): number =>
  TREE_KINDS.indexOf(PLANT_KINDS[kind]) * BAKED.length + BAKED.indexOf(MID_VARIANTS[variant]);

/**
 * The two baked views to blend for a camera at azimuth `cameraAngle` (radians, `atan2(dx, dz)` of the direction from the
 * tree to the camera) of a tree turned by `instanceYaw`: view `a` (the one at or before the angle, in the model's frame),
 * `b` (the next one round) and how far (0..1) the angle is from `a` to `b`.
 * CPU twin of the vertex shader's `turn`, `f`, `a`, `b`, `t` in `createImpostorLayer`: change them together.
 */
export function viewIndex(cameraAngle: number, instanceYaw: number, views = IMPOSTOR_VIEWS): { a: number; b: number; t: number } {
  const turn = (cameraAngle - instanceYaw) / (2 * Math.PI);
  let f = (turn - Math.floor(turn)) * views;
  if (Math.abs(f - Math.round(f)) < 1e-9) f = Math.round(f); // on a view: that view, not the very end of the one before
  const a = Math.floor(f) % views;
  return { a, b: (a + 1) % views, t: f - Math.floor(f) };
}

/**
 * Whether a tree `distance` metres from the camera has its impostor drawn: from `midTree − FADE` out to `viewDistance`.
 * CPU twin of the vertex shader's `shown` in `createImpostorLayer` (`fade.start` is midTree − FADE): change them together.
 */
export const impostorVisible = (distance: number, q: Pick<WorldQuality, 'midTree' | 'viewDistance'>): boolean =>
  distance >= q.midTree - FADE && distance <= q.viewDistance;

/**
 * The quad that holds a model (`positions`, xyz) in all `views` views from `elevation` up, in model metres: half its width,
 * and its bottom and top (heights on the upright quad, so a trunk keeps its length although the views look down), with a
 * small margin all round.
 */
export function viewFrame(positions: Float32Array, views = IMPOSTOR_VIEWS, elevation = BAKE_ELEVATION) {
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  let w = 0, lo = Infinity, hi = -Infinity;
  for (let v = 0; v < views; v++) {
    const th = (v * 2 * Math.PI) / views, s = Math.sin(th), c = Math.cos(th);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const sx = x * c - z * s, sy = y * ce - (x * s + z * c) * se;
      if (Math.abs(sx) > w) w = Math.abs(sx);
      if (sy < lo) lo = sy;
      if (sy > hi) hi = sy;
    }
  }
  const m = (hi - lo) * 0.015 + 0.02;
  return { halfWidth: w * 1.03 + 0.05, bottom: lo / ce - m, top: hi / ce + m };
}
export type ViewFrame = ReturnType<typeof viewFrame>;

/**
 * Every tree of the valley, thinned by `density` (per kind), packed `GPU_STRIDE` floats each with the atlas row in the last
 * (x, y, z, yaw · scale, leanX, leanZ, tint · age, health, phase, row), model by model. The instances come from the tiles'
 * own `collectInstances`, folded onto the baked variants (`MID_VARIANTS`) as the mid band folds them, so the mid trees and
 * their impostors are the same trees, thinned and rescaled (to keep each tree's own height, `heights`: per model) by one
 * rule. (The phase is part of that shared layout; the impostors do not read it.)
 */
export function packImpostors(tiles: readonly TileData[], density: readonly number[], heights: readonly number[]) {
  const kinds = TREE_KINDS.map((k) => PLANT_KINDS.indexOf(k));
  const buckets = collectInstances(tiles, tiles.map(() => 'far'), 'far', { kinds, density, heights, remap: MID_VARIANTS });
  const count = buckets.reduce((n, b) => n + b.count, 0), data = new Float32Array(count * GPU_STRIDE);
  let at = 0;
  buckets.forEach((b, m) => {
    if (!b.count) return;
    const row = impostorRow(Math.floor(m / VARIANTS), m % VARIANTS);
    data.set(b.data.subarray(0, b.count * GPU_STRIDE), at);
    for (let i = 0; i < b.count; i++) data[at + i * GPU_STRIDE + 11] = row; // the model height's slot: the atlas row
    at += b.count * GPU_STRIDE;
  });
  return { data, count };
}

/** The baked atlases: colour (sRGB-encoded, premultiplied by coverage) and normal (half size), and each row's quad. */
export type ImpostorBake = {
  albedo: Texture; normal: Texture; frames: ViewFrame[]; size: number;
  /** Milliseconds the bake took, and the atlases' GPU memory (bytes, with their mips). */
  ms: number; bytes: number;
  dispose(): void;
};

const i0 = attribute('i0', 'vec4') as Node<'vec4'>, i1 = attribute('i1', 'vec4') as Node<'vec4'>, i2 = attribute('i2', 'vec4') as Node<'vec4'>;

/** The geometries of a model's groups (one instance, untransformed, of age `age`) for the bake. */
function bakeGeometries(model: PlantModelSet[number], age: number) {
  const m = model.lods[BAKE_LOD];
  const buf = new InstancedInterleavedBuffer(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, age, 1, 0, model.height]), GPU_STRIDE, 1);
  const attrs = {
    position: new BufferAttribute(m.positions, 3), normal: new BufferAttribute(m.normals, 3), uv: new BufferAttribute(m.uvs, 2),
    info: new BufferAttribute(withKind(m.info, model.kind), 4),
    i0: new InterleavedBufferAttribute(buf, 4, 0), i1: new InterleavedBufferAttribute(buf, 4, 4), i2: new InterleavedBufferAttribute(buf, 4, 8),
  };
  const index = new BufferAttribute(m.indices, 1);
  return m.groups.map((grp) => {
    const g = new InstancedBufferGeometry();
    for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
    g.setIndex(index);
    g.setDrawRange(grp.start, grp.count);
    g.instanceCount = 1;
    return { g, material: grp.material };
  });
}

/**
 * Bake the impostor atlases (see the top of this file): `size` px per view (`WorldQuality.impostorSize`), so the colour
 * atlas is `8·size × 15·size` and the normal atlas half that. Each model is drawn with its kind's plant materials' own
 * colour and leaf cut (unlit, unswayed) and its geometry normals, one view at a time into a small target, then copied in.
 */
export async function bakeImpostors(renderer: WebGPURenderer, models: PlantModelSet, materials: PlantMaterials, size: number): Promise<ImpostorBake> {
  const t0 = performance.now();
  const V = IMPOSTOR_VIEWS, R = IMPOSTOR_ROWS, ns = size / 2;
  const atlas = (w: number, h: number) => {
    const rt = new RenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
    rt.texture.anisotropy = 4;
    renderer.initRenderTarget(rt);
    rt.texture.generateMipmaps = false; // made with mips; generated once, after the last copy
    return rt;
  };
  const atlasA = atlas(size * V, size * R), atlasN = atlas(ns * V, ns * R);
  const rtA = new RenderTarget(size, size), rtN = new RenderTarget(ns, ns);

  // the bake materials: per plant material, its colour (sRGB-encoded so dark greens keep their steps in 8 bits) and its normal
  const bakeMats = new Map<PlantMaterial, [MeshBasicNodeMaterial, MeshBasicNodeMaterial]>();
  const matsFor = (src: PlantMaterial) => {
    let m = bakeMats.get(src);
    if (!m) {
      const make = (color: Node<'vec4'>) => {
        const b = new MeshBasicNodeMaterial({ side: src.side });
        b.positionNode = positionGeometry;
        b.colorNode = color;
        if (src.cutNode) b.maskNode = src.cutNode;
        b.fog = false;
        return b;
      };
      m = [make(vec4(pow(max(src.plantColorNode!, 0), vec3(1 / 2.2)), 1)), make(vec4(normalGeometry.normalize().mul(0.5).add(0.5), 1))];
      bakeMats.set(src, m);
    }
    return m;
  };

  const scene = new Scene(), cam = new OrthographicCamera();
  const rows: { meshes: Mesh[]; mats: [MeshBasicNodeMaterial, MeshBasicNodeMaterial][]; frame: ViewFrame }[] = [];
  for (const kind of TREE_KINDS) for (const variant of BAKED) {
    const model = models[PLANT_KINDS.indexOf(kind) * VARIANTS + variant];
    const parts = bakeGeometries(model, variant < 2 ? 0.3 : 0.8);
    const mats = parts.map((p) => matsFor(materials.get(kind, p.material)!));
    const meshes = parts.map((p, i) => new Mesh(p.g, mats[i][0]));
    rows.push({ meshes, mats, frame: viewFrame(model.lods[0].positions) });
  }

  const clear = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha(), target = renderer.getRenderTarget();
  renderer.setClearColor(0x000000, 0);
  try {
    // compile every bake pipeline at once (in parallel), for the targets' formats
    for (const [p, rt] of [[0, rtA], [1, rtN]] as const) {
      const all = rows.flatMap((r) => r.meshes.map((m, i) => { const c = m.clone(); c.material = r.mats[i][p]; return c; }));
      scene.add(...all);
      renderer.setRenderTarget(rt);
      await renderer.compileAsync(scene, cam);
      scene.remove(...all);
    }
    const ce = Math.cos(BAKE_ELEVATION), se = Math.sin(BAKE_ELEVATION);
    const at = new Vector2();
    rows.forEach((row, r) => {
      const { halfWidth: w, bottom, top } = row.frame, far = 4 * (w + top);
      cam.left = -w; cam.right = w; cam.bottom = bottom * ce; cam.top = top * ce; // the frame's heights back in the tilted view
      cam.near = 0.1; cam.far = 2 * far;
      cam.updateProjectionMatrix();
      scene.add(...row.meshes);
      for (let v = 0; v < V; v++) {
        const th = (v * 2 * Math.PI) / V;
        cam.position.set(Math.sin(th) * ce * far, se * far, Math.cos(th) * ce * far);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        for (const [p, rt, dst, s] of [[0, rtA, atlasA, size], [1, rtN, atlasN, ns]] as const) {
          row.meshes.forEach((m, i) => (m.material = row.mats[i][p]));
          renderer.setRenderTarget(rt);
          renderer.render(scene, cam);
          dst.texture.generateMipmaps = r === R - 1 && v === V - 1; // the last copy makes the mips
          renderer.copyTextureToTexture(rt.texture, dst.texture, null, at.set(v * s, r * s));
        }
      }
      scene.remove(...row.meshes);
    });
  } catch (e) {
    atlasA.dispose();
    atlasN.dispose();
    throw e;
  } finally {
    renderer.setRenderTarget(target);
    renderer.setClearColor(clear, alpha);
    for (const row of rows) for (const m of row.meshes) m.geometry.dispose();
    for (const [a, n] of bakeMats.values()) { a.dispose(); n.dispose(); }
    rtA.dispose();
    rtN.dispose();
  }
  // the last copy made the mips (three r186's copyTextureToTexture honours `generateMipmaps`); without them the far forest shimmers
  if (import.meta.env.DEV) {
    const backend = renderer.backend as unknown as { get(t: Texture): { texture?: { mipLevelCount?: number } }; copyTextureToTexture?: unknown };
    const levels = backend.get(atlasA.texture).texture?.mipLevelCount; // WebGPU only
    const makesMips = String(backend.copyTextureToTexture).includes('generateMipmaps');
    if (levels !== undefined) probe(levels > 1 && makesMips, `the impostor atlas has ${levels} mip level(s) and the copy ${makesMips ? 'does' : 'does not'} make mips, so the far forest may shimmer (impostor.ts)`);
  }
  const bytes = Math.round((size * V * size * R + ns * V * ns * R) * 4 * (4 / 3));
  return {
    albedo: atlasA.texture, normal: atlasN.texture, frames: rows.map((r) => r.frame), size, ms: performance.now() - t0, bytes,
    dispose() { atlasA.dispose(); atlasN.dispose(); },
  };
}

/**
 * How much of the key light reaches a far crown, on average. A mid tree shades itself and its neighbours in the shadow
 * cascades (crowns are dark inside and on their far side); a flat impostor cannot, so in sunlight it came out brighter than
 * the mid tree it replaces. Drawn over the same trees, the best match is 0.7–0.8 at noon and 0.6 in the low sun of 17:30;
 * 0.65 keeps both within about 3%. Applied to the direct light everywhere (not through the shadow, which stops at the
 * last cascade), so near and far impostors agree.
 */
const CROWN_SHADE = 0.65;

/** Standard lighting with the direct (key) light scaled by `shade`. */
class CrownLightingModel extends PhysicalLightingModel {
  constructor(private readonly shade: Node<'float'>) { super(); }
  direct(input: Parameters<PhysicalLightingModel['direct']>[0], builder: NodeBuilder) {
    // three r186 passes the light's colour as `input.lightColor`; without it, light the crowns unshaded rather than fail
    if (!probe(!!input?.lightColor, "PhysicalLightingModel.direct's input has no lightColor, so far crowns are lit unshaded (impostor.ts)")) return super.direct(input, builder);
    super.direct({ ...input, lightColor: (input.lightColor as Node<'vec3'>).mul(this.shade) }, builder);
  }
}

/**
 * The impostors' material: the plant colour path's `setupDiffuseColor` trick, so the shadow pass samples only the mask,
 * and the crown's own shade on the key light (`CROWN_SHADE`).
 */
class ImpostorMaterial extends MeshStandardNodeMaterial {
  impostorColorNode: Node<'vec3'> | null = null;
  readonly crownShade = uniform(CROWN_SHADE) as Node<'float'> & { value: number };
  setupLightingModel() {
    return new CrownLightingModel(this.crownShade);
  }
  setupDiffuseColor(builder: NodeBuilder) {
    super.setupDiffuseColor(builder);
    if (this.impostorColorNode) diffuseColor.rgb.assign(this.impostorColorNode);
  }
}

export type ImpostorLayer = { object: Group; mesh: Mesh; count: number; dispose(): void };

/**
 * One instanced quad per tree of the valley (`packImpostors`, thinned by `q.treeDensity`), showing `bake`'s views, in one
 * draw. `castShadow` (High only) puts them in the far cascades (main.ts picks the cascades by `IMPOSTOR_LAYER`). Reads the
 * plant materials' cross-fade (`materials.fade.eye` must follow the camera) and key light (for the leaves' glow).
 */
export function createImpostorLayer(data: ValleyData, bake: ImpostorBake, q: WorldQuality, materials: PlantMaterials, castShadow: boolean): ImpostorLayer {
  const heights = data.plantModels.map((m) => m.height);
  const { data: inst, count } = packImpostors(data.tiles, PLANT_KINDS.map((k) => (TREE_KINDS.includes(k) ? q.treeDensity : 0)), heights);

  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  geo.setIndex([0, 1, 3, 0, 3, 2]);
  const buf = new InstancedInterleavedBuffer(inst, GPU_STRIDE, 1);
  [0, 1, 2].forEach((i) => geo.setAttribute(`i${i}`, new InterleavedBufferAttribute(buf, 4, i * 4)));
  geo.instanceCount = count;

  const V = IMPOSTOR_VIEWS, R = IMPOSTOR_ROWS, fade = materials.fade;
  const frames = uniformArray(bake.frames.map((f) => new Vector4(f.halfWidth, f.bottom, f.top, 0)), 'vec4');

  // ---------- vertex: fold away, face the camera, pick the views ----------
  const base = i0.xyz, yaw = i0.w, scale = i1.x;
  const frame = frames.element(int(i2.w.add(0.5))) as unknown as Node<'vec4'>;
  // towards the camera: from the tree to its position, or (the shadow cascades are orthographic) back along its view
  type Columns = { element(i: number): Node<'vec4'> };
  const ortho = (cameraProjectionMatrix as unknown as Columns).element(3).w;
  const toCam = mix(cameraPosition.sub(base), (cameraWorldMatrix as unknown as Columns).element(2).xyz, ortho);
  const dir = toCam.xz.div(max(toCam.xz.length(), 1e-4)).toVar();
  const turn = atan(dir.x, dir.y).sub(yaw).div(2 * Math.PI);
  const f = fract(turn).mul(V).toVar();
  const a = floor(f), b = a.add(1).mod(V), t = f.sub(a);
  const right = vec3(dir.y, 0, dir.x.negate());
  const qx = uv().x.sub(0.5).mul(frame.x).mul(2).mul(scale), qy = mix(frame.y, frame.z, uv().y).mul(scale);
  const placed = base.add(right.mul(qx)).add(vec3(i1.y.mul(qy), qy, i1.z.mul(qy)));
  const dist = base.sub(fade.eye).length();
  const shown = dist.greaterThanEqual(fade.start).and(dist.lessThanEqual(q.viewDistance));

  const mat = new ImpostorMaterial({ metalness: 0, side: DoubleSide });
  mat.name = 'impostor';
  mat.positionNode = select(shown, placed, base);
  const views = varying(vec4(a, b, t, farFadeNode(fade, base)), 'vImpViews');
  const inst2 = varying(vec4(i2.w, i1.w, i2.y, yaw), 'vImpInst');

  // ---------- fragment: the two views, cut, dithered in, lit by the baked normal ----------
  const cell = vec2(uv().x, float(1).sub(uv().y)); // render-target rows run top down
  const at = (view: Node<'float'>) => vec2(view.add(cell.x).div(V), inst2.x.add(cell.y).div(R));
  const uvA = at(views.x), uvB = at(views.y);
  const colour = mix(texture(bake.albedo, uvA), texture(bake.albedo, uvB), views.z).toVar();
  mat.maskNode = colour.a.greaterThan(CUT).and(bayer4Node(screenCoordinate.xy).lessThan(views.w));
  const albedo = pow(colour.rgb.div(max(colour.a, 1e-3)), vec3(2.2));
  const c = tinted(albedo, inst2.y, inst2.z).toVar();
  mat.impostorColorNode = c;
  const nTex = mix(texture(bake.normal, uvA), texture(bake.normal, uvB), views.z);
  const n = nTex.rgb.div(max(nTex.a, 1e-3)).mul(2).sub(1).normalize();
  const cy = inst2.w.cos(), sy = inst2.w.sin();
  const nWorld = vec3(n.x.mul(cy).add(n.z.mul(sy)), n.y, n.z.mul(cy).sub(n.x.mul(sy)));
  mat.normalNode = (cameraViewMatrix as unknown as Node<'mat4'>).mul(vec4(nWorld, 0)).xyz.normalize();
  mat.roughnessNode = float(0.85);
  // the leaves' glow when the key light shines through them (as the plant leaves'; the bark in a far crown is a speck)
  const viewDir = positionWorld.sub(cameraPosition).normalize();
  mat.emissiveNode = c.mul(materials.light.key).mul(max(dot(viewDir, materials.light.keyDir), 0).mul(0.3));

  const mesh = new Mesh(geo, mat);
  mesh.name = 'impostors';
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1; // after the land and the near trees, so their depth hides what is behind them
  mesh.layers.set(IMPOSTOR_LAYER);
  const object = new Group();
  object.name = 'impostors';
  object.add(mesh);
  return {
    object, mesh, count,
    dispose() { object.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
