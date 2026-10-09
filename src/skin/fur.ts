import { MeshStandardNodeMaterial, SkinnedMesh, type BufferGeometry, type Material } from 'three/webgpu';
import {
  float, floor, fract, hash, length, max, mix, mx_noise_vec3, normalLocal, positionLocal, select, smoothstep, uniform, varying, vec3,
} from 'three/tsl';
import { markedColor, regionNodes } from './material';
import type { RegionPack } from './patterns';

/** Shell heights as fractions 0..1 of the fur length, packed closer near the skin (where fur is densest). */
export function furShellOffsets(count: number, length = 1): number[] {
  return Array.from({ length: count }, (_, k) => length * ((k + 1) / count) ** 1.6);
}

/** Strand cells per metre: thin hairs on small animals would need more, but ~3 mm reads well on screen. */
const DENSITY = 320;

/**
 * The one material every fur shell of a creature (and of its whole species) shares: each shell's height, as a fraction of
 * the fur length, is read per object from `userData.shellT`.
 */
export function furMaterial(pack: RegionPack): MeshStandardNodeMaterial | null {
  if (pack.furLength.every((l) => l <= 0)) return null;
  const r = regionNodes(pack), f = r.feature;
  // no fur on the nose, lips or hooves, and short fur inside the ears
  const len = r.furLength.mul(float(1).sub(max(max(f.x, f.z), max(f.w, f.y.mul(0.7)))));
  const t = uniform(0).onObjectUpdate(({ object }) => (object?.userData.shellT as number | undefined) ?? 0);
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
  // each strand sits somewhere random in its cell, so the coat doesn't show the grid
  const jitter = vec3(hash(cell.x.add(cell.y.mul(31)).add(cell.z.mul(17))), hash(cell.y.add(cell.z.mul(29)).add(cell.x.mul(13))), hash(cell.z.add(cell.x.mul(23)).add(cell.y.mul(19)))).mul(0.5).add(0.25);
  const inCell = length(fract(cellPos).sub(jitter));
  const present = hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113))).greaterThan(0.12);
  const radius = float(0.42).mul(float(1).sub(t.mul(0.85)));
  const strand = float(1).sub(smoothstep(radius.sub(0.05), radius, inCell));
  m.opacityNode = select(present.and(varying(len).greaterThan(0.0005)), strand, float(0));
  m.alphaTest = 0.5;
  // fur is darker near the skin (self-shadowing), lighter at the tips
  m.colorNode = varying(markedColor(r)).mul(mix(float(0.5), float(1.08), smoothstep(0, 1, t)));
  m.roughnessNode = float(0.95);
  return m;
}

/** Layers of shells over the body that, seen together, look like soft fur (all in one `furMaterial`). */
export function createFurShells(base: SkinnedMesh<BufferGeometry, Material>, material: Material | null, count: number): SkinnedMesh<BufferGeometry, Material>[] {
  if (count <= 0 || !material) return [];
  return furShellOffsets(count).map((t, k) => {
    const shell = new SkinnedMesh<BufferGeometry, Material>(base.geometry, material);
    shell.userData.shellT = t;
    shell.name = `fur${k}`;
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = k + 1;
    shell.bind(base.skeleton, base.bindMatrix);
    return shell;
  });
}
