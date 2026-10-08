import { Mesh, NodeMaterial, Shape, ShapeGeometry, Vector2, type LightShadow, type Node, type Scene, type Texture } from 'three/webgpu';
import { cameraPosition, float, positionWorld, reflector, screenSize, smoothstep, vec2 } from 'three/tsl';
import type { Tier } from '../render/quality';
import { offsetPolygon } from '../valley/geom';
import { VALLEY } from '../valley/layout';
import type { Lake, ValleyData } from '../valley/types';
import type { LightState } from './lighting';
import { WORLD_QUALITY } from './quality';
import type { ValleyTextures } from './textures';
import { RIPPLE_SPEED, WIND, rippleNormal, setWater, shadeWater, skyReflection, waterUniforms } from './water';

/** How far past the shore line the lake's surface reaches (under the land, where it is hidden), in metres. */
const SKIRT = 30;

type Updater = { updateBefore(frame: unknown): unknown };
/**
 * The mirror renders the scene again from below the water, and three would re-render every shadow map for that camera
 * (doubling the shadow passes). Hold the shadow maps during the mirror's render: it uses the main view's.
 */
function keepShadows(mirror: Updater, scene: Scene) {
  const render = mirror.updateBefore.bind(mirror);
  mirror.updateBefore = (frame) => {
    const held: LightShadow[] = [];
    for (const o of scene.children) { // the key light, and the cascades' stand-in lights (plain Object3Ds with a shadow)
      const shadow = (o as { shadow?: LightShadow }).shadow;
      if (shadow?.autoUpdate) { shadow.autoUpdate = false; held.push(shadow); }
    }
    try { return render(frame); } finally { for (const shadow of held) shadow.autoUpdate = true; }
  };
}

/**
 * The lake: a flat sheet over the shore outline grown by `SKIRT` m, coloured and made see-through by its depth over the
 * full-resolution ground, rippled by the wind, mirroring the hills (High: a planar reflection at half resolution) or the
 * sky (other tiers: the environment map), with a foam line where it meets the land.
 * `update(t, light)`: the time in seconds and the light of the moment.
 */
export function createLake(d: ValleyData, tex: ValleyTextures, tier: Tier, scene: Scene, lake: Lake = VALLEY.lake):
  { object: Mesh; update(t: number, light: LightState): void } {
  void d; // the ground under the lake is read from `tex`
  const level = lake.level;
  const shape = new Shape(offsetPolygon(lake.outline, SKIRT).map((p) => new Vector2(p.x, -p.z)));
  const geo = new ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, −z) in the shape's plane → (x, 0, z), facing up

  const u = waterUniforms();
  const xz = positionWorld.xz;
  const depth = float(level).sub(tex.heightAtNode(xz));
  const drift = xz.sub(vec2(WIND.x, WIND.y).mul(u.time.mul(RIPPLE_SPEED))); // the ripples drift downwind
  const N = rippleNormal(drift, u.time, 1);

  const mat = new NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  const env = scene.environment as Texture;
  let reflection: (R: Node<'vec3'>, lit: Node<'vec3'>) => Node<'vec3'> = (R, lit) => skyReflection(env, R, lit, 0.05);
  const mesh = new Mesh(geo, mat);
  if (WORLD_QUALITY[tier].reflections === 'planar') {
    const mirror = reflector({ resolutionScale: 0.5, bounces: false, samples: 4 });
    // Above the waterline the mirror holds its view from under the land: the sky, as the land's underside is culled. A
    // sample that strays there draws a broken bright seam along the shore, so the ripples' distortion fades out at the
    // shore and far off (where it spans pixels), and every sample is taken 3 px lower (1.5 texels at half resolution:
    // the screen's y runs down), clear of the seam the half-resolution texels blur across.
    const nudge = smoothstep(0.05, 1.2, depth).mul(float(1).sub(smoothstep(100, 400, positionWorld.sub(cameraPosition).length())));
    mirror.uvNode = (mirror.uvNode as Node<'vec2'>).add(N.xz.mul(0.03).mul(nudge)).add(vec2(0, float(3).div(screenSize.y)));
    mirror.target.rotation.x = -Math.PI / 2; // the reflector's plane faces its target's +z: turn it to face up
    mesh.add(mirror.target);
    keepShadows(mirror.reflector as unknown as Updater, scene);
    reflection = () => mirror.rgb as Node<'vec3'>;
  }
  mat.colorNode = shadeWater(u, depth, N, reflection);

  mesh.name = 'lake';
  mesh.position.y = level;
  mesh.renderOrder = 1; // after the ground (opaque) and before the river where it runs in
  return { object: mesh, update: (t, light) => setWater(u, t, light) };
}
