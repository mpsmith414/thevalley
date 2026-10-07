import { MeshPhysicalNodeMaterial, Vector3, Vector4, Color } from 'three/webgpu';
import {
  attribute, bumpMap, float, fract, int, mix, mx_noise_float, mx_worley_noise_float, select, sin, smoothstep, step, uniform,
  uniformArray, vec3,
} from 'three/tsl';
import { COVERINGS } from '../recipe/schema';
import { COVERING_LOOK, type RegionPack } from './patterns';

type F = ReturnType<typeof float>;
type C = ReturnType<typeof vec3>;
type V4 = ReturnType<typeof uniformArray>;

/**
 * Region settings as six vec4 arrays (WebGPU allows 12 uniform buffers per shader stage):
 *  colA = base rgb, hasBelly · colB = belly rgb, patKind · colC = pattern rgb, patScale
 *  parA = patAmount, patAlong, furLength, fluff · parB = covering, roughness, sheen, clearcoat · parC = bump
 */
export function packUniforms(pack: RegionPack) {
  const rgb = (hex: string, w: number) => {
    const c = new Color(hex);
    return new Vector4(c.r, c.g, c.b, w);
  };
  const look = pack.covering.map((c) => COVERING_LOOK[COVERINGS[c]]);
  return {
    colA: uniformArray(pack.base.map((h, i) => rgb(h, pack.hasBelly[i])), 'vec4'),
    colB: uniformArray(pack.belly.map((h, i) => rgb(h, pack.patKind[i])), 'vec4'),
    colC: uniformArray(pack.patColor.map((h, i) => rgb(h, pack.patScale[i])), 'vec4'),
    parA: uniformArray(pack.patAmount.map((a, i) => new Vector4(a, pack.patAlong[i], pack.furLength[i], pack.fluff[i])), 'vec4'),
    parB: uniformArray(look.map((l, i) => new Vector4(pack.covering[i], l.roughness, l.sheen, l.clearcoat)), 'vec4'),
    parC: uniformArray(look.map((l) => new Vector4(l.bump, 0, 0, 0)), 'vec4'),
  };
}

/** The colour/finish nodes every creature surface shares (skin and fur), read from the region uniforms. */
export function regionNodes(pack: RegionPack) {
  const U = packUniforms(pack);
  const tint = uniform(new Vector3(1, 1, 1));
  const info = attribute('partInfo', 'vec4');
  const i = int(info.x.add(0.5).floor());
  const at = (a: V4) => a.element(i) as unknown as ReturnType<typeof vec3> & { w: F; xyz: C };
  const colA = at(U.colA), colB = at(U.colB), colC = at(U.colC), parA = at(U.parA), parB = at(U.parB), parC = at(U.parC);
  const pt = info.y;
  const ps = info.z;
  const bp = attribute('bodyPos', 'vec3');
  const rn = attribute('restNormal', 'vec3');

  const kind = colB.w;
  const scale = colC.w;
  const amount = parA.x as unknown as F;
  const coord = mix(bp.z, bp.y, parA.y);
  const wobble = mx_noise_float(bp.mul(3).div(scale)).mul(0.9);
  const stripes = float(1).sub(smoothstep(amount.sub(0.04), amount.add(0.04), sin(coord.mul(6.2832).div(scale).add(wobble)).mul(0.5).add(0.5)));
  const spotR = amount.mul(0.7);
  const spots = float(1).sub(smoothstep(spotR.sub(0.06), spotR.add(0.06), mx_worley_noise_float(bp.div(scale))));
  const thr = float(1).sub(amount.mul(2));
  const patches = smoothstep(thr.sub(0.08), thr.add(0.08), mx_noise_float(bp.div(scale)));
  const rings = float(1).sub(step(amount, fract(ps.div(scale))));
  const gradient = pt.mul(amount);
  const mask = select(kind.lessThan(-0.5), float(0),
    select(kind.lessThan(0.5), stripes,
      select(kind.lessThan(1.5), spots,
        select(kind.lessThan(2.5), patches,
          select(kind.lessThan(3.5), rings, gradient))))) as unknown as F;

  // a lighter underside where the rest-pose surface faces down
  const bellyAmt = float(1).sub(smoothstep(-0.55, -0.1, rn.y)).mul(colA.w).mul(info.w);
  const mottle = mx_noise_float(bp.mul(18)).mul(0.06).add(0.97);
  const base = mix(colA.xyz, colB.xyz, bellyAmt);
  const colorNode = mix(base, colC.xyz, mask.mul(float(1).sub(bellyAmt.mul(0.6)))).mul(mottle).mul(tint) as unknown as C;

  // surface relief by covering: cells for scales and shell, ripples for feathers, fine grain otherwise
  const cov = parB.x as unknown as F;
  const cells = mx_worley_noise_float(bp.mul(90));
  const ripple = mx_worley_noise_float(bp.mul(vec3(40, 70, 25)));
  const grain = mx_noise_float(bp.mul(160));
  const isCells = cov.equal(2).or(cov.equal(4)); // scales, shell
  const height = (select(isCells, cells, select(cov.equal(1), ripple, grain)) as unknown as F).mul(parC.x);

  return {
    tint, i, bp, pt, colorNode, height, mask,
    furLength: parA.z as unknown as F, fluff: parA.w as unknown as F,
    roughness: parB.y as unknown as F, sheen: parB.z as unknown as F, clearcoat: parB.w as unknown as F,
  };
}

/** One shared material for every creature: colour, pattern, belly and finish all come from the region uniforms. */
export function createSkinMaterial(pack: RegionPack) {
  const r = regionNodes(pack);
  const m = new MeshPhysicalNodeMaterial();
  m.colorNode = r.colorNode;
  m.roughnessNode = r.roughness;
  m.metalnessNode = float(0);
  m.sheenNode = r.colorNode.mul(r.sheen).add(vec3(0.15).mul(r.sheen));
  m.sheenRoughnessNode = float(0.55);
  m.clearcoatNode = r.clearcoat;
  m.clearcoatRoughnessNode = float(0.15);
  m.normalNode = bumpMap(r.height, float(0.6));
  return { material: m, tint: r.tint };
}
