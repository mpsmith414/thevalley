# Lifeform Polish 3b (Fur, Motion, Post-processing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creatures with hair and feathers that lie, shine and glow like the real thing, bodies that move with spine, hips, weight and a steady head (and fliers and swimmers that move properly), and a graded, softly glowing picture that grounds them in the valley, inside River Bend's frame budget.

**Architecture:** The builder bakes two new per-vertex values, a **groom** direction and a **cavity** (ambient occlusion) term, into the slot the duplicate `restNormal` attribute frees. A per-region **coat** word (recipe schema v3) selects a row of fur settings. The fur **shell shader** is rewritten around the groom (leaning strands, guard hairs, clumps, crimp, a feather mode) with a **strand lighting model**. Motion gains a **`BodyMotion`** layer (spine, girdles, weight, bob, head) and new behaviour in the rig and secondary motion (starts, stops, turns, flight attitude, landing, swimming waves). Rendering moves to three's **`RenderPipeline`** (MSAA scene pass → bloom → tone mapping → a **time-of-day grade**), plus **contact shadows** under creatures.

**Tech Stack:** TypeScript, Vite 8, Vitest 5, three 0.186.1 (`three/webgpu`, `three/tsl`, `three/addons/tsl/display/*`), zod, idb, Python 3 + Pillow (tools only).

**Spec:** `docs/superpowers/specs/2026-10-10-lifeform-polish-fur-motion-post-design.md` (read it with this plan).

## Global Constraints

- Specs: `docs/superpowers/specs/2026-10-10-lifeform-polish-fur-motion-post-design.md` (this sub-project); 3a's `docs/superpowers/specs/2026-10-09-lifeform-polish-shapes-faces-design.md` (the bodies it builds on).
- **Creature space:** metres, `+z` forward (towards the head), `+y` up, `+x` the creature's left.
- **Rig angle conventions (verified in `src/motion/rig.ts`):** the root's rotation is `Euler(pitch, yaw, roll, 'YXZ')`. **Positive pitch tips the nose down**; positive yaw turns towards `+x` (the creature's left; `position += (sin yaw, cos yaw)·speed`); positive `turnRate` is a turn to the left; **positive roll raises the left side** (a left bank, left side down, is negative roll).
- **Determinism:** `buildBody(recipe)` is pure (same recipe → bit-identical output; no `Math.random`; fixed iteration orders). Motion is deterministic for a fixed dt and seed (randomness only from `mulberry32` seeded by the recipe).
- **Build time:** every native and fixture body, all three LODs, main thread (`npx tsx tools/perf.ts`): **under 3 s** each (the frog is the tight one, ~2.5 s before this work).
- **Frame cost:** River Bend (`__valley.perf()`, High) **no more than 1.0 ms slower** than the `main` baseline recorded in Task 1, with everything on.
- **WebGPU limits:** at most **8 vertex buffers** (the creature geometry uses all 8: `position, normal, skinIndex, skinWeight, partInfo, bodyPos, restNormal→groom, feature`) and 12 uniform buffers per shader stage. The skin material uses 6 uniform arrays; the fur material may add **one** (`furCoat`); nothing else adds uniform buffers to creature materials.
- **TSL rule:** any node used in more than one `If`/`select` branch must be `.toVar()` before the branches.
- **Shared pipelines:** creature materials stay one-per-species and named (`setName`) so equal materials share GPU pipelines; per-animal values come from `onObjectUpdate` uniforms, as today.
- **Schema:** `SCHEMA_VERSION = 3` after Task 5; v1 and v2 recipes upgrade through `normalizeRecipe`. The zod schema has no numeric ranges; ranges live in `LIMITS`.
- **Tone:** kid-facing text short and warm. Nothing scary.
- **Git:** branch `feat/lifeform-polish-3b` (already checked out). Never merge to `main` without the owner's OK. Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks before every commit:** `npm test` green and `npx tsc --noEmit` clean.
- **three r186 internals:** any new reliance on three internals gets a probe (`src/render/probe.ts`) and a line in HANDOFF's r186 list (Task 20).

## Review Focus

1. **A body with no torso chain, no legs or one leg** (blob, snake, a drawn creature with a single leg or legs only on one side): `BodyMotion`, squaring-up, girdle roll and weight shift must do nothing harmful (no NaN, no division by a zero hip width). Pinned in Task 10 (blob, snake and a one-legged recipe run 120 frames finite).
2. **Recipes saved before this work** (v1 and v2 in the gallery and the body cache): load, upgrade to v3 with inferred coats, and rebuild once. Pinned in Task 5 (v1 and v2 recipes normalise to v3) and Task 2 (cache key covers the new builder output).
3. **Coat on the wrong covering, or odd fur values** (a designer says `woolly` on feathers, `furLength` 0 on a fur region, fluff out of range): repaired, never a black or invisible coat. Pinned in Task 5 (repairs) and Task 6 (`strandCell` clamps for length 0 and huge lengths).
4. **Low tier and WebGL 2 fallback**: no fur shells on Low, no bloom on Low, and the pipeline must still render when the backend is WebGL 2 (MSAA and alpha-to-coverage may not apply). Pinned in Task 16 (pipeline built for each tier; `createPost` with a WebGL-2-like renderer flag keeps the grade and drops nothing else that breaks).
5. **Degenerate groom** (hair flow parallel to the normal: tail tips, ear tips, a blob's poles; zero-area triangles; isolated vertices): no NaN, unit length, tangent. Pinned in Task 3 (blob and snake grooms finite, unit, tangent).

## File map

```
src/builder/   groom.ts (new: hair flow), cavity.ts (new: SDF ambient occlusion), build.ts (bakes groom + cavity per LOD)
src/recipe/    schema.ts (v3: coat), hints.ts (inferCoat), normalize.ts (coat repair + upgrade)
src/cast/      kit.ts (coat option), the 8 natives (coats)
src/skin/      coat.ts (new: COAT_LOOK table, strandCell), fur.ts (shell rewrite, feathers), fur-light.ts (new: FurLightingModel),
               material.ts (rest normal from `normal`, cavity aoNode, covering relief fix), patterns.ts (coat in RegionPack)
src/render/    creature.ts (groom attribute, shell counts), quality.ts (shell counts), post.ts (new: RenderPipeline),
               grade.ts (new: grade node + CPU twin), contact.ts (new: contact shadows), renderer.ts, snapshot.ts, stage.ts
src/motion/    body.ts (new: BodyMotion and its pure helpers), rig.ts (starts, stops, turns, flight attitude, landing),
               secondary.ts (spine for legged bodies, head stabilisation, wing fold, swimming), chains.ts (swimWave)
src/world/     lighting.ts (grade table), sky.ts (eases the grade; haze fix), plants: flower card tint (lupines)
src/app/       main.ts, dev.ts (render through post)
src/lab/       main.ts (post, contact shadow, clip tool)
src/residents/ residents.ts (contact shadows)
server/        prompts.ts (coat)
tools/         gif.py (new), perf.ts (unchanged; used)
tests/         mirrors src/
```

## Working notes for every task

- Run focused tests with `npx vitest run tests/<dir>/<file>.test.ts`; the full suite with `npm test`; types with `npx tsc --noEmit`.
- Browser checks: `preview_start` name `lab` (port 5180, `/lab.html`) or `valley` (`/`). The pane is often hidden, which freezes animation frames: use the dev hooks (`__lab.step(frames)`, `__lab.shot(name)` → `.shots/<name>.png`, `__lab.portrait(recipe, prefix)`, `__lab.clip(...)` after Task 1; `__valley.step/shot/tour/perf/time`). `resize_window` to 1920×1080 first. Look at your shots with the Read tool. Never ask the owner to check by hand.
- Ledger: `.superpowers/sdd3b/progress.md` (gitignored), one line per task with commits and minors.

---

### Task 1: Clip tool, GIF tool and the "before" record

Everything later is judged against "before". This task changes no creature code.

**Files:**
- Modify: `src/lab/main.ts` (dev hook `clip`)
- Create: `tools/gif.py`, `src/lab/clips.ts`, `tests/lab/clips.test.ts`

**Interfaces — Produces:**

```ts
// src/lab/clips.ts
export const CLIPS = ['walk', 'trot', 'gallop', 'start-stop', 'turn', 'hop', 'perch', 'takeoff', 'fly', 'land', 'swim', 'float'] as const;
export type ClipName = (typeof CLIPS)[number];
/** Ground the clip runs on: flat land, or flat water `level` m deep (swim, float). */
export type ClipGround = { heightAt(x: number, z: number): number; isWater(x: number, z: number): boolean; waterLevelAt(x: number, z: number): number };
export function clipGround(name: ClipName): ClipGround; // swim/float: water everywhere, level 0.6 (swim) / 0.25 (float); else flat land at 0
/** Drive one frame of a clip: `f` is the frame index since the clip began (warm-up frames are negative). */
export type ClipRig = { position: { x: number; z: number }; yaw: number; wantFly: boolean; cruise: number | null; setSpeed(f: number): void; moveTo(t: { x: number; y: number; z: number } | null): void };
export function driveClip(name: ClipName, rig: ClipRig, f: number, total: number): void;
// lab dev hook (src/lab/main.ts):
// __lab.clip(recipe: Recipe, name: ClipName, prefix: string, frames = 16, every = 4, warm = 90): Promise<string[]>
```

`driveClip` rules (frame `f`, `total` = frames × every, all at dt = 1/60): a target is always placed 50 m ahead along the rig's current heading unless stated.
- `walk`: `setSpeed(0.2)`; `trot`: `setSpeed(0.55)`; `gallop`: `setSpeed(1)`; `hop`: `setSpeed(0.6)` (any body; a hopper hops).
- `start-stop`: standing (`moveTo(null)`) while `f < 0`; at `f ≥ 0` `setSpeed(0.5)` and target ahead; at `f ≥ 0.55·total` `moveTo(null)`.
- `turn`: `setSpeed(0.3)`; target ahead while `f < 0`, then a target 50 m to the left (heading + 90°), fixed at the moment `f` first reaches 0.
- `perch`: `moveTo(null)`, `wantFly = false`.
- `takeoff`: `wantFly = false` while `f < 0`, then `wantFly = true`, `cruise = 2`, target ahead, `setSpeed(0.6)`.
- `fly`: `wantFly = true`, `cruise = 2`, target ahead, `setSpeed(0.6)` from the start (warm-up gets it airborne).
- `land`: like `fly` while `f < 0`, then `wantFly = false`.
- `swim`: target ahead, `setSpeed(0.4)`. `float`: target ahead, `setSpeed(0.3)`.

`__lab.clip` shows the recipe (`show`), builds its **own** `CreatureRig` on the shown creature with `clipGround(name)` (so water clips have water), runs `warm` frames with `driveClip(name, rig, f - warm, total)` for f < warm, then for each of `frames` frames steps `every` times and saves `${prefix}-${name}-${String(k).padStart(2, '0')}`. The camera follows from the creature's left side (`+x` of its heading) at distance `max(0.6, 2.4 × sizeM)`, 8° above, aimed at the root + rest height (fliers: at the root). Afterwards it restores the lab's own rig and camera and resumes nothing (the loop stays paused, as `portrait` does). Each clip is deterministic: the rig is fresh and stepped with fixed dt.

`tools/gif.py OUT.gif IN... [--fps 15] [--width 640]`: Pillow, resizes each frame to `width` (aspect kept), loops forever.

- [ ] **Step 1: Write the failing test** `tests/lab/clips.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLIPS, clipGround, driveClip, type ClipRig } from '../../src/lab/clips';

const fake = (): ClipRig & { speed: number; target: unknown } => ({
  position: { x: 0, z: 0 }, yaw: 0, wantFly: false, cruise: null, speed: -1, target: undefined,
  setSpeed(f) { this.speed = f; }, moveTo(t) { this.target = t; },
});

describe('motion clips', () => {
  it('water clips stand in water, land clips on flat ground', () => {
    expect(clipGround('swim').isWater(3, -2)).toBe(true);
    expect(clipGround('swim').waterLevelAt(0, 0)).toBeCloseTo(0.6);
    expect(clipGround('walk').isWater(0, 0)).toBe(false);
    expect(clipGround('walk').heightAt(5, 5)).toBe(0);
  });
  it('start-stop stands, goes, then stops', () => {
    const r = fake();
    driveClip('start-stop', r, -10, 64);
    expect(r.target).toBeNull();
    driveClip('start-stop', r, 0, 64);
    expect(r.speed).toBe(0.5);
    expect(r.target).not.toBeNull();
    driveClip('start-stop', r, 40, 64);
    expect(r.target).toBeNull();
  });
  it('turn heads 90 degrees left of where it was going', () => {
    const r = fake();
    driveClip('turn', r, -1, 64);
    driveClip('turn', r, 0, 64);
    const t = r.target as { x: number; z: number };
    expect(t.x).toBeGreaterThan(40); // left = +x when facing +z
    expect(Math.abs(t.z)).toBeLessThan(1);
  });
  it('land wants to fly during warm-up only', () => {
    const r = fake();
    driveClip('land', r, -5, 64);
    expect(r.wantFly).toBe(true);
    driveClip('land', r, 0, 64);
    expect(r.wantFly).toBe(false);
  });
  it('every clip drives without throwing', () => {
    for (const c of CLIPS) for (const f of [-3, 0, 30]) driveClip(c, fake(), f, 64);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/lab/clips.test.ts`: FAIL (module missing).
- [ ] **Step 3:** Implement `src/lab/clips.ts` (the turn target is fixed once: keep it in a module-level `WeakMap<ClipRig, {x,y,z}>` keyed by the rig). Implement the `clip` dev hook in `src/lab/main.ts` next to `portrait` and add it to `__lab`. Write `tools/gif.py`.
- [ ] **Step 4:** Run the test: PASS. `npm test`, `npx tsc --noEmit`.
- [ ] **Step 5: Before record (lab).** Start the lab, `resize_window` 1920×1080. In the console:
  - for each of `__lab.CAST` and each fixture in `__lab.fixtures` (`quadruped, snake, hexapod, blob, biped, bird`): `await __lab.portrait(recipe, 'b3-' + id)`;
  - clips (prefix `b3-<id>`): deer `walk, trot, gallop, start-stop, turn`; fox `walk, trot, turn`; wolf `trot, gallop`; rabbit `hop, start-stop`; duck `walk, float`; hawk `perch, takeoff, fly, land`; trout `swim`; frog `hop`; fixtures quadruped `walk`, biped `walk`, hexapod `walk`, snake `walk`, bird `walk`.
- [ ] **Step 6: Before record (valley).** Open the valley, let it load, `await __valley.tour('b3')` (8 viewpoints × 4 times), then `await __valley.perf()` three times; record River Bend's median and p90 of each run and their mean in `.superpowers/sdd3b/baseline.txt`. Also run `npx tsx tools/perf.ts` and append its output.
- [ ] **Step 7: Sheets.** `python tools/tile.py .shots/b3-faces.png .shots/b3-{deer,rabbit,fox,wolf,duck,hawk,trout,frog,quadruped,snake,hexapod,blob,biped,bird}-face.png --cols 4` (same for `-34`, `-side`); for each clip: `python tools/tile.py .shots/b3-<id>-<clip>.png .shots/b3-<id>-<clip>-*.png --cols 8` and `python tools/gif.py .shots/b3-<id>-<clip>.gif .shots/b3-<id>-<clip>-*.png`.
- [ ] **Step 8: Commit** (`feat(lab): motion clip tool and GIF tool; 3b before record`).

---

### Task 2: The `groom` attribute replaces `restNormal`

Proves the rest normal can be read from `normal` and frees the 7th vertex buffer for groom + cavity. No visible change.

**Files:**
- Modify: `src/builder/build.ts` (`LodMesh.groom`), `src/render/creature.ts` (`lodGeometry`), `src/skin/material.ts` (`regionNodes`), `src/builder/worker.ts`/`client.ts`/`cache.ts` only if they list `LodMesh` fields by name.
- Test: `tests/builder/build.test.ts`, `tests/render/creature.test.ts` (create if missing).

**Interfaces — Produces:**

```ts
// src/builder/build.ts
export type LodMesh = MeshData & { skinIndex: Uint16Array; skinWeight: Float32Array; region: Float32Array; partT: Float32Array;
  partS: Float32Array; boneOf: Uint16Array; feature: Float32Array;
  /** 4 per vertex: the hair's rest direction (unit tangent, xyz; zero where there is none) and the cavity (w: 1 open … 0.25 deep). */
  groom: Float32Array };
// src/render/creature.ts: lodGeometry sets attribute 'groom' (itemSize 4) and no longer sets 'restNormal'.
// src/skin/material.ts: regionNodes reads the rest normal as attribute('normal', 'vec3'); it also returns
//   groom: attribute('groom','vec4').xyz and cavity: attribute('groom','vec4').w
```

In this task `buildBody` fills `groom` with `(0, 0, 0, 1)` per vertex (Tasks 3 and 4 fill real values).

- [ ] **Step 1: Failing tests.** In `tests/builder/build.test.ts`: `buildBody(quadruped, [1])` returns `lods[0].groom` of length `4 × vertices` with every `w === 1`. In `tests/render/creature.test.ts`: `lodGeometry(lod, body)` has a `groom` attribute with `itemSize` 4 and **no** `restNormal` attribute, and the geometry has exactly 8 attributes.
- [ ] **Step 2:** Run both: FAIL.
- [ ] **Step 3:** Implement. Check how the worker transfers and the cache stores `LodMesh` (`src/builder/worker.ts`, `client.ts`, `cache.ts`): if they enumerate fields, add `groom`; if generic, nothing to do. The body cache key includes `__BUILDER_HASH__` (a hash of `src/builder`, `src/recipe`, `src/util` sources), so stale cached bodies without `groom` are never served; add a guard in `loadBody` that treats a cached body whose LODs lack `groom` as a miss anyway (one line, with a test in `tests/builder/cache.test.ts`).
- [ ] **Step 4:** Tests PASS; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5: Browser proof.** In the lab, `portrait` the deer, fox and duck as `t2-<id>`; compare with `b3-<id>` (`-34` and `-side`): the belly shading must be unchanged. Check numerically with a small Pillow script in your scratchpad (mean absolute difference over the creature's bounding box < 2/255; the background is identical because the stage is). If the belly vanished or moves with the pose, `attribute('normal')` is being skinned: switch to the fallback in the spec §2 (pack the belly flag into `bodyPos.w` as `region² + 1000·belly`, decode in `regionNodes`, and read the rest normal from a `groom`-adjacent packing), and say so in the report.
- [ ] **Step 6: Commit** (`refactor(skin): groom attribute replaces the duplicate rest normal`).

---

### Task 3: Groom — the way the hair lies

**Files:**
- Create: `src/builder/groom.ts`, `tests/builder/groom.test.ts`
- Modify: `src/builder/build.ts` (fill `groom.xyz`)

**Interfaces — Produces:**

```ts
// src/builder/groom.ts
/** Each bone's hair flow (creature space, unit; zero for eyes), from its role (see the spec's table). */
export function boneFlows(sk: Skeleton): Vec3[];
/**
 * The hair direction at every vertex: its bones' flows blended by skin weight, a little downward on steep sides,
 * projected onto the surface and smoothed over the mesh (`passes` Laplacian passes). Unit tangents, or zero where every
 * weighted bone has no flow. 3 per vertex.
 */
export function groomField(positions: Float32Array, normals: Float32Array, indices: Uint32Array,
  skinIndex: Uint16Array, skinWeight: Float32Array, sk: Skeleton, passes = 4): Float32Array;
```

Rules (exact):
- `boneFlows`: `d = norm(end − start)`. Head position `H` = start of the first `head` bone (or bone 0's end if none). `torso`: `±d`, the sign making `dot(flow, H − mid) < 0` (flows away from the head; `mid` = bone midpoint); a torso bone whose midpoint is the head itself (`|H − mid| < 1e-6`) uses `−d`. `neck`: `−d`. `head`, `mouth` (and the jaw bone, role `mouth`): `−d`. `leg`, `foot`, `tail`, `ear`, `antenna`, `wing`, `fin`: `d`. `eye`: `(0,0,0)`. Any other role: `d`.
- Per vertex: `f = Σ_k w_k · flow[skinIndex_k]` over its 4 weights; `f += 0.25 · (1 − |n.y|) · (0, −1, 0)` only if `|f| > 1e-6`; project `g = f − (f·n) n`. If `|g| < 0.2 · |f|` or `|f| < 1e-6` the vertex is **degenerate** (store zero, flag it).
- Smoothing: build vertex adjacency from `indices` (unique neighbours). Each pass: `g'_v = g_v + Σ_neighbours g_u`, project onto `n_v`, normalise (leave zero if `|g'_v| < 1e-6`). Degenerate vertices take part in averaging only once a neighbour gives them a value. Passes run in vertex order into a new buffer (Jacobi, deterministic).
- Vertices whose dominant bone is an eye keep zero.
- After smoothing, any vertex still zero but not an eye vertex takes `project((0, −1, 0))`, else `project((0, 0, −1))`, normalised (never NaN).

In `buildBody`, per LOD: `groom.xyz = groomField(positions, normals, indices, skin.skinIndex, skin.skinWeight, rig)` (after `skinWeights`, using the final normals).

- [ ] **Step 1: Failing tests** `tests/builder/groom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { boneFlows } from '../../src/builder/groom';
import { buildSkeleton } from '../../src/builder/skeleton';
import { CAST } from '../../src/cast';
import { blob, snake } from '../fixtures/recipes';

const deer = CAST.find((c) => c.recipe.id === 'deer')!.recipe;
const at = (a: Float32Array, v: number, n = 4) => ({ x: a[v * n], y: a[v * n + 1], z: a[v * n + 2] });

describe('groom', () => {
  it('flows tail-wards on the torso, down the legs, back from the nose; none on eyes', () => {
    const sk = buildSkeleton(deer), f = boneFlows(sk);
    sk.bones.forEach((b, i) => {
      if (b.role === 'torso') expect(f[i].z).toBeLessThan(-0.7);
      if (b.role === 'leg' || b.role === 'foot') expect(f[i].y).toBeLessThan(-0.3);
      if (b.role === 'head' || b.role === 'mouth') expect(f[i].z).toBeLessThan(0);
      if (b.role === 'eye') expect(Math.hypot(f[i].x, f[i].y, f[i].z)).toBe(0);
    });
  });
  const body = buildBody(deer, [1]), lod = body.lods[0];
  const n = lod.positions.length / 3;
  it('is a unit tangent everywhere except on the eyes', () => {
    let bad = 0;
    for (let v = 0; v < n; v++) {
      const g = at(lod.groom, v), nn = at(lod.normals, v, 3), l = Math.hypot(g.x, g.y, g.z);
      if (l === 0) { if (body.skeleton.bones[lod.boneOf[v]].role !== 'eye') bad++; continue; }
      if (Math.abs(l - 1) > 1e-3 || Math.abs(g.x * nn.x + g.y * nn.y + g.z * nn.z) > 0.05) bad++;
    }
    expect(bad).toBe(0);
  });
  it('points tail-wards on the flanks and down the legs', () => {
    let flank = 0, flankN = 0, leg = 0, legN = 0;
    for (let v = 0; v < n; v++) {
      const role = body.skeleton.bones[lod.boneOf[v]].role, g = at(lod.groom, v);
      if (role === 'torso' && Math.abs(lod.normals[v * 3]) > 0.7) { flank += -g.z; flankN++; }
      if (role === 'leg') { leg += -g.y; legN++; }
    }
    expect(flank / flankN).toBeGreaterThan(0.7);
    expect(leg / legN).toBeGreaterThan(0.7);
  });
  it('turns smoothly: neighbours agree within 15 degrees on average', () => {
    let sum = 0, cnt = 0;
    const I = lod.indices;
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = at(lod.groom, I[t + k]), b = at(lod.groom, I[t + ((k + 1) % 3)]);
      const la = Math.hypot(a.x, a.y, a.z), lb = Math.hypot(b.x, b.y, b.z);
      if (!la || !lb) continue;
      sum += Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb))); cnt++;
    }
    expect(sum / cnt).toBeLessThan((15 * Math.PI) / 180);
  });
  it('is finite and deterministic on odd bodies', () => {
    for (const r of [blob, snake]) {
      const a = buildBody(r, [2]).lods[0].groom, b = buildBody(r, [2]).lods[0].groom;
      expect(a.every(Number.isFinite)).toBe(true);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});
```

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement `groom.ts` and wire it into `buildBody`.
- [ ] **Step 4:** PASS. `npx tsx tools/perf.ts`: the frog stays under 3 s (groom costs O(vertices × passes); expect < 30 ms). Record the frog's time in the report.
- [ ] **Step 5:** `npm test`, `npx tsc --noEmit`, commit (`feat(builder): groom, the hair's rest direction, baked per vertex`).

---

### Task 4: Cavity — baked contact shading

**Files:**
- Create: `src/builder/cavity.ts`, `tests/builder/cavity.test.ts`
- Modify: `src/builder/build.ts` (fill `groom.w`; LOD inheritance through simplifier `source`)

**Interfaces — Produces:**

```ts
// src/builder/cavity.ts
export type Sdf = (x: number, y: number, z: number) => number;
/** Step length for a vertex: 0.35 × its part radius (bone r0→r1 at partT), clamped to [1 mm, 3 cm]. */
export function cavityStep(sk: Skeleton, bone: number, partT: number): number;
/**
 * How open the surface is at each vertex (1 open … 0.25 deep), from the SDF along the normal:
 * occ = Σ_{k=1..steps} 0.5^k · max(0, d_k − sdf(p + n·d_k)) / d_k, with d_k = k·h, normalised by Σ 0.5^k;
 * cavity = clamp(1 − 1.2·occ, 0.25, 1). 1 per vertex.
 */
export function cavityField(positions: Float32Array, normals: Float32Array, boneOf: Uint16Array, partT: Float32Array,
  sk: Skeleton, sdf: Sdf, steps = 5): Float32Array;
```

`buildBody`: compute the cavity once for the **finest requested LOD** (LOD0 normally) with the body `sdf` (the exact one built in `sampleBody`); for coarser LODs, map each vertex through the simplifier snapshots' `source` (input vertex index): build `Map<source, cavity>` from the finest LOD's vertices and look each coarser vertex's `source` up; a source not found (should not happen: a vertex alive in a coarser snapshot was alive in the finer one) computes its own value. If the frog's full build exceeds 2.9 s with the exact SDF, use `coarseBodySdf(skeleton, anat, fine)` instead; if still over, `steps = 3`. Record which in the report and in a comment.

- [ ] **Step 1: Failing tests** `tests/builder/cavity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { cavityField } from '../../src/builder/cavity';
import { buildSkeleton } from '../../src/builder/skeleton';
import { CAST } from '../../src/cast';

const deer = CAST.find((c) => c.recipe.id === 'deer')!.recipe;

describe('cavity', () => {
  it('is 1 on an open sphere and darker inside a crease', () => {
    const sk = buildSkeleton(deer);
    const sphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 0.1;
    const P = new Float32Array([0, 0.1, 0]), N = new Float32Array([0, 1, 0]);
    expect(cavityField(P, N, new Uint16Array([0]), new Float32Array([0.5]), sk, sphere)[0]).toBeGreaterThan(0.97);
    // a point at the bottom of a groove between two spheres
    const two = (x: number, y: number, z: number) => Math.min(Math.hypot(x - 0.06, y, z) - 0.07, Math.hypot(x + 0.06, y, z) - 0.07);
    const Q = new Float32Array([0, Math.sqrt(0.07 ** 2 - 0.06 ** 2), 0]);
    expect(cavityField(Q, N, new Uint16Array([0]), new Float32Array([0.5]), sk, two)[0]).toBeLessThan(0.85);
  });
  const body = buildBody(deer, [0, 1, 2]);
  it('stays in [0.25, 1] and darkens where legs meet the body', () => {
    const lod = body.lods[0], n = lod.positions.length / 3, bones = body.skeleton.bones;
    let back = 0, backN = 0, pit = 0, pitN = 0;
    for (let v = 0; v < n; v++) {
      const c = lod.groom[v * 4 + 3];
      expect(c).toBeGreaterThanOrEqual(0.25);
      expect(c).toBeLessThanOrEqual(1);
      const b = bones[lod.boneOf[v]], ny = lod.normals[v * 3 + 1];
      if (b.role === 'torso' && ny > 0.8) { back += c; backN++; }
      // armpit/groin: upper-leg vertices near the leg's start, facing inwards or up
      if (b.role === 'leg' && bones[b.parent]?.role === 'torso' && lod.partT[v] < 0.2) { pit += c; pitN++; }
    }
    expect(back / backN).toBeGreaterThan(0.9);
    expect(back / backN - pit / pitN).toBeGreaterThan(0.15);
  });
  it('coarser LODs inherit the finest LOD values', () => {
    const fine = body.lods[0], coarse = body.lods[2];
    const vals = new Set(Array.from({ length: fine.positions.length / 3 }, (_, v) => fine.groom[v * 4 + 3]));
    let found = 0;
    for (let v = 0; v < coarse.positions.length / 3; v++) if (vals.has(coarse.groom[v * 4 + 3])) found++;
    expect(found / (coarse.positions.length / 3)).toBeGreaterThan(0.99);
  });
});
```

(If `partT` for the upper leg is not 0 at its root, adjust the armpit selector to "leg bone child of a torso bone, within one leg radius of the bone's start" and keep the 0.15 margin.)

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** PASS. `npx tsx tools/perf.ts`: every body < 3 s; record the frog's time.
- [ ] **Step 5:** `npm test`, `npx tsc --noEmit`, commit (`feat(builder): cavity, baked SDF ambient occlusion per vertex`).

---

### Task 5: Recipe v3 — the `coat` hint

**Files:**
- Modify: `src/recipe/schema.ts`, `src/recipe/hints.ts`, `src/recipe/normalize.ts`, `src/cast/kit.ts`, `tests/fixtures/recipes.ts`, `server/prompts.ts`, `src/lab/gallery.ts` (only if it hard-codes the version)
- Test: `tests/recipe/hints.test.ts`, the normalize test file (`tests/recipe/normalize.test.ts` or wherever `normalizeRecipe` is tested), `tests/builder/build.test.ts` (`bodyKey`)

**Interfaces — Produces:**

```ts
// src/recipe/schema.ts
export const SCHEMA_VERSION = 3 as const;
export const COATS = ['sleek', 'soft', 'shaggy', 'woolly', 'bristly', 'smooth', 'downy'] as const;
export type Coat = (typeof COATS)[number];
export const FUR_COATS: readonly Coat[] = ['sleek', 'soft', 'shaggy', 'woolly', 'bristly'];
export const FEATHER_COATS: readonly Coat[] = ['smooth', 'downy'];
// RegionSchema gains (after fluff):
coat: z.enum(COATS).nullable().describe('Hair or feather kind: fur sleek|soft|shaggy|woolly|bristly, feathers smooth|downy; null otherwise'),
// src/recipe/hints.ts
export function inferCoat(r: Pick<Region, 'covering' | 'furLength' | 'fluff'>): Coat | null;
```

Rules: see spec §3 exactly (fur: woolly when fluff ≥ 0.75 and length < 0.05; shaggy when length ≥ 0.05 or fluff ≥ 0.75; sleek when length < 0.008 and fluff < 0.3; else soft. Feathers: downy when fluff ≥ 0.5 else smooth. Others: null). `normalizeRecipe`: a missing, unknown or mismatched coat (a fur word on feathers, a feather word on fur, any word on another covering) becomes `inferCoat(region)` with a fix line `skin.regions[i].coat → <value>`; a v1 or v2 recipe upgrades (`schemaVersion: 3`). `kit.region()` accepts `coat?: Coat` and fills `inferCoat` otherwise. `makeRecipe` fixtures get inferred coats. `bodyKey` must not change when only `coat` changes.

Designer prompt (`server/prompts.ts`, in the skin section, after the furLength/fluff guidance), add exactly:

```
"coat" per region: for fur "sleek" (short and glossy: deer, otter), "soft" (fox, rabbit, cat), "shaggy" (long and hanging: a bison's mane, a sheepdog), "woolly" (thick and crimped: a sheep) or "bristly" (stiff and sparse: a boar); for feathers "smooth" (sleek feathers lying flat) or "downy" (fluffy: a chick, an owl's chest); null for scales, skin, shell or slime.
```

- [ ] **Step 1: Failing tests.** `hints.test.ts`: `inferCoat` for each branch (fur 0.006/0.1 → sleek; 0.012/0.15 → soft; 0.06/0.2 → shaggy; 0.03/0.8 → woolly; 0.08/0.9 → shaggy; feathers fluff 0.6 → downy, 0.2 → smooth; scales → null). Normalize: a v2 recipe (copy a native, set `schemaVersion: 2`, delete every region's `coat`) normalises to v3 with inferred coats and a fix line; `{ covering: 'feathers', coat: 'woolly' }` → `smooth` or `downy`; `{ covering: 'scales', coat: 'soft' }` → `null`; a v1 recipe still upgrades all the way (reuse the existing v1 test, now expecting version 3). `build.test.ts`: `bodyKey(r) === bodyKey(withCoat(r, 'shaggy'))`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement; update everything `tsc` flags (every `Region` literal needs `coat`; `region()` in the cast fills it).
- [ ] **Step 4:** PASS; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit (`feat(recipe): schema v3, a coat word per region (inferred when missing); the designer learns it`).

---

### Task 6: Fur shells rewritten — leaning strands, guard hairs, clumps, crimp

**Files:**
- Create: `src/skin/coat.ts`, `tests/skin/coat.test.ts`
- Modify: `src/skin/fur.ts`, `src/skin/patterns.ts` (`RegionPack.coat`), `src/render/quality.ts` (shell counts), `src/render/creature.ts` (lab shell override)
- Test: `tests/skin/fur.test.ts` (extend or create)

**Interfaces — Produces:**

```ts
// src/skin/coat.ts
export type CoatLook = {
  lean: number;      // 0 stands up … 1 lies flat along the groom
  density: number;   // strand cells per fur length (scales the cell size down)
  radius: number;    // strand radius as a fraction of its cell (0..0.5)
  guard: number;     // share of guard-hair cells (0 none … 1 every guard cell)
  guardLen: number;  // guard hair length × fur length
  clump: number;     // 0..1 how much strand tips gather to clump centres
  crimp: number;     // 0..1 wave amplitude along the strand
  sheen: number;     // specular strength for the strand lighting
  droop: number;     // gravity sag × fur length
};
export const COAT_LOOK: Record<Coat, CoatLook>;
/** The strand cell size (m): clamp(furLength / (density × 8.3), 0.4 mm, 2.5 mm) — about 0.12 × length at density 1. 0.4 mm for length ≤ 0. */
export function strandCell(furLength: number, density: number): number;
/** The coat a region shows (its own, or inferred), or null for regions without hair or feathers. */
export function regionCoat(r: Region): Coat | null;
// patterns.ts: RegionPack gains coat: number[] (index into COATS, -1 for none)
// quality.ts: QUALITY.high.furShells = 16, medium = 8, low = 0 (Task 9 may set high back to 12 for the frame budget)
// creature.ts: createCreatureObject(body, recipe, tier, variation?, look?, furShells?: number) — the lab passes 24
```

Starting `COAT_LOOK` values (tuned in Task 9):

| coat | lean | density | radius | guard | guardLen | clump | crimp | sheen | droop |
|---|---|---|---|---|---|---|---|---|---|
| sleek | 0.85 | 1.3 | 0.32 | 0.15 | 1.1 | 0 | 0 | 0.8 | 0.1 |
| soft | 0.55 | 1.1 | 0.36 | 0.35 | 1.2 | 0.25 | 0 | 0.5 | 0.2 |
| shaggy | 0.45 | 0.8 | 0.38 | 0.6 | 1.3 | 0.55 | 0.15 | 0.45 | 0.5 |
| woolly | 0.15 | 1.6 | 0.42 | 0 | 1 | 0.35 | 0.8 | 0.15 | 0.1 |
| bristly | 0.25 | 0.6 | 0.3 | 0.7 | 1.2 | 0 | 0 | 0.25 | 0 |
| smooth | 0.9 | 1 | 0.3 | 0 | 1 | 0 | 0 | 0.6 | 0 |
| downy | 0.3 | 1.4 | 0.4 | 0 | 1 | 0.4 | 0.3 | 0.2 | 0.15 |

Shader (`furMaterial(pack)`), per shell height `t ∈ (0,1]` (the existing `shellT` uniform), with the per-region coat values from ONE new uniform array `furCoat` (`uniformArray(16 × vec4).setName('furCoat')`: element `2i` = `(lean, radius, guard, guardLen)`, `2i+1` = `(clump, crimp, droop, cell)` where `cell = strandCell(furLength_i, density_i)`):
- `len` as today (no fur on nose, lips, hooves; short inside ears); `g = attribute('groom').xyz` re-projected onto `normalLocal` (skinning bends normals but not the attribute: re-orthogonalise each frame: `gs = normalize(g − n·dot(g,n))`, with a fallback to zero when `|…| < 1e-4`); the groom must follow the pose like the normal does: transform it with the same skinning as the normal (use three's skinning node for direction vectors if available, otherwise skin it by hand from `skinIndex/skinWeight` and the bone matrices the same way `normalLocal` is; document the choice).
- Offset: `positionLocal + n·len·t·(1 − lean·t) + gs·len·lean·t^1.5 + droop·len·t²·(0,−1,0) + wander (as today, × fluff) + crimp·len·0.15·sin(t·6π)·b` where `b = cross(n, gs)`.
- Strand cells: `cellPos = bp / cell + 1000 + noise·1.5` (per vertex, varying, as today but with the region's `cell`); jitter as today. Clump: the strand's centre moves towards its clump centre (Worley cell `bp / (6·cell)`) by `clump·t`. Radius `radius·(1 − 0.7·t)`; each strand has its own length `0.6 + 0.4·hash(cell)` and is cut above it.
- Guard hairs: a second lattice at `2.5 × cell`; a guard cell is present with probability `guard`; it is drawn up to `t ≤ guardLen` (the shells' height range is extended to `max(guardLen)` of the creature: shells run `t ∈ (0, maxGuardLen]` and underfur stops at its own length), radius `radius·1.2·(1 − 0.6t)`, its own sheen boost (stored for Task 7 in a varying `isGuard`).
- Above `t = 0.75` only guard hairs are drawn for coats with `guard > 0`; others fade naturally by length variation.
- `m.alphaToCoverage = true`; keep `m.alphaTest = 0.5` only when the render target has a single sample (three ignores alpha-to-coverage then; leave both set, alpha-to-coverage wins with MSAA — check visually).
- Colour: as today (`markedColor`, root darker → tip lighter) — Task 7 replaces the lighting.

- [ ] **Step 1: Failing tests.** `tests/skin/coat.test.ts`: `strandCell(0.012, 1.3)` ≈ 1.11 mm (± 0.05 mm); `strandCell(0, 1)` = 0.0004; `strandCell(1, 1)` = 0.0025; `regionCoat` returns the inferred coat for a v3 region with `coat: null` on fur and null for scales; every `COAT_LOOK` row has `0 ≤ lean ≤ 1`, `0 < radius ≤ 0.5`. `tests/skin/fur.test.ts`: `furMaterial(pack)` returns null when no region has fur; with fur it has `alphaToCoverage === true`; `packRegions` puts the coat index in `pack.coat` (`-1` for scales).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement `coat.ts`, the pack field, the shell counts and override, and the shader.
- [ ] **Step 4:** Tests PASS; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5: Look.** Lab portraits `t6-<id>` for deer, fox, rabbit, wolf, and the fixture quadruped. Read the face and three-quarter shots next to `b3-…`: strands must lean tail-wards, no studs or spikes, no hard stripes or moiré, outline softer. Fix what doesn't (common faults: groom not skinned → hair stays put when the head turns; cell too small → noise; lean too strong → bald-looking flat coat). Put the sheet `t6-compare.png` (rows b3 | t6) in `.shots`.
- [ ] **Step 6:** Commit (`feat(skin): fur shells lean along the groom, with guard hairs, clumps and crimp`).

---

### Task 7: Strand lighting, fur-coloured underfur, cavity shading

**Files:**
- Create: `src/skin/fur-light.ts`, `tests/skin/fur-light.test.ts`
- Modify: `src/skin/fur.ts`, `src/skin/material.ts`, `src/render/probe.ts` (if a new internal is used)

**Interfaces — Produces:**

```ts
// src/skin/fur-light.ts
/** CPU twin of the strand shading, for tests: Kajiya-Kay with two shifted lobes, wrapped diffuse and backlight. */
export function strandShadeCPU(o: { T: Vec3; N: Vec3; L: Vec3; V: Vec3; t: number; sheen: number; shift1?: number; shift2?: number;
  exp1?: number; exp2?: number }): { diffuse: number; spec1: number; spec2: number; back: number };
/** The lighting model the fur material uses (subclass of three's PhysicalLightingModel, like impostor.ts's CrownLightingModel). */
export class FurLightingModel /* extends PhysicalLightingModel */ { /* direct(): adds the strand terms; indirect: × cavity */ }
```

Shading (per light; `T` = the strand tangent after lean, i.e. the normalised derivative of the shell offset with respect to `t`, `N` the shell normal, `L` light dir, `V` view dir):
- `T1 = normalize(T + shift1·N)` with `shift1 = −0.1` (towards the root), `T2 = normalize(T + shift2·N)` with `shift2 = +0.1`.
- `spec_i = (sqrt(1 − (T_i·H)²))^exp_i · smoothstep(−0.1, 0, N·L)` with `H = normalize(L + V)`, `exp1 = 80`, `exp2 = 20`. Primary colour: light colour × 0.6 (whitish); secondary: hair colour × light colour (tinted). Both × sheen (the coat's, guard hairs × 1.5).
- `diffuse = max(0, (N·L + 0.35) / 1.35)` (wrap), times the hair colour.
- `back = (1 − t) · pow(max(0, −V·L), 4) · max(0, 1 − |N·L|) · sheen · 0.6` added in the hair colour mixed halfway to warm white (a rim when the sun is behind the animal).
- Indirect (ambient) light × cavity × the existing root darkening `mix(0.5, 1.08, smoothstep(0,1,t))`.

Skin material (`createSkinMaterial`): `aoNode = cavity` (from `regionNodes`); where a region has fur (`furLength > 0`), the skin's colour is the hair colour darkened × 0.6 (dense underfur seen between strands), so gaps never show bare pink skin. Fix the covering relief mapping while here: `COVERINGS` is `['fur', 'scales', 'feathers', 'skin', 'shell', 'slime']`, so the existing `isCells = cov.equal(2).or(cov.equal(4))` gives feathers cells and `cov.equal(1)` gives scales ripples — swap to `cov.equal(1).or(cov.equal(4))` (scales, shell) and ripples for `cov.equal(2)` (feathers); add a CPU helper `reliefKind(covering): 'cells' | 'ripple' | 'grain'` in `material.ts` used by the shader's choice and tested.

- [ ] **Step 1: Failing tests** `tests/skin/fur-light.test.ts`, with `T = (1,0,0)`, `N = (0,1,0)`, `V = (0,1,0)`, `sheen = 1`, `t = 0.5`, sweeping `L = (sin θ, cos θ, 0)` for θ from −80° to 80° in 1° steps:
  - the θ where `spec1` peaks differs from the θ where `spec2` peaks by at least 5° (the lobes are shifted apart), and both peaks are > 0.5;
  - `spec2` is broader: the count of θ with `spec2 > 0.5·max(spec2)` exceeds the count for `spec1`;
  - `diffuse` at `N·L = −0.2` (θ ≈ 101.5°, i.e. `L = (sin 101.5°, cos 101.5°, 0)`) is > 0 (wrap) and is 0 at `N·L = −0.5`;
  - `back` is 0 for `L = V` and > 0 for `L = (0.3, −0.95, 0)` normalised with `V = (0, 1, 0)` replaced by `V = (−0.3, 0.95, 0)` (light behind the strand from the viewer);
  - with `sheen = 0`: `spec1 = spec2 = back = 0` and `diffuse` unchanged. `tests/skin/material.test.ts`: `reliefKind('scales') === 'cells'`, `reliefKind('feathers') === 'ripple'`, `reliefKind('fur') === 'grain'`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. Read `src/plants/impostor.ts` (`CrownLightingModel`) first for the r186 lighting-model pattern and its probe; reuse the same approach and add a probe for any internal you touch.
- [ ] **Step 4:** PASS; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5: Look.** Portraits `t7-<id>` (deer, fox, rabbit, wolf, frog) and one backlit three-quarter: in the lab, put the camera opposite the key light (read the stage's light direction from `__lab.scene`) and shot `t7-fox-backlit`. The coat must show a soft sheen band along the strands, a warm rim when backlit, darker armpits and belly line, no bare skin between strands.
- [ ] **Step 6:** Commit (`feat(skin): strand lighting (two-lobe Kajiya-Kay, wrap, backlight) and cavity shading; scales and feathers get their own relief`).

---

### Task 8: Feather mode

**Files:**
- Modify: `src/skin/fur.ts` (feather branch), `src/skin/coat.ts` (feather cell)
- Test: `tests/skin/coat.test.ts`, `tests/skin/feather.test.ts` (create)

**Interfaces — Produces:**

```ts
// src/skin/coat.ts
/** Feather cell size (m): clamp(0.5 × furLength, 6 mm, 25 mm). */
export function featherCell(furLength: number): number;
/** CPU twin: which feather covers point p (frontmost of its cell and 7 upstream neighbours) and where on it (u along, v across, both 0..1), or null. */
export function featherAtCPU(p: Vec3, groom: Vec3, normal: Vec3, cell: number): { id: number; u: number; v: number } | null;
```

Shader, for regions with covering `feathers` and coat `smooth` (`downy` uses the strand path with its row):
- Only shells with `t ≤ 0.35` draw (the lowest ~4 at 16 shells, ~2 at 8); the skin underneath carries the feather pattern too (Task 7's "hair colour under the fur" becomes the feather colour with the same pattern at `t = 0`).
- Lattice: jittered points at `featherCell` spacing in rest space (`bp`). For a fragment, consider its cell and the 7 cells upstream (offsets in −groom direction, chosen by the signs of the groom's components: the 2×2×2 block towards −groom). A feather with root `c` covers the fragment when, in the frame `(gs, b = n × gs)`, `d = p − c` has `u = d·gs / (1.8·cell) ∈ [0, 1]` and `|d·b| < cell·0.55·sin(π·(0.15 + 0.85u))` (a vane). Among covering feathers take the one whose root is furthest **downstream** (largest `c·gs`): later rows lie on top, like roof tiles.
- Look: shaft line `|v| < 0.04` darker × 0.8; barbs: `0.92 + 0.08·sin(60·(u + |v|·0.5))`; edge lighter × 1.08 near `|v| → 1`; tips lift: on shells `t > 0`, only the feather's outer third (`u > 0.66`) draws, lifted by `t` (relief at the overlaps).
- Lighting: the strand model with `T = gs`, `lean = 0.9`, `exp1 = 120`, sheen 0.6 (glossier).
- Cost guard: the feather branch evaluates 8 hashes per fragment on ≤ 4 shells; measure the duck and hawk in the lab (`__lab.fps()` is meaningless when hidden; instead compare River Bend in Task 9).

- [ ] **Step 1: Failing tests** `tests/skin/feather.test.ts`: `featherCell(0.01) = 0.006`, `featherCell(0.03) = 0.015`, `featherCell(1) = 0.025`; on a flat plane (`normal = +y`, `groom = −z`), sampling a 40 × 40 grid over 5 cells: every sample is covered (no holes), coverage ids change along the groom in ordered rows (the id at a point and at a point 0.3 cell further downstream are either equal or the downstream one's root is further downstream), and `u, v` are in range.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `featherAtCPU` and the shader branch from the same rules (keep constants in one place: `coat.ts` exports `FEATHER = { span: 1.8, width: 0.55, shaft: 0.04 }`). **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Portraits `t8-hawk`, `t8-duck`, `t8-bird` (fixture). Feathers must read as overlapping rows lying tail-wards, not fur and not a grid. Fix row direction, size and contrast until they do.
- [ ] **Step 6:** Commit (`feat(skin): feather mode on the shells: overlapping vanes with shafts, lying tail-wards`).

---

### Task 9: The cast's coats, the fur tune and the frame budget

**Files:**
- Modify: the 8 natives in `src/cast/` (coats), `src/skin/coat.ts` (tuned `COAT_LOOK`), `src/render/quality.ts` (final shell counts)
- Test: `tests/cast/cast.test.ts`

Coats: deer body `sleek`, muzzle `sleek`, tail `soft`; fox body `soft`, tail `shaggy`; rabbit all fur `soft`; wolf body `shaggy`, other fur regions `soft`; duck feathers `smooth`; hawk feathers `smooth` (chest/belly region `downy` if it has one); frog/trout none. Read each native's regions first and assign every fur/feather region.

- [ ] **Step 1: Failing test:** in `tests/cast/cast.test.ts`, every fur or feather region of every native has a non-null `coat` and the specific values above (deer body `sleek`, fox tail `shaggy`, wolf body `shaggy`, duck `smooth`).
- [ ] **Step 2:** FAIL. **Step 3:** Set the coats.
- [ ] **Step 4: Tune by eye.** Portraits `t9-<id>` for all 8 natives and 6 fixtures; adjust `COAT_LOOK` and the shader constants until every coat reads right from the face, three-quarter and side views. Make `.shots/t9-faces.png`, `t9-34.png`, `t9-sides.png` with rows `b3 | t9` (use `tile.py` with `--cols 2`, pairing before/after per creature).
- [ ] **Step 5: Frame budget.** Valley: `await __valley.perf()` three times (High). If River Bend's mean median is more than **0.5 ms** above the Task 1 baseline (fur gets half of the 1 ms budget; post-processing needs the rest), lower `QUALITY.high.furShells` to 12 and remeasure; record both in the ledger.
- [ ] **Step 6:** `npm test`, `tsc`, commit (`feat(cast): coats for the natives; fur look tuned`).

---

### Task 10: `BodyMotion` — spine, girdles, weight and bob for legged bodies

**Files:**
- Create: `src/motion/body.ts`, `tests/motion/body.test.ts`
- Modify: `src/motion/rig.ts` (calls `BodyMotion`; bob moves there), `src/motion/secondary.ts` (the snake `spine` wave only for legless bodies), `src/motion/limbs.ts` (export the torso chain)

**Interfaces — Produces:**

```ts
// src/motion/limbs.ts
/** The torso bones from the root forward (root first), following torso roles; the head is not included. */
export function torsoChain(sk: Skeleton): number[];

// src/motion/body.ts
/** Total sideways spine bend (radians, + = bend to the left) for a turn: ∝ turnRate × min(1, speed/0.3 + 0.3), capped at ±0.35. */
export function spineBend(turnRate: number, speed: number): number;
/** Girdle roll (radians) from one leg pair's swing: the swinging leg's side drops: −side·amp·sin(π·s) while swinging, 0 in stance. side +1 = left. */
export function girdleRoll(side: 1 | -1, swing: boolean, s: number, amp: number): number;
/** Sideways weight shift (m, + = towards the left): towards the side with more stance feet, scaled by hipWidth·k·(1 − min(1, speedFrac/0.35)). */
export function weightShift(stance: { side: number; down: boolean }[], hipWidth: number, k: number, speedFrac: number): number;
/** Vertical bob (m): lowest at mid-stance of the leading stance pair, highest at push-off; amplitude amp. `phases` are each leg's swing/stance state. */
export function gaitBob(phases: { swing: boolean; s: number }[], amp: number): number;
/** Spine flexion (radians, + = arch up / nose down at the front) for bounding gaits from the hind legs' phase. */
export function boundFlex(hindPhase: number, amp: number): number;

export type BodyPose = { pitch: number; roll: number; offsetX: number; bob: number; hipsRoll: number; shouldersRoll: number; bend: number; flex: number; hipsYaw: number };
/** Owns the torso chain of a legged body: computes the gait's contributions to the root and poses the torso bones. */
export class BodyMotion {
  readonly legged: boolean;     // ≥ 2 legs
  readonly torso: number[];     // torsoChain
  readonly hipWidth: number;    // 2 × mean |home.x| of the hind legs (0 when none)
  readonly pose: BodyPose;      // this frame's contributions (read by the neck for stabilisation, Task 11)
  constructor(rig: CreatureRig);
  /** Before the root is placed: returns the root's extra pitch, roll, sideways offset and bob for this frame. */
  gait(dt: number, phases: { swing: boolean; s: number }[]): BodyPose;
  /** After the root is placed: bend, flex and roll the torso bones (front half follows the shoulders). */
  poseTorso(): void;
}
```

Behaviour (amplitudes; `legLen` = rig.legLength, `bounce`/`sway` from the recipe):
- Girdle roll amp: `0.05 · (0.5 + sway)` rad (≈ 2–4°), × `(1 − 0.6·[gallop])`. Hips roll from the hind legs (`!front`; for 2-legged bodies, the legs), shoulders from the front legs. With one torso bone: the root gets `hipsRoll + 0.5·shouldersRoll`.
- Hips yaw: `0.04·sin(2π·phase)` sign by the left hind leg's phase (the hip swings forward with its leg).
- Weight shift `k`: bipeds 0.45, quadrupeds 0.12, others 0.08. Applied as a sideways root offset (in the root's frame, x) eased with `approach(…, 8, dt)`.
- Bob: replaces the rig's `-cos(4π·phase)·amp` (non-hop). Same amplitude as today (`0.02·legLen·(0.5+bounce)·stepping·(gallop ? 2.5 : 1)`); shape from `gaitBob`. Hop keeps today's formula.
- Gallop pitch rock: `0.06·(0.5+bounce)·sin(2π·(phase + 0.25))` rad on the root (gallop only, × stepping).
- Spine: lateral `spineBend(turnRate, speed)` spread evenly over the torso bones after the root (each gets `bend / (n−1)` yaw; with one torso bone nothing here, the neck and tail take it in Task 11). Vertical `boundFlex` in gallop and hop (amp `0.12·(0.5+bounce)`), 0.3 of that in trot, 0 in walk; distributed with alternating sign about the middle bone so the back arches.
- Legless bodies (`legs.length < 2`): `BodyMotion.legged = false`, `gait()` returns zeros, `poseTorso()` does nothing; the snake wave in `secondary.ts` keeps running for them only (`kind === 'spine'` branch gated by `!rig.mech.legged`). Legged bodies no longer get the snake wave.

- [ ] **Step 1: Failing tests** `tests/motion/body.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { boundFlex, gaitBob, girdleRoll, spineBend, weightShift } from '../../src/motion/body';
import { CreatureRig } from '../../src/motion/rig';
import { createCreatureObject } from '../../src/render/creature';
import { blob, quadruped, snake, makeRecipe, P } from '../fixtures/recipes';

const flat = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => -1 };
const deer = CAST.find((c) => c.recipe.id === 'deer')!.recipe;

describe('body mechanics helpers', () => {
  it('bends the spine into the turn, capped', () => {
    expect(spineBend(1, 1)).toBeGreaterThan(0);
    expect(spineBend(-1, 1)).toBeLessThan(0);
    expect(Math.abs(spineBend(50, 5))).toBeLessThanOrEqual(0.35);
    expect(spineBend(0, 2)).toBe(0);
  });
  it('drops the swinging side and is level in stance', () => {
    expect(girdleRoll(1, true, 0.5, 0.05)).toBeCloseTo(-0.05);
    expect(girdleRoll(-1, true, 0.5, 0.05)).toBeCloseTo(0.05);
    expect(girdleRoll(1, false, 0.5, 0.05)).toBe(0);
  });
  it('shifts weight towards the stance side, less when fast', () => {
    const st = [{ side: 1, down: true }, { side: -1, down: false }];
    expect(weightShift(st, 0.2, 0.45, 0)).toBeGreaterThan(0);
    expect(weightShift(st, 0.2, 0.45, 0.5)).toBe(0);
    expect(weightShift([], 0, 0.45, 0)).toBe(0);
  });
  it('bobs within its amplitude and flexes both ways', () => {
    for (let s = 0; s <= 1; s += 0.1) expect(Math.abs(gaitBob([{ swing: false, s }, { swing: true, s }], 0.01))).toBeLessThanOrEqual(0.01 + 1e-9);
    const f = Array.from({ length: 20 }, (_, i) => boundFlex(i / 20, 0.1));
    expect(Math.max(...f)).toBeGreaterThan(0.05);
    expect(Math.min(...f)).toBeLessThan(-0.05);
  });
});

describe('body mechanics in the rig', () => {
  const make = (r: typeof deer) => {
    const body = buildBody(r, [2]), obj = createCreatureObject(body, r, 'low');
    return new CreatureRig(obj, body, r, flat);
  };
  it("rolls the deer's hips a few degrees while walking, both ways", () => {
    const rig = make(deer);
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    const rolls: number[] = [];
    for (let i = 0; i < 240; i++) { rig.update(1 / 60); rolls.push(rig.mech.pose.hipsRoll); }
    const tail = rolls.slice(120);
    expect(Math.max(...tail)).toBeGreaterThan(0.015);
    expect(Math.min(...tail)).toBeLessThan(-0.015);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.1);
  });
  it('no longer slithers a legged torso', () => {
    const rig = make(deer);
    rig.moveTo({ x: 0, y: 0, z: 100 });
    rig.setSpeed(0.2);
    for (let i = 0; i < 120; i++) rig.update(1 / 60);
    // walking straight: the torso bones' yaw stays small (no snake wave)
    for (const k of rig.mech.torso.slice(1)) expect(Math.abs(rig.obj.bones[k].rotation.y)).toBeLessThan(0.05);
  });
  it('stays finite for a blob, a snake and a one-legged body', () => {
    const oneLeg = makeRecipe('oneleg', [P('torso', null, 'torso', 0, [0, 0, 1], 0.3, 0.1, 0.1), P('leg', 'torso', 'leg', 0.5, [0, -1, 0], 0.2, 0.03, 0.02)]);
    for (const r of [blob, snake, oneLeg, quadruped]) {
      const rig = make(r);
      rig.moveTo({ x: 3, y: 0, z: 5 });
      rig.setSpeed(0.6);
      for (let i = 0; i < 120; i++) rig.update(1 / 60);
      expect(Number.isFinite(rig.obj.root.position.x + rig.obj.root.position.y + rig.obj.root.rotation.x + rig.obj.root.rotation.z)).toBe(true);
    }
  });
});
```

(The rig's `BodyMotion` instance is the field **`rig.mech`**: `rig.body` is already the `BodyData`.)

- [ ] **Step 2:** FAIL. **Step 3:** Implement `body.ts`, `torsoChain`, wire into `rig.update` (the root's pitch/roll/position get `mech.gait(...)` added before `root.updateMatrixWorld`, `mech.poseTorso()` right after it and before `secondary.update`), gate the snake wave. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Clips `t10-deer-walk`, `t10-deer-trot`, `t10-deer-gallop`, `t10-biped-walk`, `t10-quadruped-walk`, `t10-snake-walk`; GIFs; compare with `b3-…` (the hips should visibly roll, the gallop arch and stretch, the biped shift its weight; the snake unchanged).
- [ ] **Step 6:** Commit (`feat(motion): spine flex, girdle roll, weight shift and a stance-phased bob for legged bodies`).

---

### Task 11: Head stabilisation, nods, the bird head bob and follow-through

**Files:**
- Modify: `src/motion/secondary.ts` (neck, tail, ears), `src/motion/body.ts` (helpers)
- Test: `tests/motion/body.test.ts`, `tests/motion/secondary.test.ts`

**Interfaces — Produces:**

```ts
// src/motion/body.ts
/** Fraction of the body's gait motion the neck cancels: 0.7 at walk rising to 0.85 at gallop (by speedFrac). */
export function stabiliseShare(speedFrac: number): number;
/** Head nod (radians, + = nose down) as a front foot plants: peaks just after touchdown of either front leg; amp × (1 − speedFrac/0.75), ≥ 0. */
export function headNod(frontPhases: { swing: boolean; s: number }[], amp: number, speedFrac: number): number;
/** Bird head bob: the head's forward offset (m) relative to the body over one step: holds still in the world for 80 % of each step (offset falls linearly from +a to −a) then thrusts forward (rises back to +a). */
export function birdHeadBob(stepPhase: number, a: number): number;
/** A creature that walks on two legs and has feathers (and wings). */
export function isBirdWalker(legCount: number, recipe: Recipe): boolean;
```

Behaviour:
- Stabilisation: in `neck()`, the first neck bone counter-rotates `stabiliseShare·(mech.pose.pitch + gallop pitch rock)` and `share·mech.pose.roll` (girdle roll as seen at the shoulders), and adds `−share·bob / neckLength` pitch to cancel the vertical bob (neck base pivot). Applied before look and graze, so graze/drink still reach the ground.
- Nod: quadrupeds with a neck chain: `headNod(front legs, amp = 0.06 × (neckLength / bodyLength) × 3, speedFrac)` on the head bone's pitch (deer strong, fox mild). Not for birds.
- Bird head bob (walking, `isBirdWalker`): `birdHeadBob(phase × 2 % 1, a)` with `a = 0.25 × stride/2`; ducks (habitat includes water) × 0.4. Realised by pitching the neck base back/forward so the head translates by about the offset (`δpitch ≈ offset / neckLength`, the head bone counter-pitched to keep its level).
- Follow-through: tails get `springStep` on the root's vertical acceleration (pitch) and sideways acceleration (yaw), stiffness 40, damping 7, gain `0.004 / dt²`-normalised so a gallop landing swings the tail ≈ 0.15 rad; ears the same at half gain, added to the twitch.

- [ ] **Step 1: Failing tests.** `body.test.ts`: `birdHeadBob` decreases over `[0, 0.8)` and increases over `[0.8, 1)`, `birdHeadBob(0, a) = a`, continuous at 0.8 and 1; `headNod` is 0 with no front legs, ≥ 0, peaks within 0.15 of a front touchdown; `stabiliseShare(0) = 0.7`, `(1) = 0.85`. `secondary.test.ts` (deer, trot `setSpeed(0.55)`, 3 s on flat ground): over the last 1.5 s, the spread (max − min) of the head bone's world pitch is ≤ 0.5 × the spread of the root's world pitch plus the root's world roll spread (the head is steadier than the body); a duck walking on land shows a head forward offset (head bone world position minus root position, projected on the heading) with a sawtooth spread ≥ 0.5 × `a`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Clips `t11-deer-walk`, `t11-deer-gallop`, `t11-duck-walk`, `t11-bird-walk`, `t11-fox-trot`; GIFs.
- [ ] **Step 6:** Commit (`feat(motion): steady heads, walking nods, a bird's head bob, tails and ears that follow through`).

---

### Task 12: Starts, stops and turns

**Files:**
- Modify: `src/motion/rig.ts` (locomotion, legs), `src/motion/body.ts`
- Test: `tests/motion/body.test.ts` (or create `tests/motion/locomotion.test.ts`)

**Interfaces — Produces:**

```ts
// src/motion/body.ts
/** Anticipation time (s) before setting off: 0.12 + 0.05 × sizeM, clamped to [0.12, 0.25]. */
export function anticipationTime(sizeM: number): number;
/** A damped spring for the settle after stopping (pitch and height); `kick` adds a velocity impulse. */
export class Settle { pitch: number; height: number; kick(speed: number, legLen: number): void; step(dt: number): void }
// CreatureRig gains: headingError (radians, the turn still to make; 0 with no target), accel (m/s², forward), sideAccel (m/s²)
```

Behaviour:
- **Anticipation:** when the wanted speed rises above `0.15·topSpeed` while `speed < 0.05` and the rig is on its feet, start a timer `T = anticipationTime(sizeM)`; while it runs, hold `speed` at 0 and ramp a dip: pitch `+0.09·u` rad (nose down; u = progress 0→1), height `−0.03·legLen·u`; release both over 0.15 s as the speed rises.
- **Acceleration lean:** pitch `+= clamp(0.04·accel / max(1, topSpeed·0.5), −0.08, 0.08)` (nose down speeding up, up braking); roll `+= clamp(−0.02·sideAccel, −0.06, 0.06)` for quadrupeds (bipeds × 2), where `sideAccel = speed·turnRate`. Smoothed with `approach(…, 6, dt)`.
- **Settle:** when `speed` falls below 0.05 having been above `0.25·topSpeed` within the last second, `Settle.kick(prevSpeed, legLen)` gives pitch velocity `+0.6·min(prevSpeed, 4)/4` rad/s and height velocity `−0.05·legLen`; spring stiffness 60, damping 10 (critically-ish damped with one overshoot); added to the root.
- **Squaring up:** replace the "settle the feet under the body, too slowly to notice" lerp: once `stepping < 0.05` for 0.3 s, each leg whose planted foot is farther than `0.25·stride` from its home steps there (a 0.3 s swing arc with lift `0.08·legLen`), one leg at a time in the order of distance (farthest first). Stepping legs use the same IK path as gait swings.
- **Idle re-plant:** standing still and awake, every `8 + 12·rng()` s (seeded from the recipe) one random leg makes a small step (to home + a seeded offset up to `0.08·stride`) and the weight shift eases towards the opposite side for 2 s.
- **Head leads the turn:** with no `look` target, the neck's yaw target adds `clamp(0.6·headingError, −0.6, 0.6)`; the tail's turn spring already counters.

- [ ] **Step 1: Failing tests:** `anticipationTime(0.3)=0.135`, `(10)=0.25`; deer rig at rest, `moveTo` ahead + `setSpeed(0.5)`: speed < 0.01 for the first `anticipationTime − 1 frame`, the root dips (`y` below its rest by ≥ 0.02·legLen) and pitches nose-down (> 0.05) during it, then speed rises; after walking 2 s then `moveTo(null)`, the root pitch overshoots past 0 within 0.3 s and `|settle.pitch| < 0.005` after 0.8 s; a foot planted 0.5 stride off home (set `leg.planted` by hand while standing) is back within 0.1 stride after 1 s, while a foot 0.1 stride off is not moved; turning by 90° the head's yaw relative to the body is ≥ 0.2 rad in the first 0.3 s.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Clips `t12-deer-start-stop`, `t12-deer-turn`, `t12-fox-turn`, `t12-rabbit-start-stop`; GIFs.
- [ ] **Step 6:** Commit (`feat(motion): set off with anticipation, lean with acceleration, settle on stopping, square up the feet, lead turns with the head`).

---

### Task 13: Fliers — wing fold, level flight, banking, take-off and landing

**Files:**
- Modify: `src/motion/secondary.ts` (`flapWings`, tail), `src/motion/rig.ts` (flight attitude, take-off crouch, landing flare, leg reach)
- Test: `tests/motion/flight.test.ts` (create)

**Interfaces — Produces:**

```ts
// src/motion/body.ts (or secondary.ts, exported)
/** The folded wing's direction (creature space, unit) for a wing on `side`: along the back towards the tail, on the back's surface. */
export function foldDirection(torsoDir: Vec3, side: 1 | -1): Vec3; // = normalize(−torsoDir + side·0.15·x̂ + 0.12·up⊥), up⊥ = the component of +y perpendicular to torsoDir
/** The root bone's rest elevation (radians, + = nose up): atan2(d.y, hypot(d.x, d.z)) of bone 0's direction. */
export function restTilt(sk: Skeleton): number;
/** Coordinated-turn bank (radians, negative = left side down): clamp(−0.12·speed·turnRate, −0.7, 0.7). */
export function bankAngle(speed: number, turnRate: number): number;
// CreatureRig gains: phaseOfFlight: 'ground' | 'crouch' | 'air' | 'flare'
```

Behaviour:
- **Fold:** `flapWings` builds the fold quaternion from `restDir → foldDirection(torso bone 0's current direction in creature space, side)`, so the folded wing follows the body's slope. Tips may cross over the tail.
- **Level flight:** while flying, root pitch `+= restTilt × level` (nose down by the rest tilt; `level` eases 0→1 with `wingOpen`), plus the climb pitch as today. On the ground the rest posture stays.
- **Bank:** fliers' roll = `bankAngle(speed, turnRate)` (replaces `−turnRate·0.35`). The tail (if any) yaws `−0.3·turnRate` clamped ±0.3 and pitches `−0.4·climb/ max(1, speed)` clamped ±0.3 while flying.
- **Flap modulation:** flapping when climbing, slow (`speed < 1.5`) or landing; amplitude `0.85 × (1 + 0.3·[climb > 0.3])`, frequency `flapHz × (1 + 0.25·[climb > 0.3])`; gliding (θ = 0.12) when level and fast for 3.5 s of each 6 s, as today.
- **Take-off:** when `wantFly` turns on while on the ground: `crouch` for 0.2 s (root dips `0.15·legLen`, wings half open), then `air` with the climb as today plus an initial `altitude += 0.3·legLen` jump; two strong downstrokes (amplitude × 1.3 for the first 0.5 s).
- **Landing:** when `wantFly` is off and flying: `flare` once `altitude < bodyLength`: root pitch eases to `−min(0.7, 0.7·(1 − altitude/bodyLength))` (nose up), wings spread (`wingOpen` held 1) with braking strokes (frequency × 1.3, amplitude × 0.7 around a raised mean), legs reach forward-down (the tucked first-segment angle eases from +0.9 to −0.5); touchdown as today then the settle (Task 12) kicks with the landing speed.

- [ ] **Step 1: Failing tests** `tests/motion/flight.test.ts` (hawk native and `bird` fixture, flat ground):
  - perched hawk (idle 2 s): each wing tip's world direction from the wing root is within 25° of the body's world direction reversed (bone 0 end→start); same for the `bird` fixture;
  - cruising hawk (`wantFly`, `cruise = 3`, target 100 m ahead, `setSpeed(0.6)`, 6 s): over the last 2 s, bone 0's world elevation stays within ±8°;
  - a hawk turning left in flight has negative root roll; `bankAngle` is capped at 0.7;
  - landing (`wantFly = false` after cruising): at some frame with `altitude < 0.5·bodyLength` the root pitch is < −0.2 (nose up), and it ends on the ground (`flying === false`) within 6 s;
  - take-off: the root dips below its rest height during the first 0.2 s, then `altitude` rises.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Clips `t13-hawk-perch`, `t13-hawk-takeoff`, `t13-hawk-fly`, `t13-hawk-land`, `t13-bird-walk`; GIFs; compare with `b3-hawk-…` (wings folded on the back, level body in flight, flare on landing).
- [ ] **Step 6:** Commit (`feat(motion): wings fold along the back, fliers fly level and bank, take off with a crouch and flare to land`).

---

### Task 14: Swimmers, floaters and slitherers

**Files:**
- Modify: `src/motion/chains.ts` (`swimWave`), `src/motion/secondary.ts` (spine/tail for swimmers and legless bodies, fins, floaters), `src/motion/rig.ts` (floater bob)
- Test: `tests/motion/chains.test.ts`, `tests/motion/swim.test.ts` (create)

**Interfaces — Produces:**

```ts
// src/motion/chains.ts
/**
 * Side-to-side angle for segment i of n of a swimming or slithering body: amplitude grows towards the tail
 * (0.15 + 0.85·((i+1)/n)²), a wave travelling head → tail one body length long.
 */
export function swimWave(i: number, n: number, travel: number, amp: number): number;
/** Tail-beat frequency (Hz) for a swimmer: 1.2 + 2.5 × speed / bodyLength. */
export function beatHz(speed: number, bodyLength: number): number;
```

Behaviour:
- Fish (`swimmer && inWater`): one wave over the spine (if any) and the tail chain, treated as one chain head → tail (spine bones after the root, then tail bones), `travel` advancing at `beatHz`, amp `0.3 × (0.5 + sway)`; the head counter-yaws `−0.3 ×` the first segment's angle; a turn adds a C-bend `clamp(0.25·turnRate, −0.5, 0.5)` spread with the same envelope; side fins (`fin` limbs with side ≠ 0) scull `0.4·sin(2π·1.2t)` when `speed < 0.3·topSpeed`, folding back (pitch `−0.6`, amplitude 0.05) above `0.6·topSpeed`, blended between; centre fins (side 0) follow the wave at their attachment segment.
- Legless land bodies (snake): the slither uses `swimWave` with `travel` from distance as today (amplitude envelope fixes the stiff head).
- Floaters on water (duck): body bob `0.004·sin(2π·0.6t) + 0.002·sin(2π·1.7t + 1)` m and yaw wobble `0.03·sin(2π·0.35t + seed)` rad on the root; paddling alternates per leg (as today; check the phase is opposite per side).
- `undulation` stays for antennae or is removed if nothing else uses it (check with Grep).

- [ ] **Step 1: Failing tests.** `chains.test.ts`: `|swimWave|` peak over a full travel cycle grows with `i` (segment 0 peak < 0.3 × last segment's); `beatHz(0, 1) = 1.2`. `swim.test.ts`: trout in a water ground (`isWater: () => true`, `waterLevelAt: () => 1`), target 50 m ahead, `setSpeed(0.6)`, 3 s: the tail bones' yaw spread exceeds the first spine bone's by ≥ 3×; doubling speed raises the zero-crossing rate of the last tail bone's yaw; duck on water: root y varies by 2–12 mm over 4 s.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Clips `t14-trout-swim`, `t14-duck-float`, `t14-snake-walk`; GIFs.
- [ ] **Step 6:** Commit (`feat(motion): fish swim with a tail-heavy wave and sculling fins, ducks bob, snakes slither with the same wave`).

---

### Task 15: The motion pass — clips, sheets and tuning

**Files:** whatever tuning needs in `src/motion/*` (constants only, with tests updated if a tested value moves).

- [ ] **Step 1:** Record every clip of Task 1's list again as `a3-<id>-<clip>` (same frames), and make for each a two-row strip `motion-<id>-<clip>.png` (`b3` row above, `a3` row below: `tile.py` with `--cols 16` over the 16 before then the 16 after frames) and a side-by-side GIF `motion-<id>-<clip>.gif` (each GIF frame = the before and after frames pasted side by side; extend `tools/gif.py` with `--pair DIR_A_PREFIX DIR_B_PREFIX` or write the pairing in a short script in `tools/`).
- [ ] **Step 2:** Watch each (read the strips; GIFs are for the owner). Fix what looks wrong: feet sliding, a head that jitters, a spine that bends the wrong way, a roll too strong, a flare too late. Re-record what changed.
- [ ] **Step 3:** `npm test`, `tsc`, commit (`feat(motion): tuned from the 3b motion clips` plus the tools change).

---

### Task 16: The post-processing pipeline

**Files:**
- Create: `src/render/post.ts`, `src/render/grade.ts`, `tests/render/grade.test.ts`, `tests/render/post.test.ts`
- Modify: `src/render/renderer.ts`, `src/app/main.ts`, `src/app/dev.ts`, `src/lab/main.ts`, `src/render/snapshot.ts`, `src/render/compile.ts`, `src/render/quality.ts` (`post` per tier)

**Interfaces — Produces:**

```ts
// src/render/grade.ts
export type RGB = [number, number, number];
export type Grade = { warmth: number; tint: number; lift: RGB; gamma: RGB; gain: RGB; contrast: number; saturation: number; vibrance: number; vignette: number };
export const NEUTRAL_GRADE: Grade; // warmth 0, tint 0, lift [0,0,0], gamma [1,1,1], gain [1,1,1], contrast 1, saturation 1, vibrance 0, vignette 0
export const STUDIO_GRADE: Grade;  // NEUTRAL with contrast 1.03, vignette 0.1 (the lab)
/** CPU twin of the grade, for tests: display-referred rgb (0..1) at screen position uv (0..1). */
export function gradeCPU(c: RGB, g: Grade, uv?: [number, number]): RGB;
/** The grade as uniforms (one object per pipeline) and the TSL node applying them to a colour node. */
export function gradeUniforms(g?: Grade): GradeUniforms; export function setGrade(u: GradeUniforms, g: Grade): void;
export function gradeNode(color: Node, u: GradeUniforms): Node;
export function mixGrade(a: Grade, b: Grade, t: number): Grade;

// src/render/post.ts
export type PostSettings = { bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number; samples: number };
export const POST: Record<Tier, PostSettings>; // high: bloom on; medium: bloom on (strength × 0.8); low: bloom off. samples 4 (1 on WebGL2 if MSAA fails)
export type Post = { render(): void; grade: GradeUniforms; setTier(t: Tier): void; dispose(): void };
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, tier: Tier, grade?: Grade): Post;
```

Grade math (exact; `gradeCPU` and `gradeNode` must agree):
1. White balance: `c *= [1 + 0.08·warmth, 1 + 0.04·tint, 1 − 0.08·warmth]`.
2. Lift/gain: `c = gain · (c + lift·(1 − c))`; gamma: `c = c^(1/gamma)` per channel (c clamped ≥ 0 first).
3. Contrast about 0.45: `c = (c − 0.45)·contrast + 0.45`.
4. Saturation/vibrance: `y = 0.2126r + 0.7152g + 0.0722b`, `sat = max − min`, `k = saturation + vibrance·(1 − sat)`, `c = y + (c − y)·k`.
5. Vignette: `c *= 1 − vignette·smoothstep(0.35, 1, 1.4142·|uv − 0.5|)`.
6. Clamp to [0, 1].

Pipeline: `scenePass = pass(scene, camera, { samples })`; `hdr = scenePass.getTextureNode()`; if bloom: `hdr = hdr.add(bloom(hdr, strength, radius, threshold))` (`three/addons/tsl/display/BloomNode.js`); `out = gradeNode(renderOutput(hdr), grade)` (`renderOutput` applies the renderer's tone mapping, exposure and output colour space); `pipeline = new RenderPipeline(renderer, out)` with `outputColorTransform = false`. Start values: threshold 1.0, strength 0.15, radius 0.4 (tuned in Task 17 so only the sun, its glow and glints bloom).

Wiring: the valley's live loop, `compileRest`'s first frame, the dev hooks `shot`, `screen`, `tour`, `perf` (perf times `post.render()` instead of `renderer.render`), the lab's loop, `shot`, `screen`, `portrait`, `clip`, and `snapshot.ts`'s studio render all call `post.render()` (the snapshot builds its own small `Post` for the studio scene or temporarily swaps the pipeline's scene/camera — choose the simpler and document). Direct `renderer.render` stays for impostor bakes, the shadow warm-up and the mirror. `compileTogether` compiles the scene as today; the pipeline's quad materials compile on the first `post.render()` behind the loading screen. The canvas renderer keeps `antialias: true` (harmless) but MSAA now comes from the pass.

Probe: if `RenderPipeline`'s `outputColorTransform` or `renderOutput` is missing in this three build, `probe.ts` warns once and `createPost` falls back to `renderer.render` (no grade, no bloom).

- [ ] **Step 1: Failing tests.** `grade.test.ts`: `gradeCPU(c, NEUTRAL_GRADE)` returns `c` for several colours (within 1e-6); saturation 0 gives grey (r = g = b = luma); warmth > 0 raises red over blue on grey; vignette darkens corners (`uv = [0,0]`) not the centre; `mixGrade(a, b, 0) = a`, `(…, 1) = b`; output stays in [0,1] for extreme settings. `post.test.ts`: `POST.low.bloom === false`, `POST.high.bloom === true`; `POST[tier].samples` is 4 for every tier.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `grade.ts`, `post.ts` and the wiring.
- [ ] **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Browser.** Valley: loads with no console errors (`read_console_messages`), `__valley.shot('t16-noon')` at River Bend noon looks as before apart from bloom on the sun and glints (compare with `b3-v<riverbend>-noon`); fur strands are smooth-edged (alpha-to-coverage under the pass's MSAA). Lab: portrait the fox (`t16-fox`). Perf: `__valley.perf()` three times; record River Bend. If the pipeline alone costs more than 0.5 ms over Task 9's figure, profile (bloom off; samples) and fix before going on.
- [ ] **Step 6:** Commit (`feat(render): a post-processing pipeline (MSAA scene pass, bloom, tone mapping, grade) for the valley and the lab`).

---

### Task 17: The time-of-day grade and the look fixes

**Files:**
- Modify: `src/world/lighting.ts` (grade table, `LightState.grade`), `src/world/sky.ts` (ease the grade; haze colour away from the sun), the flower card tint for lupines (find it: Grep `lupine` in `src/plants`), the hemisphere ground colours in the lighting table if needed
- Test: `tests/world/lighting.test.ts`

**Interfaces — Produces:**

```ts
// src/world/lighting.ts
export type LightState = { /* …as today… */ grade: Grade };
// one Grade per TABLE row (same elevations), interpolated with mixGrade exactly like the other columns
```

Starting grade rows (tune by eye on the contact sheet; all `vignette: 0.15`, `tint: 0`, `gamma: [1,1,1]` unless given):

| elev | warmth | lift | gain | contrast | saturation | vibrance |
|---|---|---|---|---|---|---|
| −18 | 0.25 | [0.025, 0.027, 0.032] | [1, 1, 1] | 1.02 | 0.7 | 0 |
| −8 | 0.2 | [0.02, 0.022, 0.027] | [1, 1, 1] | 1.02 | 0.75 | 0 |
| −3 | 0.1 | [0.012, 0.012, 0.016] | [1, 1, 1] | 1.03 | 0.85 | 0.05 |
| 0 | 0.15 | [0.008, 0.006, 0.006] | [1.02, 1, 0.97] | 1.04 | 0.95 | 0.1 |
| 5 | 0.2 | [0.006, 0.004, 0.004] | [1.03, 1.01, 0.96] | 1.05 | 1.0 | 0.1 |
| 15 | 0.08 | [0, 0, 0.002] | [1.01, 1, 0.99] | 1.04 | 1.0 | 0.12 |
| 40 | 0 | [0, 0, 0] | [1, 1, 1] | 1.04 | 1.0 | 0.12 |
| 65 | 0 | [0, 0, 0] | [1, 1, 1] | 1.04 | 1.0 | 0.12 |

Look fixes (each judged on the sheet against `b3-…`):
- Night: grade rows above; retune the night rows' `exposure` so the valley reads (silhouettes, moonlit meadows) without looking like day.
- Golden-hour haze away from the sun: in `sky.ts`, the haze colour facing away from the sun mixes towards the sky's horizon colour (not the warm fog colour), weighted by `(1 − sunFacing)`; check dawn and golden hour shots.
- Lupines: desaturate their card tint (about 25 %); check the meadow shots.
- Blue cast in shade: balance the lighting table's `ground` (hemisphere ground) colours warmer/neutral and/or the grade lift; check forest shade at noon.
- The fox at dusk: recheck; tune its colours only if still bright.

- [ ] **Step 1: Failing tests:** `lightingAt` returns a `grade` at every hour; the grade is continuous across row boundaries (sample elevations ±0.01° around each row: differences < 1e-3 per field); the −18° row's saturation < 0.8; noon's warmth = 0.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `sky.ts` eases `grade` with the same time constant as the exposure and writes it with `setGrade` (the valley's `Post` is passed to the sky's light function or the loop calls `setGrade(post.grade, sky.grade)` each frame — choose one, no per-frame allocation).
- [ ] **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Sheet.** `__valley.tour('t17')`; tile `valley3b-<time>.png` per time of day with two columns (b3 | t17) per viewpoint; read all four; tune the grade and the fixes until each time of day looks better than before with nothing worse. Tune bloom so only the sun, its glow and glints bloom (sky and snow never haze over).
- [ ] **Step 6:** Commit (`feat(world): a time-of-day grade; night, golden-hour haze, lupines and shade fixed`).

---

### Task 18: Contact shadows under creatures

**Files:**
- Create: `src/render/contact.ts`, `tests/render/contact.test.ts`
- Modify: `src/residents/residents.ts`, `src/lab/main.ts` (and/or `src/render/stage.ts`)

**Interfaces — Produces:**

```ts
// src/render/contact.ts
/** Half-sizes of a creature's ground footprint (m, × 1.15 of its skeleton's x and z extents) and its centre offset. */
export function footprint(sk: Skeleton): { hx: number; hz: number; cx: number; cz: number };
/** Shadow strength: 0.35 on the ground, fading to 0 at one body length up; 0 in water. */
export function contactOpacity(height: number, bodyLength: number, inWater: boolean): number;
export type ContactShadows = { mesh: InstancedMesh; set(i: number, pos: Vector3, normal: Vector3, yaw: number, fp: ReturnType<typeof footprint>, opacity: number): void; hide(i: number): void; dispose(): void };
export function createContactShadows(max: number): ContactShadows;
```

One `InstancedMesh` of a unit quad (−1..1 in x and z) with a `MeshBasicNodeMaterial`: black, `transparent`, `depthWrite = false`, `polygonOffset` (factor −1, units −4), opacity per instance from an `InstancedBufferAttribute` (`opacity`), shape `(1 − smoothstep(0.4, 1, r))²` with `r` the elliptical radius from the quad's uv; `castShadow = receiveShadow = false`; `frustumCulled = false`; `renderOrder` after the ground. Each instance: translated to the ground under the creature's footprint centre (rotated by yaw), tilted to the ground normal (from `heightAt` at three points 0.5·max(hx, hz) apart), scaled by the footprint. Residents set it every frame for animals at LOD0/LOD1 and hide it otherwise; the lab sets one for the shown creature (stage ground is flat).

- [ ] **Step 1: Failing tests:** `footprint` of the deer: `hx < hz`, both > 0; `contactOpacity(0, 1, false) = 0.35`, `(1, 1, false) = 0`, `(0, 1, true) = 0`, monotonic in height; `createContactShadows(4).set(…)` writes the instance matrix (the quad's centre lands at `pos`) and the opacity attribute.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and wire. **Step 4:** PASS; `npm test`; `tsc`.
- [ ] **Step 5: Look.** Valley close-ups like `valley-animals.png` (deer, fox, duck at noon; a deer in forest shade) as `t18-…`; lab portraits `t18-deer-34`, `t18-fox-side`. Animals must look planted, not pasted; no dark square edges, no shadow on fliers in the air, none under the duck on water. Perf: `__valley.perf()`; record River Bend.
- [ ] **Step 6:** Commit (`feat(render): soft contact shadows under creatures`).

---

### Task 19: The designer learns coats — four drawings, once

**Files:** none unless the run shows a prompt problem (then `server/prompts.ts`).

The owner's key is in `.env` (never print or commit it). Cost: about $1–1.50 on Sonnet (16 calls).

- [ ] **Step 1:** Start the dev server with the API (`npm run dev`; the lab's API health check must be 200). Open `/drawingset/` (or the drawing test set page: Grep `drawingset` in `vite.config` / `index` files for its path) and run each of the four rows once (`__drawings.runOne(row)` for each of `__drawings.rows`).
- [ ] **Step 2:** For each result, read the returned recipe's regions: every fur or feather region has a sensible `coat` (the fluffball `soft`/`woolly`/`downy`, the lizard none, the snake's wing puffs feathers or fur with a coat, the turtle none or `sleek` on any fur). Capture each recipe as 3a did (intercept the gallery save of "Open in lab") and portrait them as `after3b-drawing-<n>`.
- [ ] **Step 3:** If a coat is wrong or missing in a way the prompt can fix, adjust the prompt line from Task 5 and rerun only that drawing. Commit any prompt change (`fix(designer): …`).

---

### Task 20: Sheets, final numbers, README and HANDOFF

**Files:** `README.md`, `docs/superpowers/HANDOFF.md`, `src/render/probe.ts` notes (if any), `.shots/*` (gitignored, referenced).

- [ ] **Step 1: Fur sheets.** Final portraits `a3-<id>` for the 8 natives and 6 fixtures; sheets `compare3b-fur-face.png`, `compare3b-fur-34.png`, `compare3b-fur-side.png` (each row before | after, in the order deer, rabbit, fox, wolf, duck, hawk, trout, frog, quadruped, snake, hexapod, blob, biped, bird; `tile.py --cols 2` over interleaved before/after files).
- [ ] **Step 2: Motion.** Task 15's `motion-*.png` and `.gif` are final (re-record any clip touched since).
- [ ] **Step 3: Valley.** `__valley.tour('a3')`; `valley3b-dawn.png`, `-noon`, `-golden`, `-night` (b3 | a3 per viewpoint) and `valley3b-animals.png` (as `valley-animals.png`, after).
- [ ] **Step 4: Numbers.** `npx tsx tools/perf.ts` (every body < 3 s; note the frog); `__valley.perf()` three times (River Bend mean median vs the Task 1 baseline: ≤ +1.0 ms); `npm test` (count), `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 5: README.** A "Fur, motion and the picture" section after "Bodies and faces": the groom and cavity bake, coats (the table of words), the shell shader and feather mode, the strand lighting, the motion layers (body mechanics, starts/stops/turns, fliers, swimmers), the post pipeline and grade, contact shadows, the clip and GIF tools, and the numbers.
- [ ] **Step 6: HANDOFF.** Record 3b as built (not merged), where the sheets are and what the owner should look at, known issues and a 3b backlog (from the ledger's minors), new r186 workarounds with their probes, the roadmap line, and "Next: the owner reviews the 3b sheets; merge on OK; then sub-project 4 (The Living Ecosystem) brainstorm".
- [ ] **Step 7:** Commit (`docs: 3b README section and handoff`).

---

## Self-review notes (for the controller)

- Spec coverage: §2 groom/cavity → Tasks 2–4; §3 coat → Tasks 5, 9; §4 shells → Tasks 6–8; §5 → Tasks 10–11; §6 → Task 12; §7 → Tasks 13–14; §8 → Tasks 16–17; §9 → Tasks 7 (cavity on the creature), 18; §10 → Tasks 1, 15, 20; §11 tests are in each task; designer → Tasks 5, 19; done-when numbers → Tasks 9, 16, 18, 20.
- Order matters: Task 2 must land before 3–4 (attribute), 5 before 6 (coat in the pack), 6 before 7–8, 10 before 11–12, 16 before 17–18.
- Shell count and the frame budget are decided with numbers in Task 9 and rechecked in 16, 18 and 20.
