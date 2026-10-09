/**
 * The plants' materials: bark (photo sets for pine and spruce, painted birch), alpha-tested translucent leaf cards, and
 * granite boulders with moss on top. Every plant is drawn instanced: the vertex shader places each instance from three
 * packed per-instance vec4s (`i0` x, y, z, yaw · `i1` scale, leanX, leanZ, tint · `i2` age, health, phase, model height)
 * and sways it in the shared wind. Kinds share materials (one for all leaves, one for living bark, one each for birch bark,
 * dead wood and rock): per-kind values sit in uniform arrays indexed by the kind, which the geometry carries in `info.z`
 * (`withKind`). Each distinct material costs a node build and a GPU pipeline per pass at load: seconds, with 20 of them.
 */
import {
  Color, DataArrayTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardNodeMaterial, RGBAFormat, SRGBColorSpace,
  UnsignedByteType, Vector4, Vector3, type Node, type NodeBuilder,
} from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, clamp, cos, cross, diffuseColor, dot, float, fract, int, log2, max, mix, mx_noise_float, normalLocal,
  normalMap, normalViewGeometry, normalWorld, positionGeometry, positionWorld, pow, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
  dFdx, dFdy, abs, uniformArray, screenCoordinate, select, varying,
} from 'three/tsl';
import type { Tier } from '../render/quality';
import type { LightState } from '../world/lighting';
import { loadPhotoSets, type GroundSets, type PhotoSets } from '../world/ground';
import { WORLD_QUALITY } from '../world/quality';
import { cardTextures, paintCard } from './cards';
import { bayer4Node, farFadeNode, treeFade, type TreeFade } from './fade';
import { PLANT_KINDS, SPECIES, TREE_KINDS, type LeafSpec, type PlantKind } from './species';
import { windNodes, type WindUniforms } from './wind';

export type LeafCard = LeafSpec['card'];
export const LEAF_CARDS: readonly LeafCard[] = ['pine', 'spruce', 'birch', 'alder', 'willow', 'juniper', 'blueberry', 'fern'];
/** Every leaf card's colour (sRGB, alpha for the cut-out), one layer per card in `LEAF_CARDS` order. */
export type CardSet = { color: DataArrayTexture; size: number };
export const BARK_SETS = ['pine', 'spruce', 'birch'] as const;
export type BarkName = (typeof BARK_SETS)[number];
export type BarkSets = PhotoSets<BarkName>;

/** Leaf cards are cut out where their alpha is below this. */
export const ALPHA_TEST = 0.45;
/** Bark textures are 1k on every tier: a trunk never fills enough of the screen to need more. */
const BARK_SIZE = 1024;

/** Paint (or fetch) every leaf card at `size` px, into one array texture. */
export async function loadCards(size: number): Promise<CardSet> {
  const px = size * size * 4, data = new Uint8Array(px * LEAF_CARDS.length);
  for (const [i, c] of LEAF_CARDS.entries()) {
    const { color, height } = await cardTextures(c, size);
    data.set((color.image as { data: Uint8Array }).data, i * px);
    color.dispose(); height.dispose();
  }
  const t = new DataArrayTexture(data, size, size, LEAF_CARDS.length);
  t.format = RGBAFormat; t.type = UnsignedByteType; t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return { color: t, size };
}

/**
 * A copy of a model's `info` with each vertex's z (isLeaf, which the materials know anyway) replaced by the kind's index in
 * PLANT_KINDS: the shared materials look their per-kind values up by it.
 */
export function withKind(info: Float32Array, kind: PlantKind): Float32Array {
  const out = info.slice(), k = PLANT_KINDS.indexOf(kind);
  for (let i = 2; i < out.length; i += 4) out[i] = k;
  return out;
}
/** The vertex's kind (index into PLANT_KINDS), from `info.z`. */
const kindIndex = int(attribute('info', 'vec4').z.add(0.5));
/** Trees are the first kinds in PLANT_KINDS, so "is a tree" is `kindIndex < TREES` (no table needed). */
const TREES = TREE_KINDS.length;
if (TREE_KINDS.some((k) => PLANT_KINDS.indexOf(k) >= TREES)) throw new Error('the tree kinds must come first in PLANT_KINDS');
/** A per-kind value table (indexed by `kindIndex`). */
const perKind = (f: (k: PlantKind) => number) => uniformArray(PLANT_KINDS.map(f), 'float').element(kindIndex) as unknown as Node<'float'>;
const perKind3 = (f: (k: PlantKind) => [number, number, number]) =>
  (uniformArray(PLANT_KINDS.map((k) => new Vector4(...f(k), 0)), 'vec4').element(kindIndex) as unknown as Node<'vec4'>).xyz;

/**
 * The bark sets: the pine and spruce photo sets (spruce also stands in for the generic bark) and birch, painted in code,
 * with a normal map made from its height. Layers in `BARK_SETS` order.
 */
export function loadBarkSets(base = `${import.meta.env.BASE_URL}assets/textures/bark`): Promise<BarkSets> {
  return loadPhotoSets(['pine', 'spruce'] as BarkName[], base, BARK_SIZE, { pine: [92, 70, 52], spruce: [84, 70, 58], birch: [229, 225, 214] }, [{
    name: 'birch',
    fill(albedo, normal) {
      const n = BARK_SIZE, { color, height } = paintCard('birchBark', n), c = color.data, h = height.data;
      for (let p = 0; p < c.length; p += 4) { albedo[p] = c[p]; albedo[p + 1] = c[p + 1]; albedo[p + 2] = c[p + 2]; albedo[p + 3] = 200; }
      // normal from the height map's slopes (tiling, so wrap at the edges)
      const at = (x: number, y: number) => h[((((y + n) % n) * n + ((x + n) % n)) * 4)] / 255;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 3, dy = (at(x, y - 1) - at(x, y + 1)) * 3, l = Math.hypot(dx, dy, 1), o = (y * n + x) * 4;
        normal[o] = 128 - (127 * dx) / l; normal[o + 1] = 128 - (127 * dy) / l; normal[o + 2] = (255 * 1) / l; normal[o + 3] = 255;
      }
    },
  }]);
}

/** The light the leaves glow with when the key light shines through them. */
export type PlantLight = { key: Node<'color'> & { value: Color }; keyDir: Node<'vec3'> & { value: Vector3 } };

export function setPlantLight(l: PlantLight, s: LightState): void {
  l.key.value.set(s.keyColor).multiplyScalar(s.keyIntensity);
  l.keyDir.value.set(s.keyDir.x, s.keyDir.y, s.keyDir.z);
}

// ---------- per-instance placement ----------

const i0 = attribute('i0', 'vec4') as Node<'vec4'>, i1 = attribute('i1', 'vec4') as Node<'vec4'>, i2 = attribute('i2', 'vec4') as Node<'vec4'>;
const info = attribute('info', 'vec4') as Node<'vec4'>;
/** Instance tint (−1..1), age, health and phase: the "instInfo" of the brief, read from the packed attributes. */
export const instInfo = vec4(i1.w, i2.x, i2.y, i2.z);

/** Turn `v` about +y by the instance's yaw (models' +x ends up along (cos yaw, 0, −sin yaw), as scatter lays logs). */
const yawed = (v: Node<'vec3'>) => {
  const c = cos(i0.w), s = sin(i0.w);
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};

/** World position of the vertex: scaled, turned, leant (a shear by height) and moved to the instance, plus `sway`. */
function placed(sway: ((base: Node<'vec3'>) => Node<'vec3'>) | null): Node<'vec3'> {
  return Fn(() => {
    const q = yawed(positionGeometry.mul(i1.x));
    const p = vec3(q.x.add(i1.y.mul(q.y)), q.y, q.z.add(i1.z.mul(q.y))).add(i0.xyz);
    return sway ? p.add(sway(i0.xyz)) : p;
  })() as Node<'vec3'>;
}

/**
 * A plant material: placement in `positionNode` (so the shadow pass, which copies it, places the instances too), the
 * normal turned with the instance in the main pass, and the colour from `plantColorNode` instead of `colorNode`: the shadow
 * pass reads `colorNode.a` for alpha, so the bark's and rocks' shading stays out of every shadow cascade.
 * `cutNode` is the leaves' alpha cut alone (`maskNode` adds the trees' far cross-fade): what an impostor bake draws with.
 */
export class PlantMaterial extends MeshStandardNodeMaterial {
  plantColorNode: Node<'vec3'> | null = null;
  cutNode: Node<'bool'> | null = null;
  setupPosition(builder: NodeBuilder) {
    normalLocal.assign(yawed(normalLocal));
    return super.setupPosition(builder);
  }
  setupDiffuseColor(builder: NodeBuilder) {
    super.setupDiffuseColor(builder);
    if (this.plantColorNode) diffuseColor.rgb.assign(this.plantColorNode);
  }
}

/** How much each kind bends as a whole (the brief's windWeightTrunk): stiff conifers, supple birch and willow. */
const TRUNK: Partial<Record<PlantKind, number>> = { pine: 0.8, spruce: 0.7, birch: 1.2, alder: 1, willow: 1.15, juniper: 0.5, blueberry: 1, fern: 1 };
/** Bark per kind: layer, colour gain and how grey it is (0 = as photographed). */
const BARK: Record<PlantKind, { set: BarkName; gain: [number, number, number]; grey: number }> = {
  pine: { set: 'pine', gain: [0.9, 0.85, 0.8], grey: 0.15 },
  spruce: { set: 'spruce', gain: [0.9, 0.85, 0.82], grey: 0.1 },
  birch: { set: 'birch', gain: [0.85, 0.84, 0.8], grey: 0 },
  alder: { set: 'spruce', gain: [0.8, 0.8, 0.78], grey: 0.6 },
  willow: { set: 'spruce', gain: [0.9, 0.84, 0.74], grey: 0.35 },
  juniper: { set: 'pine', gain: [0.75, 0.6, 0.5], grey: 0.2 },
  blueberry: { set: 'spruce', gain: [0.55, 0.85, 0.4], grey: 0.7 },
  fern: { set: 'spruce', gain: [0.5, 0.8, 0.35], grey: 0.7 },
  boulder: { set: 'spruce', gain: [1, 1, 1], grey: 0 },
  log: { set: 'pine', gain: [0.75, 0.72, 0.68], grey: 0.45 },
  stump: { set: 'pine', gain: [0.8, 0.76, 0.7], grey: 0.35 },
};
/** Leaf colour gain per card (the painted cards are already coloured; this settles them into the valley's light). */
const LEAF_GAIN: Record<LeafCard, [number, number, number]> = {
  pine: [1.05, 1, 0.5], spruce: [0.95, 0.95, 0.52], birch: [1.05, 1, 0.62], alder: [0.95, 1, 0.58], willow: [1.05, 1, 0.62],
  juniper: [0.95, 0.95, 0.58], blueberry: [1, 1, 0.62], fern: [1.05, 1, 0.58],
};

/** A colour times `gain`, then pulled towards grey by `grey`. Uniforms where a value differs by kind, so kinds share one shader. */
const grade = (c: Node<'vec3'>, gain: [number, number, number] | Node<'vec3'>, grey: number | Node<'float'>) => {
  const g = c.mul(Array.isArray(gain) ? vec3(...gain) : gain);
  return mix(g, vec3(g.dot(vec3(0.2126, 0.7152, 0.0722))), grey);
};
/** Rotate a colour's hue by `a` radians (about the grey axis). */
const hueShift = (c: Node<'vec3'>, a: Node<'float'>) => {
  const k = vec3(0.57735), ca = cos(a);
  return c.mul(ca).add(cross(k, c).mul(sin(a))).add(k.mul(dot(k, c)).mul(float(1).sub(ca)));
};

/**
 * A leaf colour's per-instance tint (`tint` −1..1): ±8% of the hue circle and ±10% value (an independent roll from the same
 * tint), browning as `health` falls. Linear in the colour, so an impostor can apply it to a baked (averaged) colour too.
 */
export const tinted = (c: Node<'vec3'>, tint: Node<'float'>, health: Node<'float'>): Node<'vec3'> => {
  const value = fract(tint.mul(91.7).add(0.5)).mul(2).sub(1);
  const t = hueShift(c, tint.mul(0.08 * 2 * Math.PI)).mul(value.mul(0.1).add(1));
  return mix(vec3(t.dot(vec3(0.3, 0.59, 0.11))).mul(vec3(1.1, 0.85, 0.55)), t, clamp(health, 0, 1));
};

export type PlantMaterials = {
  /** The material for `kind`'s bark, leaf or rock group (null if the kind has none). */
  get(kind: PlantKind, group: 'bark' | 'leaf' | 'rock'): PlantMaterial | null;
  light: PlantLight;
  /** The trees' mid/far cross-fade (`fade.ts`): set `fade.eye` to the camera's position every frame. */
  fade: TreeFade;
  /** Every material, for compiling up front. */
  all: MeshStandardNodeMaterial[];
};

const LIVING_BARK: PlantKind[] = ['pine', 'spruce', 'alder', 'willow', 'juniper', 'blueberry'];

/**
 * The plant materials. **The kind must be in `info.z`** of the geometry's `info` attribute (an index into PLANT_KINDS): every
 * per-kind value (card layer, bark layer, gains, greyness, flutter, trunk stiffness) is looked up by it from a uniform array,
 * which is how the kinds share five materials. `withKind` (here; `tiles.ts` applies it when it builds a model's geometry) writes
 * it; anything else that draws plants with these materials (an impostor baker, say) must write it too, or every plant is
 * drawn as the first kind. Each material binds at most 3 per-kind `uniformArray`s in a stage (6 uniform buffers in all, with
 * the object, render and cascade ones; the limit is 12), so they are left unpacked.
 * Leaves: alpha test 0.45 (with the alpha boosted down the mip chain so far cards keep their cover),
 * double sided, tinted per instance (±8% hue, ±10% value), and glowing `key·0.35·max(dot(−viewDir, keyDir), 0)` when the
 * light shines through them. Bark: the photo sets with their normal maps; birch's twigs dark and its base fissured; dead
 * wood mossy on top. Rocks: the ground's granite, mossy where they face up. Everything but rocks and dead wood sways.
 */
export function createPlantMaterials(cards: CardSet, barks: BarkSets, wind: WindUniforms, tier: Tier, ground: GroundSets): PlantMaterials {
  const { sway } = windNodes(wind);
  // the far cross-fade: a tree's share for its impostor (0 for shrubs and props, which have none)
  const fade = treeFade(WORLD_QUALITY[tier]);
  const farShare = select(kindIndex.lessThan(TREES), farFadeNode(fade, i0.xyz), float(0));
  const light: PlantLight = {
    key: uniform(new Color()) as PlantLight['key'],
    keyDir: uniform(new Vector3(0, 1, 0)) as PlantLight['keyDir'],
  };
  const ao = info.w;
  const all: PlantMaterial[] = [];
  const leafOf = (k: PlantKind) => { const s = SPECIES[k].spec; return 'leaf' in s ? s.leaf : null; };
  const swaying = (base: Node<'vec3'>) => sway(info, base, perKind((k) => leafOf(k)?.flutter ?? 0), i2.w, positionGeometry.y, i1.x, i2.z,
    perKind((k) => TRUNK[k] ?? 0)) as Node<'vec3'>;
  const make = (name: string, still = false, side?: typeof DoubleSide) => {
    const m = new PlantMaterial({ metalness: 0, ...(side ? { side } : {}) });
    m.positionNode = placed(still ? null : swaying);
    m.name = name;
    all.push(m);
    return m;
  };

  /** Bark from the photo sets, by kind (layer, gain, greyness), with its normal map. `extra` adds birch's or dead wood's touches. */
  const barkMat = (name: string, still: boolean, extra?: (c: Node<'vec3'>) => Node<'vec3'>) => {
    const m = make(name, still), t = uv();
    if (!still) {
      // a far-fading tree's bark goes whole, at a random point of the fade (a trunk is a pixel or two wide there): it folds to
      // the tree's base in the vertex shader, so the bark keeps its early depth test (no discard). The leaves dither (`leaf`).
      const at = fract(i1.w.mul(7919.31).add(0.37));
      m.positionNode = select(farShare.greaterThan(at), i0.xyz, m.positionNode!);
    }
    const layer = int(perKind((k) => BARK_SETS.indexOf(BARK[k].set)));
    const albedo = texture(barks.albedo, t).depth(layer);
    const c = grade(albedo.rgb, perKind3((k) => BARK[k].gain), perKind((k) => BARK[k].grey));
    m.plantColorNode = (extra ? extra(c) : c).mul(ao);
    m.roughnessNode = mix(0.75, 1, albedo.a);
    m.normalNode = normalMap(texture(barks.normal, t).depth(layer).rgb, vec2(tier === 'low' ? 0.5 : 1));
    return m;
  };
  const living = barkMat('bark', false);
  const birch = barkMat('bark-birch', false, (c0) => {
    // twigs are a dark red-brown, and the base of an old trunk turns black and fissured
    const c = mix(c0, vec3(0.09, 0.06, 0.05), smoothstep(1.5, 2, info.y));
    const base = float(1).sub(smoothstep(0.2, 1.6, positionGeometry.y.mul(i1.x))).mul(smoothstep(0.4, 0.8, i2.x));
    return mix(c, c.mul(vec3(0.22, 0.2, 0.19)), base.mul(smoothstep(0.35, 0.65, mx_noise_float(uv().mul(vec2(6, 2))).add(0.5))));
  });
  const dead = barkMat('bark-dead', true, (c) => {
    // moss where the dead wood faces up
    const moss = smoothstep(0.35, 0.8, normalWorld.y).mul(smoothstep(-0.2, 0.3, mx_noise_float(positionWorld.mul(1.7)))).mul(0.85);
    return mix(c, vec3(...(ground.average.moss.slice(0, 3) as [number, number, number])).mul(1.1), moss);
  });

  const leaf = (() => {
    const m = make('leaf', false, DoubleSide), t = uv();
    const tex = texture(cards.color, t).depth(int(perKind((k) => Math.max(0, LEAF_CARDS.indexOf(leafOf(k)?.card ?? 'pine')))));
    // alpha keeps its cover down the mip chain (averaged alpha would melt far cards away): boost it by the mip level
    const dx = dFdx(t).mul(cards.size), dy = dFdy(t).mul(cards.size);
    const mip = max(log2(max(dot(dx, dx), dot(dy, dy))).mul(0.5), 0);
    // The alpha test is a mask, not `alphaTest`: the shadow pass's shared material takes each caster's `alphaTest`, and
    // flipping it between zero and not (bark, ground, leaves) bumps that material's version, which made three re-key every
    // shadow caster every frame (about 7 ms of CPU). The shadow pass honours the mask just the same.
    m.cutNode = tex.a.mul(float(1).add(mip.mul(0.25))).greaterThan(ALPHA_TEST);
    // and the far cross-fade: the pixels the impostor takes (see `fade.ts`). The share is worked out per vertex and passed
    // as one interpolant: worked out per pixel, it cost the forest floor's leaves about 0.8 ms.
    m.maskNode = m.cutNode.and(bayer4Node(screenCoordinate.xy).greaterThanEqual(varying(farShare, 'vFarShare')));
    // per-instance tint and health
    const c = tinted(tex.rgb.mul(perKind3((k) => LEAF_GAIN[leafOf(k)?.card ?? 'pine'])), i1.w, i2.y);
    const col = max(c, 0).mul(ao).toVar();
    m.plantColorNode = col;
    // light shining through the leaf: towards the key light, seen from the shade side
    const viewDir = positionWorld.sub(cameraPosition).normalize(); // camera → leaf, i.e. −viewDir of the brief
    m.emissiveNode = col.mul(light.key).mul(max(dot(viewDir, light.keyDir), 0).mul(0.35));
    // crowns shade as volumes: keep the outward normals on both faces instead of flipping them on the back
    m.normalNode = normalViewGeometry;
    m.roughnessNode = float(0.8);
    return m;
  })();

  const rock = (() => {
    const m = make('rock', true);
    const granite = 2, moss = 3; // layers in GROUND_SETS order
    // world-space triplanar granite (the boulders never move), 3 m to a tile
    const p = positionWorld.div(3), n = normalWorld, w4 = pow(abs(n), vec3(4)), w = w4.div(w4.x.add(w4.y).add(w4.z));
    const g = texture(ground.albedo, p.zy).depth(int(granite)).mul(w.x)
      .add(texture(ground.albedo, p.xz).depth(int(granite)).mul(w.y))
      .add(texture(ground.albedo, p.xy).depth(int(granite)).mul(w.z));
    const stone = grade(g.rgb, [0.55, 0.55, 0.53], 0.15);
    const patch = smoothstep(-0.15, 0.25, mx_noise_float(positionWorld.mul(0.9)));
    const cover = smoothstep(0.45, 0.8, n.y).mul(patch);
    const mossC = grade(texture(ground.albedo, positionWorld.xz.div(1.5)).depth(int(moss)).rgb, [0.52, 0.56, 0.4], 0.25);
    m.plantColorNode = mix(stone, mossC, cover).mul(ao);
    m.roughnessNode = mix(mix(0.75, 1, g.a), 0.95, cover);
    return m;
  })();

  return {
    light, all, fade,
    get(kind, group) {
      const s = SPECIES[kind].spec;
      if (group === 'rock') return rock;
      if (group === 'leaf') return leafOf(kind) ? leaf : null;
      if (s.form === 'rock' || s.form === 'fern') return null;
      return kind === 'birch' ? birch : LIVING_BARK.includes(kind) ? living : dead;
    },
  };
}
