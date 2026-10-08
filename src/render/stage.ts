import {
  BufferAttribute, CircleGeometry, Color, DirectionalLight, DoubleSide, Fog, HemisphereLight, InstancedMesh,
  Matrix4, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, PMREMGenerator, Quaternion,
  Scene, Vector3, type WebGPURenderer, BufferGeometry,
} from 'three/webgpu';
import {
  color, float, hash, instanceIndex, mix, mx_noise_float, positionLocal, positionWorld, sin, smoothstep, time, uv, vec3,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { mulberry32 } from '../util/rng';
import { QUALITY, type Tier } from './quality';
import { POND, STAGE_RADIUS, WATER_LEVEL, heightAt, isWater, normalAt } from './terrain';

export type Stage = {
  heightAt: (x: number, z: number) => number;
  isWater: (x: number, z: number) => boolean;
  waterLevel: number;
  waterLevelAt: () => number;
  pond: { x: number; z: number; r: number };
  radius: number;
  sun: DirectionalLight;
  update(t: number): void;
};

const SUN_DIR = new Vector3(0.55, 0.62, 0.35).normalize();

function makeSky(): SkyMesh {
  const sky = new SkyMesh();
  sky.scale.setScalar(1500);
  sky.turbidity.value = 3;
  sky.rayleigh.value = 1.2;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.8;
  sky.sunPosition.value.copy(SUN_DIR);
  sky.cloudCoverage.value = 0.35;
  return sky;
}

function makeGround(): Mesh {
  const size = 60;
  const geo = new PlaneGeometry(size, size, 300, 300);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mat = new MeshStandardNodeMaterial({ roughness: 0.95 });
  const n = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
  const grassA = color('#4a6a28'), grassB = color('#6a8436'), soil = color('#5e4c34'), far = color('#566c36');
  const dist = positionWorld.xz.length();
  const pondDist = positionWorld.xz.sub(vec3(POND.x, POND.z, 0).xy).length();
  let c = mix(grassA, grassB, n);
  c = mix(soil, c, smoothstep(POND.r, POND.r + 0.5, pondDist)); // muddy bank and bed
  c = mix(c, far, smoothstep(STAGE_RADIUS, STAGE_RADIUS + 6, dist)); // the meadow beyond the stage
  mat.colorNode = c;
  const ground = new Mesh(geo, mat);
  ground.receiveShadow = true;
  return ground;
}

function makeGrass(count: number): InstancedMesh {
  // one tapered blade: 7 vertices, uv.y runs root → tip
  const w = 0.012, h = 1;
  const pts = [[-w, 0], [w, 0], [-w * 0.8, h * 0.35], [w * 0.8, h * 0.35], [-w * 0.5, h * 0.7], [w * 0.5, h * 0.7], [0, h]];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pts.flatMap(([x, y]) => [x, y, 0])), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(pts.flatMap(([x, y]) => [x / (2 * w) + 0.5, y / h])), 2));
  // normals point up: blades shade like a soft lawn instead of black backs
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(pts.flatMap(() => [0, 1, 0])), 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);

  const mat = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.8 });
  const tip = uv().y;
  const phase = hash(instanceIndex).mul(6.283);
  const sway = sin(time.mul(1.6).add(phase).add(positionWorld.x.mul(0.7))).mul(0.12).add(0.05);
  mat.positionNode = positionLocal.add(vec3(sway.mul(tip.mul(tip)), 0, sway.mul(tip.mul(tip)).mul(0.5)));
  const shade = hash(instanceIndex.add(7));
  mat.colorNode = mix(color('#2f4718'), mix(color('#6f8f3a'), color('#9aa24e'), shade.mul(0.6)), tip);

  const grass = new InstancedMesh(geo, mat, count);
  const rng = mulberry32(42);
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0);
  let placed = 0;
  while (placed < count) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (STAGE_RADIUS + 1.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isWater(x, z) || Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.15) continue;
    if (r > STAGE_RADIUS && rng() < (r - STAGE_RADIUS) / 1.5) continue; // thin out at the edge
    const n = normalAt(x, z);
    q.setFromUnitVectors(up, new Vector3(n.x, n.y, n.z)).multiply(new Quaternion().setFromAxisAngle(up, rng() * Math.PI));
    const height = 0.025 + rng() * 0.06; // short lawn: feet stay visible
    s.set(1 + rng(), height, 1);
    m.compose(pos.set(x, heightAt(x, z) - 0.005, z), q, s);
    grass.setMatrixAt(placed++, m);
  }
  grass.receiveShadow = true;
  return grass;
}

function makeWater(): Mesh {
  const geo = new CircleGeometry(POND.r + 0.05, 64);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshPhysicalNodeMaterial({ roughness: 0.04, metalness: 0, transparent: true, opacity: 0.82 });
  const ripple = mx_noise_float(positionWorld.xz.mul(3).add(time.mul(0.15))).mul(0.5).add(0.5);
  mat.colorNode = mix(color('#2f5552'), color('#4c7a70'), ripple);
  mat.clearcoatNode = float(1);
  const water = new Mesh(geo, mat);
  water.position.set(POND.x, WATER_LEVEL + 0.002, POND.z);
  return water;
}

/** The turntable stage: a grassy, bumpy patch with a slope and a pond, under a real sky. */
export function createStage(scene: Scene, renderer: WebGPURenderer, tier: Tier): Stage {
  const sky = makeSky();
  scene.add(sky);
  const envScene = new Scene();
  envScene.add(makeSky());
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.14; // the sky is bright; a little goes a long way
  scene.fog = new Fog(new Color('#b9c8cf'), 18, 70);

  scene.add(makeGround(), makeWater(), makeGrass(QUALITY[tier].grass));

  const sun = new DirectionalLight('#fff3df', 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(12);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(QUALITY[tier].shadowMap);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -4;
  cam.right = cam.top = 4;
  cam.near = 1;
  cam.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new HemisphereLight('#cfe3ff', '#5a4a30', 0.35));

  return {
    heightAt, isWater, waterLevel: WATER_LEVEL, waterLevelAt: () => WATER_LEVEL, pond: { x: POND.x, z: POND.z, r: POND.r }, radius: STAGE_RADIUS, sun,
    update() {},
  };
}
