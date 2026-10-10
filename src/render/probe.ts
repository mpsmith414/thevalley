import { skinning } from 'three/tsl';

/**
 * Dev-mode checks on the three.js internals the valley leans on (written against r186; see HANDOFF's "three r186
 * workarounds"). `probe(ok, what)` warns once per `what` when `ok` is false, so an upgrade that moves one shows up in the
 * console instead of as a quiet slowdown or a wrong picture. Production builds skip the warning. Returns `ok`.
 */
const warned = new Set<string>();
export function probe(ok: boolean, what: string): boolean {
  if (!ok && import.meta.env.DEV && !warned.has(what)) {
    warned.add(what);
    console.warn(`three workaround: ${what}. Check it against the installed three (written for r186).`);
  }
  return ok;
}

/**
 * True when three's skinning poses a geometry's `tangent` attribute along with its normal: r186's `skinning`
 * (nodes/accessors/Skinning.js) assigns `tangentLocal` the skinned tangent when the geometry has a `tangent` attribute.
 * The creatures carry their groom (hair direction) in that attribute so the fur follows the pose (see `lodGeometry`).
 * Checked on the source of `skinning`'s function (dev builds keep it readable; production skips the warning anyway).
 * If it fails, the hair keeps its rest direction when the animal moves (no error, just fur that doesn't turn with the head).
 */
let tangentChecked: boolean | null = null;
export function skinsTangent(): boolean {
  if (tangentChecked === null) {
    const src = String((skinning as unknown as { shaderNode?: { jsFunc?: unknown } }).shaderNode?.jsFunc ?? '');
    tangentChecked = probe(/hasGeometryAttribute\(\s*['"]tangent['"]\s*\)[\s\S]{0,200}?tangentLocal\w*\.assign\(/.test(src),
      "three's skinning no longer assigns tangentLocal from a `tangent` attribute, so the fur's groom stays in the rest pose (fur.ts; creature.ts binds the groom as `tangent`)");
  }
  return tangentChecked;
}
