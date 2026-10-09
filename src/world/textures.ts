import {
  ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, RedFormat, UnsignedByteType,
  type Node, type Texture,
} from 'three/webgpu';
import { clamp, floor, int, ivec2, min, mix, texture, vec2 } from 'three/tsl';
import type { ValleyData } from '../valley/types';
import { RIVER_FAST, RIVER_SLOW } from '../valley/generate/carve';

/** The Valley's maps on the GPU, and TSL helpers to read them at a world position. */
export type ValleyTextures = {
  size: number; grid: number; cell: number; mapGrid: number;
  /** R32F heights, `grid²`, nearest (float textures need not be filterable: read with loads). */
  heightTex: DataTexture;
  /** RGBA8 normal (RGB, mapped from [-1, 1]) and cavity (A), linear with mipmaps. */
  normalTex: DataTexture;
  /** RGBA8 at `mapGrid`: forest, meadow, rock, beach weights. */
  biomeA: DataTexture;
  /** RGBA8 at `mapGrid`: shore, moisture, calm water (`calmWater` / 255: 1 on the lake, 0.5 → 0 on the river, 0 dry), 255. */
  biomeB: DataTexture;
  /** R32F water level at `mapGrid`, −1000 where dry. */
  waterTex: DataTexture;
  /** Ground height at world xz: bilinear by hand over four texel loads. */
  heightAtNode(xz: Node<'vec2'>): Node<'float'>;
  /** UV of world xz on the height grid (texel centres line up with the samples). */
  worldToUv(xz: Node<'vec2'>): Node<'vec2'>;
  /** UV of world xz on the map grid. */
  mapUv(xz: Node<'vec2'>): Node<'vec2'>;
};

/**
 * How calm the water is, as `biomeB.b` stores it (a byte): 255 on the lake, 127 → 0 on the river from its slowest flow to its
 * fastest, 0 where dry. `kind` is the water map's (0 dry, 1 lake, 2 river), `speed` the flow in m/s.
 */
export function calmWater(kind: number, speed: number): number {
  if (kind === 1) return 255;
  if (kind !== 2) return 0;
  return Math.round(127 * Math.min(1, Math.max(0, (RIVER_FAST - speed) / (RIVER_FAST - RIVER_SLOW))));
}
/**
 * Calm-water bands (of `calmWater` / 255) the ground cover reads, as [from, full]: reeds want the lake or a slow river; lily
 * pads the lake alone (no river reaches 0.5). The shaders smoothstep across the band; CPU checks test against its start.
 */
export const REED_CALM: readonly [number, number] = [0.15, 0.4], LAKE_CALM: readonly [number, number] = [0.7, 0.9];

function dataTexture(data: Float32Array | Uint8Array, n: number, linear: boolean): DataTexture {
  const float = data instanceof Float32Array;
  const t = new DataTexture(data, n, n, float ? RedFormat : RGBAFormat, float ? FloatType : UnsignedByteType);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = linear ? LinearFilter : NearestFilter;
  t.minFilter = linear ? LinearMipmapLinearFilter : NearestFilter;
  t.generateMipmaps = linear;
  t.needsUpdate = true;
  return t;
}

/** Upload the Valley's height, normals, biomes and water as textures. */
export function valleyTextures(d: ValleyData): ValleyTextures {
  const { size, grid } = d, cell = size / (grid - 1), half = size / 2, m = d.water.mapGrid, mapCell = size / (m - 1);
  const a = new Uint8Array(m * m * 4), b = new Uint8Array(m * m * 4);
  for (let c = 0; c < m * m; c++) {
    const s = c * 6, o = c * 4; // forest, meadow, rock, shore, beach, moisture
    a[o] = d.biomes[s]; a[o + 1] = d.biomes[s + 1]; a[o + 2] = d.biomes[s + 2]; a[o + 3] = d.biomes[s + 4];
    b[o] = d.biomes[s + 3]; b[o + 1] = d.biomes[s + 5]; b[o + 3] = 255;
    b[o + 2] = calmWater(d.water.kind[c], Math.hypot(d.water.flow[2 * c], d.water.flow[2 * c + 1]));
  }
  const water = Float32Array.from(d.water.level, (l) => (l === l ? l : -1000));

  const heightTex = dataTexture(d.height, grid, false);
  const hBase = texture(heightTex as Texture);
  const heightAtNode = (xz: Node<'vec2'>) => {
    const f = clamp(xz.add(half).div(cell), 0, grid - 1);
    const i0 = min(floor(f), grid - 2), t = f.sub(i0);
    const ix = int(i0.x), iz = int(i0.y);
    const h = (dx: number, dz: number) => hBase.load(ivec2(ix.add(dx), iz.add(dz))).r;
    return mix(mix(h(0, 0), h(1, 0), t.x), mix(h(0, 1), h(1, 1), t.x), t.y);
  };

  return {
    size, grid, cell, mapGrid: m, heightTex,
    normalTex: dataTexture(d.normals, grid, true),
    biomeA: dataTexture(a, m, true),
    biomeB: dataTexture(b, m, true),
    waterTex: dataTexture(water, m, false),
    heightAtNode,
    worldToUv: (xz) => xz.add(half).div(cell).add(0.5).div(grid),
    mapUv: (xz) => vec2(xz.add(half).div(mapCell).add(0.5).div(m)),
  };
}
