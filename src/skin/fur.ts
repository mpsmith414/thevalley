import { MeshStandardNodeMaterial, SkinnedMesh, type BufferGeometry, type Material } from 'three/webgpu';
import {
  float, floor, fract, hash, length, mix, mx_noise_vec3, normalLocal, positionLocal, select, smoothstep, varying, vec3,
} from 'three/tsl';
import { regionNodes } from './material';
import type { RegionPack } from './patterns';

/** Shell heights as fractions 0..1 of the fur length, packed closer near the skin (where fur is densest). */
export function furShellOffsets(count: number, length = 1): number[] {
  return Array.from({ length: count }, (_, k) => length * ((k + 1) / count) ** 1.6);
}

/** Strand cells per metre: thin hairs on small animals would need more, but ~3 mm reads well on screen. */
const DENSITY = 320;

function shellMaterial(pack: RegionPack, shellT: number): MeshStandardNodeMaterial {
  const r = regionNodes(pack);
  const len = r.furLength;
  const t = float(shellT);
  // fluffy fur clumps and wanders; every strand droops a little under gravity
  const wander = mx_noise_vec3(r.bp.mul(40)).mul(r.fluff).mul(len).mul(t).mul(0.8);
  const droop = vec3(0, -1, 0).mul(len).mul(t.mul(t)).mul(0.35);
  const m = new MeshStandardNodeMaterial();
  m.positionNode = positionLocal.add(normalLocal.mul(len.mul(t))).add(wander).add(droop);
  // round strands that thin towards the tips; some cells are bare so the coat looks natural
  // offset keeps cell ids positive (the hash misbehaves below zero); a little noise breaks up grid moiré
  // (both computed per vertex: shells repeat 8–16 times, so the pixel work must stay tiny)
  const cellPos = varying(r.bp.mul(DENSITY).add(1000).add(mx_noise_vec3(r.bp.mul(25)).mul(1.5)));
  const cell = floor(cellPos);
  const inCell = length(fract(cellPos).sub(0.5));
  const present = hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113))).greaterThan(0.12);
  const radius = float(0.5).mul(float(1).sub(t.mul(0.85)));
  const strand = float(1).sub(smoothstep(radius.sub(0.05), radius, inCell));
  m.opacityNode = select(present.and(varying(len).greaterThan(0.0005)), strand, float(0));
  m.alphaTest = 0.5;
  // fur is darker near the skin (self-shadowing), lighter at the tips
  m.colorNode = varying(r.colorNode).mul(mix(float(0.5), float(1.08), smoothstep(0, 1, t)));
  m.roughnessNode = float(0.95);
  return m;
}

/** Layers of shells over the body that, seen together, look like soft fur. */
export function createFurShells(base: SkinnedMesh<BufferGeometry, Material>, pack: RegionPack, count: number): SkinnedMesh<BufferGeometry, Material>[] {
  if (count <= 0 || pack.furLength.every((l) => l <= 0)) return [];
  return furShellOffsets(count).map((t, k) => {
    const shell = new SkinnedMesh<BufferGeometry, Material>(base.geometry, shellMaterial(pack, t));
    shell.name = `fur${k}`;
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = k + 1;
    shell.bind(base.skeleton, base.bindMatrix);
    return shell;
  });
}
