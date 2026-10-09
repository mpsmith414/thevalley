import {
  AdditiveBlending, BackSide, Color, DirectionalLight, HemisphereLight, InstancedBufferAttribute, InstancedMesh, Mesh, NodeMaterial,
  Object3D, PlaneGeometry, PMREMGenerator, Quaternion, Scene, SphereGeometry, Vector3,
  type Node, type PerspectiveCamera, type RenderTarget, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, cameraPosition, cameraProjectionMatrix, clamp, dot, exp, float, fog, instancedBufferAttribute, max, min, mix,
  modelViewMatrix, modelViewProjection, modelWorldMatrix, mx_fractal_noise_float, normalLocal, normalWorld, normalize, pmremTexture,
  positionGeometry, positionLocal, positionWorld, pow, smoothstep, texture, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { Tier } from '../render/quality';
import { mulberry32 } from '../util/rng';
import type { Vec3 } from '../util/vec';
import { LATITUDE } from './clock';
import type { LightState } from './lighting';
import { WORLD_QUALITY } from './quality';
import type { ValleyTextures } from './textures';

const STARS = 3500, STAR_R = 4000, MOON_R = 60, MOON_DIST = 3800;
/** Sidereal days per solar day: the stars come round about four minutes early each night. */
const SIDEREAL = 1.0027379;
/** Regenerate the environment map when the sun has moved this far (degrees), and no more often than every this many seconds. */
const ENV_DEG = 1.5, ENV_STALE = 0.25;
/**
 * Environment (sky light) strength by day and with every star out: the night sky dome is a deep blue, and turning it up is
 * what keeps a moonless valley readable on a TV instead of black.
 */
const ENV_DAY = 0.25, ENV_NIGHT = 1.5;
/** Seconds for the exposure to settle (time constant). */
const EXPOSURE_TAU = 1.5;
/** Metres over which the haze thins by e above 40 m (the backdrop's 300–900 m peaks must still fade into the sky). */
const HAZE_HEIGHT = 800;
/** Below this key-light intensity the shadow maps are held (not re-rendered): the light they shade is all but out. */
const SHADOW_MIN = 0.02;
/** Clip-space depth for the moon: behind everything in the valley and its mountains (≈ 6.9 km), in front of the stars (at the far plane). */
const MOON_DEPTH = 0.999998;

export type Sky = {
  light: DirectionalLight;
  hemi: HemisphereLight;
  /** `csm`: cascaded shadows; `single`: the fallback, one map following the camera. */
  shadows: 'csm' | 'single';
  /**
   * Bring the sky, lights, exposure and fog to `state`, with the sun and moon at `sun` and `moon`, `hours` into the valley's time.
   * `dt` (seconds) eases the exposure and paces the environment map; `Infinity` snaps both (after a jump in time).
   */
  update(state: LightState, sun: Vec3, moon: Vec3, camera: PerspectiveCamera, hours: number, dt: number): void;
  /**
   * Which layers each shadow cascade (nearest first) draws: `masks[i]` is a `Layers` mask. The cascades are made on the first
   * render, so the masks are applied once they exist. Without cascades, the one map draws every layer in any mask.
   */
  cascadeLayers(masks: number[]): void;
  /**
   * Run `fn` (a compile that gathers what it compiles before it returns, as `compileTogether` does) with the stars, Milky Way
   * and moon drawable: by day they are hidden, so otherwise their pipelines would compile mid-play at dusk.
   */
  withNight<T>(fn: () => T): T;
  /** Have every shadow map drawn on the next render even while the key light is out (they are held then). */
  redrawShadows(): void;
};

/** A vertex at the far plane (or `depth` in clip space), like the sky dome, so it sits behind the whole world. */
const atDepth = (depth: number, clip: Node<'vec4'> = modelViewProjection as Node<'vec4'>) =>
  Fn(() => {
    const p = clip.toVar();
    return vec4(p.x, p.y, p.w.mul(depth), p.w);
  })();

/** The day sky: Preetham scattering with light clouds, plus a deep blue that rises at night so the dark stays readable. */
function makeSkyMesh(night: Node<'color'>): SkyMesh {
  const sky = new SkyMesh();
  sky.scale.setScalar(4500);
  sky.turbidity.value = 3;
  sky.rayleigh.value = 1.2;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.8;
  sky.cloudCoverage.value = 0.3;
  sky.cloudSpeed.value = 0.00003;
  const base = sky.material.colorNode as Node<'vec4'>;
  const dir = normalize(positionWorld.sub(cameraPosition));
  const glow = mix(1.6, 0.7, smoothstep(0, 0.6, max(dir.y, 0))); // paler near the horizon, deeper overhead
  sky.material.colorNode = vec4(base.rgb.add(night.mul(glow)), 1);
  return sky;
}

/** 3500 seeded stars (instanced billboards, 1–3 px, warm and cool) and the Milky Way, all in a group turning with the sky. */
function makeStars(level: Node<'float'>, pxToMetres: Node<'float'>): Object3D {
  const rng = mulberry32(0x57a25);
  const star = new Float32Array(STARS * 4), tint = new Float32Array(STARS * 4);
  // the band's pole, in the sky's own frame (declination about 27°, so the summer Milky Way arcs high at night)
  const pole = new Vector3(0.89, 0.45 * Math.sin((LATITUDE * Math.PI) / 180), -0.45 * Math.cos((LATITUDE * Math.PI) / 180)).normalize();
  const v = new Vector3();
  const WARM = [1, 0.82, 0.62], COOL = [0.75, 0.84, 1], WHITE = [1, 1, 1];
  for (let i = 0; i < STARS; i++) {
    // two in five gather near the Milky Way
    for (let tries = 0; ; tries++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      v.set(r * Math.cos(a), z, r * Math.sin(a));
      if (i % 5 >= 2 || Math.abs(v.dot(pole)) < 0.2 || tries > 20) break;
    }
    const big = rng() ** 5; // most stars are faint
    star.set([v.x, v.y, v.z, 1 + 2 * big], i * 4);
    const t = rng(), c = t < 0.3 ? WARM : t < 0.65 ? COOL : WHITE;
    tint.set([c[0], c[1], c[2], 0.35 + 1.4 * big + 0.25 * rng()], i * 4);
  }
  const sA = instancedBufferAttribute(new InstancedBufferAttribute(star, 4), 'vec4') as Node<'vec4'>;
  const tA = instancedBufferAttribute(new InstancedBufferAttribute(tint, 4), 'vec4') as Node<'vec4'>;

  const mat = new NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  mat.fog = false;
  const quad = 2.5; // the quad holds the glow's tail around a core of `size` pixels
  const centre = modelViewMatrix.mul(vec4(sA.xyz.mul(STAR_R), 1));
  const view = centre.xyz.add(vec3(positionGeometry.xy.mul(sA.w.mul(quad).mul(pxToMetres)), 0));
  mat.vertexNode = atDepth(1, cameraProjectionMatrix.mul(vec4(view, 1)));
  const d = uv().sub(0.5).length().mul(2 * quad); // in units of the star's size
  const up = modelWorldMatrix.mul(vec4(sA.xyz, 0)).y;
  const fade = smoothstep(-0.02, 0.12, up); // thicker air near the horizon
  mat.colorNode = vec4(tA.rgb.mul(tA.a).mul(exp(d.mul(d).mul(-2.2))).mul(level).mul(fade), 1);
  const stars = new InstancedMesh(new PlaneGeometry(1, 1), mat, STARS);
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -1;

  // the Milky Way: a faint, mottled band along the great circle around `pole`
  const mw = new NodeMaterial();
  mw.side = BackSide;
  mw.transparent = true;
  mw.depthWrite = false;
  mw.blending = AdditiveBlending;
  mw.fog = false;
  mw.vertexNode = atDepth(1);
  const dir = normalize(positionLocal), across = dot(dir, vec3(pole.x, pole.y, pole.z));
  const band = exp(across.mul(across).mul(-1 / (2 * 0.13 ** 2)));
  const clouds = mx_fractal_noise_float(dir.mul(5), 5, 2, 0.55).mul(0.5).add(0.5);
  const lane = float(1).sub(smoothstep(0.3, 0.9, mx_fractal_noise_float(dir.mul(9).add(3.7), 4)).mul(exp(across.mul(across).mul(-600))));
  const wUp = modelWorldMatrix.mul(vec4(dir, 0)).y;
  const glow = band.mul(clamp(clouds, 0, 1).pow(1.6)).mul(lane).mul(smoothstep(0, 0.25, wUp));
  mw.colorNode = vec4(vec3(0.75, 0.78, 0.95).mul(glow).mul(0.05).mul(level), 1);
  const milky = new Mesh(new SphereGeometry(1, 64, 32), mw);
  milky.name = 'milky-way';
  milky.frustumCulled = false;
  milky.renderOrder = -2;

  const group = new Object3D();
  group.name = 'night-sky';
  group.add(milky, stars);
  return group;
}

/** The moon: lit only from the sun's direction (plus a little earthshine), so it shows its phase by itself. */
function makeMoon(sunDir: Node<'vec3'>): Mesh {
  const mat = new NodeMaterial();
  mat.transparent = true; // drawn after the world, adding its light to the sky
  mat.blending = AdditiveBlending;
  mat.depthWrite = true; // and hiding the stars behind it
  mat.fog = false;
  mat.vertexNode = atDepth(MOON_DEPTH);
  const maria = mx_fractal_noise_float(normalLocal.mul(2.2), 4).mul(0.5).add(0.5);
  const albedo = mix(0.55, 1, smoothstep(0.35, 0.6, maria));
  const lit = max(dot(normalWorld, sunDir), 0).add(0.03);
  mat.colorNode = vec4(vec3(1, 0.97, 0.9).mul(albedo).mul(lit), 1);
  const moon = new Mesh(new SphereGeometry(MOON_R, 48, 24), mat);
  moon.name = 'moon';
  moon.frustumCulled = false;
  moon.renderOrder = -3;
  return moon;
}

/**
 * The sky and its light: the sky dome, stars, Milky Way and moon; the key light (sun or moon) with cascaded shadows, the ambient
 * hemisphere, the environment map, the exposure, and the aerial-perspective fog with the dawn mist over the water.
 */
export function createSky(scene: Scene, renderer: WebGPURenderer, tier: Tier, tex: ValleyTextures): Sky {
  const q = WORLD_QUALITY[tier];
  const night = uniform(new Color(0, 0, 0)), starLevel = uniform(0), pxToMetres = uniform(1);
  const sunDir = uniform(new Vector3(0, 1, 0));

  const sky = makeSkyMesh(night);
  const nightSky = makeStars(starLevel, pxToMetres);
  const moon = makeMoon(sunDir);
  scene.add(sky, nightSky, moon);

  // ---------- light ----------
  const light = new DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.setScalar(q.shadowMap);
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.05;
  const cam = light.shadow.camera;
  cam.near = 1;
  cam.far = 3000;
  let csm: CSMShadowNode | null = null;
  try {
    csm = new CSMShadowNode(light, { cascades: q.cascades, maxFar: q.shadowFar, mode: 'practical', lightMargin: 200 });
    // The cascade tests are shader branches, and three declares `normalWorld` where it is first used: inside one of them. Beyond the last
    // cascade no branch runs, so the ambient light would see a zero normal and jump brighter/darker at the shadow limit. Use it up front.
    const cascaded = csm as unknown as Node<'vec4'>;
    light.shadow.shadowNode = normalWorld.x.mul(0).add(1).mul(cascaded);
  } catch (e) {
    console.warn('cascaded shadows unavailable; one shadow map instead', e);
    csm = null;
    light.shadow.mapSize.setScalar(2048);
    cam.left = cam.bottom = -80;
    cam.right = cam.top = 80;
    cam.far = 1500;
  }
  const hemi = new HemisphereLight();
  // A camera finds its lights through its layers: these light every layer, so a camera that draws only some (such as the
  // animals' shadow warm-up in main.ts) still lights them the same and shares the main view's pipelines.
  light.layers.enableAll();
  hemi.layers.enableAll();
  scene.add(light, light.target, hemi);

  // ---------- environment: the sky alone, re-rendered as the sun moves ----------
  const envScene = new Scene();
  const envSky = makeSkyMesh(night);
  envSky.showSunDisc.value = 0;
  envScene.add(envSky);
  const pmrem = new PMREMGenerator(renderer);
  const env: RenderTarget = pmrem.fromScene(envScene); // re-rendered in place as the sun moves
  const envSun = new Vector3(0, -1, 0); // the sun the environment was last rendered for
  let sinceEnv = Infinity;
  scene.environment = env.texture;
  scene.environmentIntensity = ENV_DAY;

  // ---------- fog: aerial perspective, glowing towards the key light, and dawn mist hugging the water ----------
  const fogColor = uniform(new Color()), keyColor = uniform(new Color()), keyDir = uniform(new Vector3(0, 1, 0));
  const density = uniform(0.00025), mist = uniform(0);
  const toFrag = positionWorld.sub(cameraPosition), dist = toFrag.length(), viewDir = toFrag.div(max(dist, 1e-3));
  // thinner with height: the density at the average height of the camera and the fragment, falling off above 40 m
  const thin = exp(max(positionWorld.y.add(cameraPosition.y).mul(0.5).sub(40), 0).div(-HAZE_HEIGHT));
  // squared (exp²) rather than plain exponential: the haze is bright, so even 8% of it lifted the lake 500 m away to a milky
  // blue-grey. Squared, the valley floor stays clear (near the ground: 2% at 500 m, 6% at 1 km) while the
  // backdrop 3–6 km out still fades (up to 43–90%, less up its high slopes).
  const depth = dist.mul(density);
  const haze = float(1).sub(exp(depth.mul(depth).mul(thin).negate()));
  const tint = mix(fogColor, keyColor, pow(max(dot(viewDir, keyDir), 0), 8).mul(0.5));
  // the thicker the haze, the more it takes the sky's own colour at the horizon, so distant ridges dissolve into the sky behind them
  const horizon = pmremTexture(env.texture, normalize(vec3(viewDir.x, max(viewDir.y, 0.03), viewDir.z)), float(0.4)) as Node<'vec3'>;
  const hazeColour = mix(tint, horizon.rgb, haze);
  const moisture = texture(tex.biomeB, tex.mapUv(positionWorld.xz)).g;
  // the mist thins out within the first few tens of metres, so it lies on the water instead of filling the camera's lens
  const near = float(1).sub(exp(dist.div(-60)));
  const mistF = mist.mul(exp(max(positionWorld.y, 0).div(-6))).mul(moisture.mul(moisture)).mul(near);
  scene.fog = null;
  scene.fogNode = fog(hazeColour, min(haze.add(mistF), 1));

  const v = new Vector3(), quat = new Quaternion(), axis = new Vector3(0, Math.sin((LATITUDE * Math.PI) / 180), -Math.cos((LATITUDE * Math.PI) / 180));
  let aspect = 0, fov = 0;
  let exposure = renderer.toneMappingExposure;
  let masks: number[] | null = null;
  /** The cascades are made on the first render: give them their layers once they exist. */
  const applyMasks = () => {
    if (!csm || !masks || !csm.lights.length) return;
    csm.lights.forEach((l, i) => (l.shadow!.camera.layers.mask = masks![Math.min(i, masks!.length - 1)]));
    masks = null;
  };

  return {
    light, hemi, shadows: csm ? 'csm' : 'single',
    cascadeLayers(m) {
      masks = m;
      if (!csm) light.shadow.camera.layers.mask = m.reduce((a, b) => a | b, 0);
      applyMasks();
    },
    withNight(fn) {
      const was = [nightSky.visible, moon.visible];
      nightSky.visible = moon.visible = true;
      try {
        return fn();
      } finally {
        [nightSky.visible, moon.visible] = was;
      }
    },
    redrawShadows() {
      light.shadow.needsUpdate = true;
      if (csm) for (const l of csm.lights) l.shadow!.needsUpdate = true;
    },
    update(state, sun, moonDir, camera, hours, dt) {
      applyMasks();
      const p = camera.position;
      // sky and sun
      v.set(sun.x, sun.y, sun.z);
      sky.sunPosition.value.copy(v);
      envSky.sunPosition.value.copy(v);
      sunDir.value.copy(v);
      sky.position.copy(p);
      night.value.set(state.skyColor).multiplyScalar(state.stars);
      // stars and moon
      starLevel.value = state.stars;
      nightSky.visible = state.stars >= 0.001; // nothing to draw by day
      moon.visible = nightSky.visible || moonDir.y > 0; // the moon stays up in the day sky while it is above the horizon
      pxToMetres.value = (2 * STAR_R * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, renderer.domElement.height);
      nightSky.position.copy(p);
      nightSky.quaternion.copy(quat.setFromAxisAngle(axis, (-2 * Math.PI * hours * SIDEREAL) / 24));
      moon.position.set(moonDir.x, moonDir.y, moonDir.z).multiplyScalar(MOON_DIST).add(p);
      // key light and ambient
      light.color.set(state.keyColor);
      light.intensity = state.keyIntensity;
      // `castShadow` stays on: three r186 puts it in every lit material's cache key (LightsNode.customCacheKey), so flipping it
      // at the sun/moon switch rebuilt and recompiled every lit pipeline mid-play (a 2–4 s stall at dusk, measured). Holding the
      // shadow maps instead saves their passes while the key light is out, and `autoUpdate` is in no cache key.
      const cast = state.keyIntensity > SHADOW_MIN;
      light.shadow.autoUpdate = cast;
      if (csm) for (const l of csm.lights) l.shadow!.autoUpdate = cast;
      const k = state.keyDir;
      if (csm) {
        light.target.position.copy(p);
        if (camera.aspect !== aspect || camera.fov !== fov) {
          [aspect, fov] = [camera.aspect, camera.fov];
          if (csm.camera) csm.updateFrustums();
        }
      } else {
        const snap = (160 / light.shadow.mapSize.x) * 4; // move in whole texels so the edges do not crawl
        light.target.position.set(Math.round(p.x / snap) * snap, p.y, Math.round(p.z / snap) * snap);
      }
      light.position.set(k.x, k.y, k.z).multiplyScalar(1000).add(light.target.position);
      hemi.color.set(state.skyColor);
      hemi.groundColor.set(state.groundColor);
      hemi.intensity = state.hemiIntensity;
      scene.environmentIntensity = ENV_DAY + (ENV_NIGHT - ENV_DAY) * state.stars;
      // exposure eases; the environment follows the sun
      exposure += (state.exposure - exposure) * (1 - Math.exp(-dt / EXPOSURE_TAU));
      renderer.toneMappingExposure = exposure;
      sinceEnv += dt;
      if (sinceEnv >= ENV_STALE && (envSun.angleTo(v) > (ENV_DEG * Math.PI) / 180 || dt === Infinity)) {
        pmrem.fromScene(envScene, 0, 0.1, 100, { renderTarget: env });
        envSun.copy(v);
        sinceEnv = 0;
      }
      // fog
      fogColor.value.set(state.fogColor);
      keyColor.value.set(state.keyColor);
      keyDir.value.set(k.x, k.y, k.z);
      density.value = state.fogDensity;
      mist.value = state.mist;
    },
  };
}
