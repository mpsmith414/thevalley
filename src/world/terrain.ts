import { BufferAttribute, BufferGeometry, Group, Mesh, Vector2, type Camera, type Node } from 'three/webgpu';
import { abs, clamp, fract, max, positionLocal, step, uniform, vec3 } from 'three/tsl';
import type { Tier } from '../render/quality';
import { createGroundMaterial, type GroundSets } from './ground';
import type { ValleyTextures } from './textures';

/** Clipmap levels, and cells per level side. */
export const LEVELS = 6, N = 128;
/** Geomorphing starts at this fraction of a level's half-width. */
const MORPH_START = 0.8;

/** A level's centre: a multiple of `2·spacing` nearest the camera, so its outer edge sits on the next level's grid. */
export const snapOrigin = (cam: number, spacing: number) => Math.round(cam / (2 * spacing)) * 2 * spacing + 0;

/** Cells (`j·N + i`) drawn by level `k`: the full square for 0, otherwise a ring around the finer level's square. */
export function ringCells(k: number): number[] {
  const out: number[] = [], a = N / 4, b = (3 * N) / 4;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (k === 0 || i < a || i >= b || j < a || j >= b) out.push(j * N + i);
  return out;
}

/**
 * Geomorph blend at Chebyshev distance `d` from a level's centre: 0 inside 80% of `half`, rising to 1 at the edge.
 * `morphNode` below is the same formula in TSL (the vertex shader's); the two must change together.
 */
export const morphFactor = (d: number, half: number) => Math.min(1, Math.max(0, (d / half - MORPH_START) / (1 - MORPH_START)));
/** TSL twin of `morphFactor` (keep them in step). */
const morphNode = (d: Node<'float'>, half: number) => clamp(d.div(half).sub(MORPH_START).div(1 - MORPH_START), 0, 1);

export type LevelPlace = { spacing: number; centre: { x: number; z: number }; shift: { x: number; z: number } };

/**
 * Where each level sits for a camera at (x, z). The finer square can sit one coarse cell off-centre in its ring's hole;
 * `shift` (in coarse cells, −1, 0 or 1) moves the ring's hole edge onto it so the levels meet without cracks.
 */
export function levelCentres(x: number, z: number, cell: number): LevelPlace[] {
  const out: LevelPlace[] = [];
  for (let k = 0; k < LEVELS; k++) {
    const s = cell * 2 ** k, centre = { x: snapOrigin(x, s), z: snapOrigin(z, s) }, prev = out[k - 1];
    const shift = prev ? { x: Math.round((prev.centre.x - centre.x) / s) + 0, z: Math.round((prev.centre.z - centre.z) / s) + 0 } : { x: 0, z: 0 };
    out.push({ spacing: s, centre, shift });
  }
  return out;
}

/** A flat grid in level units (vertices at integer x, z in [−N/2, N/2]) holding only `cells`. */
function levelGeometry(cells: number[]): BufferGeometry {
  const v = N + 1, pos = new Float32Array(v * v * 3), nrm = new Float32Array(v * v * 3);
  for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) {
    const o = (j * v + i) * 3;
    pos[o] = i - N / 2; pos[o + 2] = j - N / 2; nrm[o + 1] = 1;
  }
  const idx = new Uint32Array(cells.length * 6);
  cells.forEach((c, n) => {
    const i = c % N, j = (c - i) / N, a = j * v + i, b = a + 1, cc = a + v, d = cc + 1;
    idx.set([a, cc, b, b, cc, d], n * 6); // counter-clockwise seen from above
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

/**
 * Geometry clipmap terrain: `LEVELS` square levels of `N × N` cells, each twice as coarse as the last, following the camera.
 * Heights come from the height texture in the vertex shader; the outer fifth of each level morphs onto the next level's grid.
 * The ground's look comes from `createGroundMaterial` (the biome-blended photo textures in `sets`).
 */
export function createTerrain(tex: ValleyTextures, tier: Tier, sets: GroundSets): { object: Group; update(camera: Camera): void } {
  const object = new Group();
  object.name = 'terrain';
  const half = tex.size / 2;
  const levels = Array.from({ length: LEVELS }, (_, k) => {
    const centre = uniform(new Vector2()), shift = uniform(new Vector2()), spacing = tex.cell * 2 ** k;
    const local = positionLocal.xz, d = max(abs(local.x), abs(local.y));
    const morph = morphNode(d, N / 2); // mirrors morphFactor(): change both together
    const morphed = local.sub(fract(local.mul(0.5)).mul(2).mul(morph)); // odd vertices slide onto their even neighbour
    const edged = morphed.add(shift.mul(step(d, N / 4 + 0.5))); // hole-edge vertices follow the finer square
    const xz = clamp(centre.add(edged.mul(spacing)), -half, half); // outside the valley: collapse onto the border
    const mat = createGroundMaterial(tex, sets, tier);
    mat.positionNode = vec3(xz.x, tex.heightAtNode(xz), xz.y);
    const mesh = new Mesh(levelGeometry(ringCells(k)), mat);
    mesh.name = `terrain-level-${k}`;
    mesh.frustumCulled = false; // positions are made in the shader
    mesh.castShadow = mesh.receiveShadow = true; // ridges shade the valley at low sun
    object.add(mesh);
    return { centre, shift };
  });

  return {
    object,
    update(camera) {
      levelCentres(camera.position.x, camera.position.z, tex.cell).forEach((p, k) => {
        levels[k].centre.value.set(p.centre.x, p.centre.z);
        levels[k].shift.value.set(p.shift.x, p.shift.z);
      });
    },
  };
}
