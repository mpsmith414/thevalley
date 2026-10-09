import { LinearSRGBColorSpace, Mesh, NodeMaterial, type Camera, type RenderTarget, Shape, ShapeGeometry, Vector2, type LightShadow, type Node, type Scene, type Texture } from 'three/webgpu';
import { cameraPosition, float, positionWorld, reflector, screenSize, smoothstep, vec2 } from 'three/tsl';
import { probe } from '../render/probe';
import type { Tier } from '../render/quality';
import { offsetPolygon } from '../valley/geom';
import { VALLEY } from '../valley/layout';
import type { Lake, ValleyData } from '../valley/types';
import type { LightState } from './lighting';
import type { WindState } from '../plants/wind';
import { WORLD_QUALITY } from './quality';
import type { ValleyTextures } from './textures';
import { rippleNormal, setWater, shadeWater, skyReflection, waterUniforms } from './water';

/** How far past the shore line the lake's surface reaches (under the land, where it is hidden), in metres. */
const SKIRT = 30;

type Updater = { updateBefore(frame: { camera: Camera; renderer?: unknown }): unknown; getVirtualCamera(camera: Camera): Camera; getRenderTarget(camera: Camera): RenderTarget };
/**
 * Tag the mirror's targets as linear like the main view's (three leaves them with no colour space; the pixels are the same
 * either way). three keys pipelines by the target's colour space, so untagged, every material the mirror draws compiled a
 * second, identical pipeline: 16 more on D3D12, a second or more of startup when compiled side by side (see `compileTogether`).
 */
function shareMirrorPipelines(mirror: Updater) {
  const get = mirror.getRenderTarget.bind(mirror);
  mirror.getRenderTarget = (camera) => {
    const rt = get(camera);
    rt.texture.colorSpace = LinearSRGBColorSpace;
    return rt;
  };
}
/**
 * The mirror renders the scene again from below the water, and three would re-render every shadow map for that camera
 * (doubling the shadow passes). Hold the shadow maps during the mirror's render: it uses the main view's.
 */
function keepShadows(mirror: Updater, scene: Scene) {
  const render = mirror.updateBefore.bind(mirror);
  let frames = 0;
  mirror.updateBefore = (frame) => {
    const held: LightShadow[] = [];
    let cascaded = false, standIns = 0;
    for (const o of scene.children) { // the key light, and the cascades' stand-in lights (plain Object3Ds with a shadow)
      const shadow = (o as { shadow?: LightShadow & { shadowNode?: unknown } }).shadow;
      if (!shadow) continue;
      if ((o as { isLight?: boolean }).isLight) cascaded ||= !!shadow.shadowNode; // a custom shadow node: the CSM cascades
      else standIns++;
      if (shadow.autoUpdate) { shadow.autoUpdate = false; held.push(shadow); } // (at night the sky holds them all already)
    }
    // the cascades add their stand-ins to the scene on the first render, so look from the second frame on
    if (++frames > 2) probe(!cascaded || standIns > 0, "the lake's mirror found no shadow-cascade lights in scene.children, so it re-renders every shadow map (lake.ts keepShadows)");
    try { return render(frame); } finally { for (const shadow of held) shadow.autoUpdate = true; }
  };
}

/**
 * The lake: a flat sheet over the shore outline grown by `SKIRT` m, coloured and made see-through by its depth over the
 * full-resolution ground, rippled by the wind, mirroring the hills (High: a planar reflection at half resolution) or the
 * sky (other tiers: the environment map), with a foam line where it meets the land.
 * `update(t, light, wind)`: the time in seconds, the light of the moment and the wind. `mirrorLayers(f)`: the layers the
 * mirror draws for a camera (High tier only), so costly layers (the plants) can be left out when the lake is far away.
 */
export function createLake(d: ValleyData, tex: ValleyTextures, tier: Tier, scene: Scene, lake: Lake = VALLEY.lake):
  { object: Mesh; update(t: number, light: LightState, wind?: WindState): void; mirrorLayers(layers: (camera: Camera) => number): void } {
  void d; // the ground under the lake is read from `tex`
  const level = lake.level;
  const shape = new Shape(offsetPolygon(lake.outline, SKIRT).map((p) => new Vector2(p.x, -p.z)));
  const geo = new ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, −z) in the shape's plane → (x, 0, z), facing up

  const u = waterUniforms();
  const xz = positionWorld.xz;
  const depth = float(level).sub(tex.heightAtNode(xz));
  const drift = xz.sub(u.drift); // the ripples drift downwind
  const N = rippleNormal(drift, u.time, u.rough);

  const mat = new NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  const env = scene.environment as Texture;
  let reflection: (R: Node<'vec3'>, lit: Node<'vec3'>) => Node<'vec3'> = (R, lit) => skyReflection(env, R, lit, 0.05);
  const mesh = new Mesh(geo, mat);
  let layers: ((camera: Camera) => number) | null = null;
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
    const base = mirror.reflector as unknown as Updater;
    keepShadows(base, scene);
    shareMirrorPipelines(base);
    const render = base.updateBefore.bind(base);
    base.updateBefore = (frame) => {
      // Not while three precompiles (`compileAsync`, r186's flag): the mirror's render there would make the pipelines of
      // everything it shows one at a time, blocking, instead of in the background with the rest. `false` tells three the
      // update did not happen, so the frame's real render still draws the mirror (it updates once per frame).
      if (frame.renderer) probe('_isPreCompiling' in (frame.renderer as object), "renderer._isPreCompiling is gone, so the lake's mirror renders (and compiles one pipeline at a time) during compileAsync (lake.ts)");
      if ((frame.renderer as { _isPreCompiling?: boolean } | undefined)?._isPreCompiling) return false;
      if (layers) base.getVirtualCamera(frame.camera).layers.mask = layers(frame.camera);
      return render(frame);
    };
    reflection = () => mirror.rgb as Node<'vec3'>;
  }
  mat.colorNode = shadeWater(u, depth, N, reflection);

  mesh.name = 'lake';
  mesh.position.y = level;
  mesh.renderOrder = 1; // after the ground (opaque) and before the river where it runs in
  return { object: mesh, update: (t, light, wind) => setWater(u, t, light, wind), mirrorLayers: (f) => (layers = f) };
}
