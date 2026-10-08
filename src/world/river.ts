import { BufferAttribute, BufferGeometry, Mesh, NodeMaterial, type Node, type Scene, type Texture } from 'three/webgpu';
import { abs, attribute, cameraPosition, float, fract, max, mix, mx_noise_float, positionWorld, smoothstep, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Tier } from '../render/quality';
import type { RiverSample } from '../valley/generate/carve';
import { LAKE_LEVEL, type ValleyData } from '../valley/types';
import type { LightState } from './lighting';
import type { ValleyTextures } from './textures';
import { rippleNormal, setWater, shadeWater, skyReflection, waterUniforms } from './water';

/** Vertices across the ribbon. */
export const ACROSS = 5;
/** Metres added to the ribbon's width: it reaches half of this past each bank, under the banks where it is hidden. */
const OVERLAP = 1;
/** Flow speed (m/s) for a surface slope: the same rule the generator's flow map uses. */
export const flowSpeed = (slope: number) => Math.min(2.5, Math.max(0.4, 0.4 + 6 * slope));

export type RiverMesh = {
  positions: Float32Array; uvs: Float32Array;
  /** Per vertex: slope, flow speed (m/s), width (m), 0. */
  attrs: Float32Array;
  /** Per vertex: the unit direction the water runs (x, z). */
  dirs: Float32Array;
  indices: Uint32Array;
};

/**
 * The river's surface as a ribbon: a cross-section of `ACROSS` vertices at every sample, `width + 1` m wide, 2 cm above
 * the water surface. `uv.x` runs 0–1 across, `uv.y` is the distance along the course in metres. Faces up.
 */
export function buildRiverMesh(river: RiverSample[]): RiverMesh {
  const n = river.length, v = n * ACROSS;
  const positions = new Float32Array(v * 3), uvs = new Float32Array(v * 2), attrs = new Float32Array(v * 4), dirs = new Float32Array(v * 2);
  river.forEach((r, k) => {
    const ax = -r.tz, az = r.tx, w = r.width + OVERLAP, speed = flowSpeed(r.slope); // across: the course turned 90°
    for (let j = 0; j < ACROSS; j++) {
      const i = k * ACROSS + j, f = j / (ACROSS - 1), o = (f - 0.5) * w;
      positions.set([r.x + ax * o, r.surface + 0.02, r.z + az * o], i * 3);
      uvs.set([f, r.s], i * 2);
      attrs.set([r.slope, speed, r.width, 0], i * 4);
      dirs.set([r.tx, r.tz], i * 2);
    }
  });
  const indices = new Uint32Array(Math.max(0, n - 1) * (ACROSS - 1) * 6);
  for (let k = 0, t = 0; k < n - 1; k++) for (let j = 0; j < ACROSS - 1; j++, t += 6) {
    const a = k * ACROSS + j, b = a + ACROSS;
    indices.set([a, a + 1, b, b, a + 1, b + 1], t);
  }
  return { positions, uvs, attrs, dirs, indices };
}

/** Seconds per flow-map cycle: two layers half a cycle apart scroll downstream and cross-fade, so no stretch builds up. */
const CYCLE = 3;
/** Metres over which the river fades out as it reaches the lake (whose own surface fills the channel from there). */
const MOUTH_FADE = 6;

/**
 * The river: the ribbon over the course, rippled by noise that runs downstream at the water's speed, white water where the
 * surface falls steeply (slope 0.03–0.08), coloured and made see-through by depth over the ground like the lake, and
 * mirroring the sky (the environment map). It fades out where its surface comes down to the lake's level; the lake's own
 * surface fills the channel from there.
 */
export function createRiver(d: ValleyData, tex: ValleyTextures, tier: Tier, scene: Scene):
  { object: Mesh; update(t: number, light: LightState): void } {
  void tier;
  // stop one sample past where the water comes down to the lake's level
  const mouth = d.river.findIndex((r) => r.surface <= LAKE_LEVEL + 1e-4);
  const course = mouth < 0 ? d.river : d.river.slice(0, Math.min(d.river.length, mouth + 2));
  const m = buildRiverMesh(course);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(m.positions, 3));
  geo.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  geo.setAttribute('attrs', new BufferAttribute(m.attrs, 4));
  geo.setAttribute('dir', new BufferAttribute(m.dirs, 2));
  geo.setIndex(new BufferAttribute(m.indices, 1));
  geo.computeBoundingSphere();

  const u = waterUniforms();
  const a = attribute('attrs', 'vec4') as Node<'vec4'>, dir = attribute('dir', 'vec2') as Node<'vec2'>;
  const slope = a.x, speed = a.y, width = a.z.add(OVERLAP);
  const frame = { along: dir, across: vec2(dir.y.negate(), dir.x) };
  const s = uv().y, across = uv().x.sub(0.5).mul(width);
  const depth = positionWorld.y.sub(0.02).sub(tex.heightAtNode(positionWorld.xz));

  // two flow layers, half a cycle apart, each scrolling downstream for a cycle and then starting over (elsewhere)
  const steep = smoothstep(0.03, 0.08, slope);
  const layer = (offset: number) => {
    const ph = fract(u.time.div(CYCLE).add(offset)), cycle = u.time.div(CYCLE).add(offset).sub(ph);
    const p = vec2(s.sub(ph.mul(CYCLE).mul(speed)).div(1.6), across).add(cycle.mul(vec2(13.7, 5.3))); // stretched along the flow
    const N = rippleNormal(p, u.time, float(1).add(steep.mul(2.5)), frame);
    // white water: streaks drawn out along the flow
    const foam = mx_noise_float(vec3(p.mul(vec2(0.7, 1.5)), u.time.mul(0.6))).add(mx_noise_float(p.mul(vec2(2.2, 4.2))).mul(0.5));
    return { N, foam, w: float(1).sub(abs(ph.mul(2).sub(1))) }; // weight 0 as the layer jumps back
  };
  const l0 = layer(0), l1 = layer(0.5), wsum = max(l0.w.add(l1.w), 1e-3);
  const N = l0.N.mul(l0.w).add(l1.N.mul(l1.w)).div(wsum).normalize();
  const churn = l0.foam.mul(l0.w).add(l1.foam.mul(l1.w)).div(wsum);
  // the steeper, the more of the surface is white; far off, where the streaks would shimmer, their average
  const streaks = smoothstep(mix(0.35, -0.45, steep), mix(0.75, 0.15, steep), churn);
  const white = steep.mul(mix(streaks, steep.mul(0.6), smoothstep(60, 200, positionWorld.sub(cameraPosition).length()))).mul(0.9);

  const env = scene.environment as Texture;
  const shaded = shadeWater(u, depth, N, (R, lit) => skyReflection(env, R, lit, 0.12, 0.65) /*banks close by on both sides*/, white);
  const end = course.length ? course[course.length - 1].s : 0, start = course.length ? course[0].s : 0;
  const fade = smoothstep(start, start + 4, s).mul(float(1).sub(smoothstep(end - MOUTH_FADE, end, s)));
  const mat = new NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.colorNode = vec4(shaded.rgb, shaded.a.mul(fade));

  const mesh = new Mesh(geo, mat);
  mesh.name = 'river';
  mesh.renderOrder = 2; // over the lake where it runs in
  return { object: mesh, update: (t, light) => setWater(u, t, light) };
}
