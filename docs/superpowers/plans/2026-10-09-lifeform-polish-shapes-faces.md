# Lifeform Polish 3a (Shapes and Faces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creature bodies with muscle, joints, paws/hooves/talons and real faces (sockets, brow, cheeks, nose, mouth with a moving jaw, cupped ears, moving eyelids), built from any recipe, at about today's triangle counts and well under 3 s per body.

**Architecture:** The builder keeps its signed-distance body (bones blended with a smooth min) and gains an **anatomy layer** of extra shapes (adds and carves) derived from part roles and two new recipe sections (`build`, `face`). Meshing changes from three uniform grids to **sparse fine sampling** (only near the surface) followed by **importance-weighted quadric simplification**, whose snapshots are LOD0–2. A derived **jaw bone**, separate **eyelid** meshes and a per-vertex **feature** attribute (nose, inner ear, mouth, hoof) make faces move and colour. Motion gains mouth and ear intents.

**Tech Stack:** TypeScript, Vite 8, Vitest 5, three 0.186.1 (`three/webgpu`, `three/tsl`), zod, idb.

## Global Constraints

- Specs: `docs/superpowers/specs/2026-10-09-lifeform-polish-shapes-faces-design.md` (this sub-project), `docs/superpowers/specs/2026-10-06-creature-lab-design.md` (the builder it extends).
- **Creature space:** metres, `+z` forward (towards the head), `+y` up, `+x` the creature's left.
- **Determinism:** `buildBody(recipe)` is pure: same recipe → bit-identical output. No `Math.random`; fixed iteration orders; heap ties broken by vertex/edge index.
- **Build time:** every native and fixture body, all three LODs, main thread (`npx tsx tools/perf.ts`): **under 3 s** each.
- **Triangle budget:** LOD0 ≈ 1.2 × the triangle count today's 110-cell mesher would give the same body; LOD1 ≈ LOD0 / 4; LOD2 ≈ LOD0 / 16.
- **Frame cost:** River Bend (`__valley.perf()`) no more than ~1 ms slower than the baseline recorded in Task 1.
- **WebGPU limits:** at most 8 vertex buffers (the creature geometry uses 7 today; `feature` is the 8th and last) and 12 uniform buffers per shader stage (do not add uniform buffers to the skin material: pack into unused vec4 lanes).
- **TSL rule:** any node used in more than one `If`/`select` branch must be `.toVar()` before the branches.
- **Schema:** `SCHEMA_VERSION = 2`. v1 recipes upgrade through `normalizeRecipe`. The zod schema has no numeric ranges; ranges live in `LIMITS`.
- **Tone:** kid-facing text short and warm. Nothing scary: no teeth, mouths open gently.
- **Git:** branch `feat/lifeform-polish` (already checked out). Never merge to `main` without the owner's OK. Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks before every commit:** `npm test` green and `npx tsc --noEmit` clean.

## File map

```
src/recipe/      schema.ts (v2: build, face), hints.ts (new: inference), normalize.ts (uses hints)
src/cast/        kit.ts (build/face options), the 8 natives (hints + retune)
src/builder/     sparse.ts (new), simplify.ts (new), importance.ts (new), mesher.ts (field variant), sdf.ts (features),
                 build.ts (new pipeline, feature marks, jaw), skeleton.ts (jaw, Skeleton.jaw), weights.ts (jaw skinning),
                 anatomy/shapes.ts, anatomy/body.ts, anatomy/feet.ts, anatomy/face.ts, anatomy/index.ts (all new)
src/skin/        eyes.ts (eyelids), material.ts + fur.ts + patterns.ts (feature attribute, face colours)
src/render/      creature.ts (feature attribute, eyelid tint)
src/motion/      actions.ts (mouth, ears intents), rig.ts (intent fields), secondary.ts (jaw, lids, ears)
src/lab/         gallery.ts (normalise on load, refresh natives), main.ts + ui/workshop.ts (face controls, portrait tool)
server/          prompts.ts (build and face hints)
tools/           perf.ts (triangles, LOD timing)
tests/           mirrors src/
```

---

### Task 1: Portrait tool, baseline shots and baseline numbers

Everything later is judged against "before". This task changes no builder code.

**Files:** modify `src/lab/main.ts` (dev hook), `tools/perf.ts`; create nothing else.

**Interfaces — Produces:**
- `__lab.portrait(recipe: Recipe, prefix: string): Promise<void>` (dev only). Shows the recipe, sets action `idle`, steps 90 frames (`step(90)`), then saves three shots with `shot()`: `${prefix}-face` (camera 2.2 head radii in front of the head bone, 25° to the creature's left, 10° above, looking at the head bone's world position; the head bone is the first bone with role `head`, else the root), `${prefix}-34` (three-quarter from front-left at 2.2 × size, as `show()` frames it), `${prefix}-side` (from +x, same distance). Restores the camera afterwards.
- `tools/perf.ts` prints, per native **and** per fixture recipe (`tests/fixtures/recipes.ts`: quadruped, snake, hexapod, blob, biped, bird): LOD0 ms, all-three ms, triangles per LOD (`indices.length / 3`).

- [ ] **Step 1:** Add `portrait` to the `__lab` dev object in `src/lab/main.ts` (inside `if (import.meta.env.DEV)`), using `show`, `setAction('idle')`, `step`, `shot`, `camera`, `controls`, and `creature.bones` world positions.
- [ ] **Step 2:** Extend `tools/perf.ts` as above (import fixtures from `../tests/fixtures/recipes`).
- [ ] **Step 3:** Run `npx tsx tools/perf.ts`; save its output to `.superpowers/sdd/baseline-perf.txt`.
- [ ] **Step 4:** Start the lab (`preview_start` name `lab`, or `npm run dev` and open `/lab.html`), `resize_window` 1920×1080, then in the console: for each of `__lab.CAST` run `await __lab.portrait(c.recipe, 'before-' + c.recipe.id)`, and for each fixture `await __lab.portrait(__lab.fixtures[name], 'before-' + name)`.
- [ ] **Step 5:** Open the valley (`/`), let it load, run `await __valley.perf()` and record River Bend's median and 90th-percentile ms in `.superpowers/sdd/baseline-perf.txt`.
- [ ] **Step 6:** Tile the face shots: `python tools/tile.py .shots/before-faces.png .shots/before-*-face.png --cols 4`; same for `-34` (`before-34.png`) and `-side`.
- [ ] **Step 7:** `npm test`, `npx tsc --noEmit`, commit (`feat(lab): portrait dev tool; perf tool prints triangles and fixtures`).

---

### Task 2: Recipe v2 — build and face hints

**Files:** modify `src/recipe/schema.ts`, `src/recipe/normalize.ts`, `src/cast/kit.ts`, `src/builder/build.ts` (`bodyKey` only), `src/lab/gallery.ts`, `server/prompts.ts`, `tests/fixtures/recipes.ts`; create `src/recipe/hints.ts`, `tests/recipe/hints.test.ts`; extend `tests/recipe/normalize.test.ts` (or the existing recipe test file) and the gallery test.

**Interfaces — Produces:**

```ts
// src/recipe/schema.ts
export const SCHEMA_VERSION = 2 as const;
export const FEET = ['paws', 'hooves', 'talons', 'webbed', 'plain'] as const;
export const NOSES = ['pad', 'beak', 'bill', 'slits', 'none'] as const;
export const BuildSchema = z.object({
  muscle: z.number().describe('0..1 how defined the body is: 0 soft and smooth (frog, baby, slug), 1 lean and sculpted (deer, wolf)'),
  feet: z.enum(FEET).describe('Shape of foot parts: paws (toe pads), hooves, talons (bird toes), webbed, plain'),
});
export const FaceSchema = z.object({
  nose: z.enum(NOSES).describe('pad (wet dog/cat/rabbit nose), beak (hooked), bill (duck), slits (reptile, frog, fish nostrils), none'),
  noseColor: z.string().nullable().describe('#rrggbb nose colour, or null for a darkened head colour'),
  lids: z.boolean().describe('Has eyelids (false for fish)'),
  earInner: z.string().nullable().describe('#rrggbb colour inside the ears, or null for a lightened ear colour'),
  brow: z.number().describe('0..1 how heavy the brow ridge over the eyes is'),
});
// RecipeSchema gains: build: BuildSchema, face: FaceSchema   (after `skin`)
export type Feet = (typeof FEET)[number]; export type Nose = (typeof NOSES)[number];
export type Build = z.infer<typeof BuildSchema>; export type Face = z.infer<typeof FaceSchema>;
// LIMITS gains: muscle: [0, 1], brow: [0, 1]
// (MAX_PARTS 48 gives at most 1 + 47·2 = 95 bones, so the builder's jaw always fits in MAX_BONES = 96.)

// src/recipe/hints.ts
export type HintInput = Pick<Recipe, 'parts' | 'skin' | 'motion' | 'mind' | 'life'>;
export function headCovering(r: HintInput): Covering;   // covering of the region of the first `head` part, else of parts[0]
export function inferBuild(r: HintInput): Build;
export function inferFace(r: HintInput): Face;
```

Inference rules (exactly these; `cov = headCovering(r)`, `water = r.mind.habitat.includes('water')`, `hasFeet = r.parts.some(p => p.role === 'foot')`, `hasLegs = r.parts.some(p => p.role === 'leg')`):
- `muscle`: fur 0.6, feathers 0.5, skin/scales 0.3, slime/shell 0.15; minus 0.2 when `motion.gait === 'hop'` and the largest torso `max(r0, r1)` is more than 0.25 × `life.sizeM`; clamp to [0, 1].
- `feet`: `!hasFeet` → plain; feathers && water → webbed; feathers → talons; fur && hasLegs && `life.massKg > 30` → hooves; fur → paws; (slime or skin) && water → webbed; else plain.
- `nose`: feathers && water → bill; feathers → beak; fur → pad; skin/scales/slime → slits; shell → none.
- `lids`: `false` when `motion.gait === 'swim'` and `mind.habitat` is exactly `['water']`; else `true`.
- `brow`: 0.5 when `nose === 'beak'`, else 0.3. `noseColor`, `earInner`: null.

`normalizeRecipe`: reads `raw.build` / `raw.face` objects; each missing or invalid field comes from `inferBuild`/`inferFace` on the already-normalised parts/skin/motion/mind/life (push one fix line per section when it was absent: `build missing → inferred`, `face missing → inferred`; per-field fixes as usual otherwise). Clamp `muscle`, `brow` with `LIMITS`; colours via the existing `color()` but `null` stays `null`. `DEFAULT_RECIPE`'s type becomes `Omit<Recipe, 'parts' | 'build' | 'face'>`.

`kit.native()` takes optional `build?: Partial<Build>` and `face?: Partial<Face>` and fills the rest with `inferBuild`/`inferFace`; it writes `schemaVersion: SCHEMA_VERSION`. `tests/fixtures/recipes.ts` `makeRecipe` adds `build: inferBuild(r), face: inferFace(r)`.

`bodyKey(recipe)` = `hash(recipe.parts) + hash(recipe.skin.regions.map(r => r.id)) + hash([recipe.build, recipe.face.nose, recipe.face.brow, recipe.skin.eyes.size])` (eye size now shapes the sockets).

Gallery: `list()` and `get()` return items whose `recipe` went through `normalizeRecipe` (on `RecipeError`, return the item unchanged). `seedNatives` overwrites a stored native when `hash(stored.recipe) !== hash(cast.recipe)` (keeping its `createdAt`).

Designer prompt (`server/prompts.ts`, after the `# Skin` section), add:

```
# Build and face
"build": muscle 0-1 (0 soft and round like a frog or a baby, 1 lean with defined muscles like a deer) and feet: "paws" (toe pads), "hooves", "talons" (bird toes), "webbed" or "plain".
"face": nose "pad" (a wet dog, cat or rabbit nose), "beak", "bill" (a duck's), "slits" (small nostrils, for reptiles, frogs and fish) or "none"; noseColor "#rrggbb" or null; lids true unless it is a fish; earInner "#rrggbb" (the colour inside the ears, often pink or pale) or null; brow 0-1 (how heavy the brow over the eyes is: a hawk's is heavy).
Faces carry a child's creature: give drawn noses, ear colours and feet their shapes here.
```

- [ ] **Step 1: Write failing tests** in `tests/recipe/hints.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inferBuild, inferFace } from '../../src/recipe/hints';
import { CAST } from '../../src/cast';
import { normalizeRecipe } from '../../src/recipe/normalize';
import { MAX_BONES, MAX_PARTS } from '../../src/recipe/schema';
import { quadruped, snake } from '../fixtures/recipes';

const byId = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe;

describe('hint inference', () => {
  it('gives fur animals paws and a pad nose, heavy fur animals hooves', () => {
    expect(inferBuild(byId('fox')).feet).toBe('paws');
    expect(inferFace(byId('fox')).nose).toBe('pad');
    expect(inferBuild(byId('deer')).feet).toBe('hooves');
  });
  it('gives water birds a bill and webbed feet, other birds a beak and talons', () => {
    expect(inferFace(byId('duck')).nose).toBe('bill');
    expect(inferBuild(byId('duck')).feet).toBe('webbed');
    expect(inferFace(byId('hawk')).nose).toBe('beak');
    expect(inferBuild(byId('hawk')).feet).toBe('talons');
  });
  it('gives fish no lids', () => {
    expect(inferFace(byId('trout')).lids).toBe(false);
  });
  it('gives a legless body plain feet', () => {
    expect(inferBuild(snake).feet).toBe('plain');
  });
});

describe('v1 → v2 upgrade', () => {
  it('fills build and face from the body and reports it', () => {
    const v1 = structuredClone(byId('fox')) as Record<string, unknown>;
    delete v1.build; delete v1.face; v1.schemaVersion = 1;
    const { recipe, fixes } = normalizeRecipe(v1);
    expect(recipe.schemaVersion).toBe(2);
    expect(recipe.build.feet).toBe('paws');
    expect(fixes).toContain('build missing → inferred');
  });
  it('keeps given hints and clamps numbers', () => {
    const raw = { ...structuredClone(quadruped), build: { muscle: 3, feet: 'hooves' }, face: { ...inferFace(quadruped), brow: -1 } };
    const { recipe } = normalizeRecipe(raw);
    expect(recipe.build).toEqual({ muscle: 1, feet: 'hooves' });
    expect(recipe.face.brow).toBe(0);
  });
  it('is idempotent on every native', () => {
    for (const { recipe } of CAST) expect(normalizeRecipe(recipe).recipe).toEqual(recipe);
  });
  it('leaves room for the jaw: the most bones a recipe can make is MAX_BONES - 1', () => {
    expect(1 + (MAX_PARTS - 1) * 2).toBeLessThanOrEqual(MAX_BONES - 1);
  });
});
```

Add a gallery test (in the existing gallery/lab test file, with `fake-indexeddb/auto`): saving an item whose recipe lacks `build`/`face` and reading it back with `get()` returns a v2 recipe; `seedNatives` replaces a stored native whose recipe differs.

- [ ] **Step 2:** Run `npx vitest run tests/recipe` — fails (no `hints.ts`).
- [ ] **Step 3:** Implement schema, hints, normalize, kit, fixtures, `bodyKey`, gallery, prompt as specified.
- [ ] **Step 4:** `npm test` (fix every test that constructs recipes by hand) and `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(recipe): schema v2 with build and face hints, inferred for v1 recipes`.

---

### Task 3: Sparse fine sampling

**Files:** create `src/builder/sparse.ts`, `tests/builder/sparse.test.ts`; modify `src/builder/mesher.ts`.

**Interfaces — Produces:**

```ts
// src/builder/sparse.ts
/** Samples of an SDF on a fine grid, stored only in blocks near the surface. */
export type SparseField = {
  origin: Vec3; cell: number; dims: [number, number, number]; // fine samples per axis
  block: number;                       // fine cells per block edge (4)
  blocks: Int32Array;                  // active block ids (bx + by*bnx + bz*bnx*bny), ascending
  value(i: number, j: number, k: number): number; // fine sample; outside active blocks, the coarse value at that block's origin
  evaluations: number;                 // SDF calls made
};
export function sampleSparse(sdf: Sdf, min: Vec3, max: Vec3, cell: number, block = 4): SparseField;

// src/builder/mesher.ts (added; surfaceNets keeps working as before)
/** Surface nets over a sparse field: only fine cells inside active blocks; no normals (positions + indices). */
export function surfaceNetsSparse(f: SparseField): { positions: Float32Array; indices: Uint32Array };
```

Algorithm (`sampleSparse`):
1. Pad `min`/`max` by 2 coarse cells (`C = cell * block`). Coarse lattice: `bn = ceil(extent / C) + 1` per axis; evaluate the SDF at every coarse corner.
2. A block (coarse cell) is **near** when any of its 8 corners has `|d| < 1.5 * C * √3`. Active = near blocks dilated by 1 block in every direction (26-neighbourhood), clipped to the lattice.
3. For each active block (ascending id), evaluate its `block³` fine samples (local offsets 0…block−1 per axis; the sample at offset `block` belongs to the next block). Store in a `Float32Array` pool, `blockSlot: Int32Array` (−1 = inactive) maps block id → slot.
4. `value(i,j,k)`: block `(i/block|0, …)`; if active, the pool sample; else the coarse corner value at that block's origin (correct sign: inactive blocks are far from the surface).

`surfaceNetsSparse`: identical maths to `surfaceNets` (vertex = average of edge crossings; one quad per sign-changing edge; same winding), iterating fine cells only inside active blocks, in ascending block then `k, j, i` order. Per-cell vertex ids live in an `Int32Array` per active block (`block³`, −1 = none). Edge quads join the 4 cells around the edge; skip if any lacks a vertex.

- [ ] **Step 1: Failing tests** `tests/builder/sparse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sampleSparse } from '../../src/builder/sparse';
import { surfaceNets, surfaceNetsSparse } from '../../src/builder/mesher';
import { v3 } from '../../src/util/vec';

const sphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 0.8;
const capsules = (x: number, y: number, z: number) =>
  Math.min(Math.hypot(x, y - Math.max(-0.5, Math.min(0.5, y)), z) - 0.2, Math.hypot(x - 0.4, y, z) - 0.3);

describe('sparse sampling', () => {
  it('meshes the same surface as a dense grid', () => {
    for (const f of [sphere, capsules]) {
      const dense = surfaceNets(f, v3(-1, -1, -1), v3(1, 1, 1), 0.02);
      const sparse = surfaceNetsSparse(sampleSparse(f, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
      expect(sparse.positions.length).toBe(dense.positions.length);
      expect(sparse.indices.length).toBe(dense.indices.length);
    }
  });
  it('evaluates far fewer samples than a dense grid', () => {
    const s = sampleSparse(sphere, v3(-1, -1, -1), v3(1, 1, 1), 0.01);
    expect(s.evaluations).toBeLessThan(0.25 * 200 ** 3);
  });
  it('is closed: every edge has two triangles', () => {
    const m = surfaceNetsSparse(sampleSparse(capsules, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
    const count = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    expect([...count.values()].every((c) => c === 2)).toBe(true);
  });
});
```

(The dense/sparse comparison holds because the padded origins coincide; if the padding differs, align `sampleSparse`'s origin to `min - 2*C` and call `surfaceNets` in the test with the same padded bounds. Positions may differ in order; compare sorted rounded positions if the counts match but the order doesn't.)

- [ ] **Step 2:** Run — fails. **Step 3:** Implement. **Step 4:** Tests pass; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(builder): sparse fine sampling and surface nets over it`.

---

### Task 4: Importance-weighted quadric simplification

**Files:** create `src/builder/simplify.ts`, `tests/builder/simplify.test.ts`.

**Interfaces — Produces:**

```ts
export type SimplifyInput = { positions: Float32Array; indices: Uint32Array; weight: Float32Array /* per vertex, ≥ 1 */ };
export type Snapshot = { positions: Float32Array; indices: Uint32Array; source: Uint32Array /* input vertex each output vertex kept */ };
export type Simplifier = {
  readonly triangles: number;                 // live triangles now
  collapseTo(target: number): void;           // collapse until triangles ≤ target or no legal collapse is left
  snapshot(): Snapshot;                       // compacted copy of the current mesh
};
export function createSimplifier(input: SimplifyInput): Simplifier;
```

Algorithm (Garland–Heckbert):
- Per-vertex quadric `Q_v = w_v · Σ_{faces f ∋ v} area_f · K_f` (10 floats, `K_f` the plane quadric). Store in a `Float64Array(n*10)`.
- Edges: unique `(a < b)` from the faces. Cost of an edge: evaluate `Q_a + Q_b` at `a`, `b`, the midpoint, and the optimum (solve the 3×3 system when `|det| > 1e-12 · scale`); take the cheapest; store the position.
- A binary min-heap over `(cost, edgeId)` with tie-break by `edgeId`; entries carry a version stamp; stale entries are skipped.
- Collapse `b` into `a` (the lower id survives, so results are order-independent of the heap's internals):
  - **Link condition:** the vertices adjacent to both `a` and `b` must be exactly the third vertices of the faces containing both; otherwise reject.
  - **No flips:** for every live face around `a` or `b` that survives, the normal after the move must have `dot(old, new) > 0.2` and non-zero area; otherwise reject.
  - Rejected edges are not re-pushed until one of their endpoints changes.
  - On accept: move `a`, `Q_a += Q_b`, `w_a = max(w_a, w_b)`, kill the (usually two) shared faces, repoint `b`'s faces to `a`, recompute and re-push the edges around `a`.
- Adjacency: per-vertex arrays of face ids (plain JS arrays are fine at ~200k faces).
- `snapshot()` renumbers live vertices in ascending input id, rebuilds the index list in ascending face id.

- [ ] **Step 1: Failing tests** `tests/builder/simplify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSimplifier } from '../../src/builder/simplify';
import { sampleSparse } from '../../src/builder/sparse';
import { surfaceNetsSparse } from '../../src/builder/mesher';
import { v3 } from '../../src/util/vec';

const sphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 0.8;
const mesh = () => surfaceNetsSparse(sampleSparse(sphere, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
const closed = (idx: Uint32Array) => {
  const c = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c.values()].every((n) => n === 2);
};

describe('simplify', () => {
  it('reaches its budget, stays closed and stays on the sphere', () => {
    const m = mesh();
    const s = createSimplifier({ ...m, weight: new Float32Array(m.positions.length / 3).fill(1) });
    s.collapseTo(2000);
    const out = s.snapshot();
    expect(out.indices.length / 3).toBeLessThanOrEqual(2000);
    expect(out.indices.length / 3).toBeGreaterThan(1800);
    expect(closed(out.indices)).toBe(true);
    for (let i = 0; i < out.positions.length; i += 3)
      expect(Math.abs(Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]) - 0.8)).toBeLessThan(0.02);
  });
  it('keeps more vertices where the weight is high', () => {
    const m = mesh();
    const n = m.positions.length / 3;
    const weight = new Float32Array(n).map((_, v) => (m.positions[v * 3 + 2] > 0.4 ? 8 : 1)); // the "face" cap at +z
    const s = createSimplifier({ ...m, weight });
    s.collapseTo(1500);
    const out = s.snapshot();
    let cap = 0;
    for (let i = 2; i < out.positions.length; i += 3) if (out.positions[i] > 0.4) cap++;
    const capArea = 2 * Math.PI * 0.8 * (0.8 - 0.4) / (4 * Math.PI * 0.8 * 0.8); // the cap's share of the sphere
    expect(cap / (out.positions.length / 3)).toBeGreaterThan(2 * capArea);
  });
  it('is deterministic and supports successive snapshots', () => {
    const run = () => {
      const m = mesh();
      const s = createSimplifier({ ...m, weight: new Float32Array(m.positions.length / 3).fill(1) });
      s.collapseTo(4000); const a = s.snapshot();
      s.collapseTo(1000); const b = s.snapshot();
      return [a, b];
    };
    const [a1, b1] = run(), [a2, b2] = run();
    expect(a1.positions).toEqual(a2.positions);
    expect(b1.indices).toEqual(b2.indices);
    expect(b1.indices.length).toBeLessThan(a1.indices.length);
  });
});
```

- [ ] **Step 2:** Run — fails. **Step 3:** Implement. **Step 4:** Pass; time the 2000-triangle case (should be well under 1 s; note it in the report).
- [ ] **Step 5:** Commit `feat(builder): importance-weighted quadric simplification`.

---

### Task 5: The new meshing pipeline in `buildBody`

**Files:** create `src/builder/importance.ts`, `tests/builder/importance.test.ts`; modify `src/builder/build.ts`, `tests/builder/build.test.ts`, `tools/perf.ts` (if needed).

**Interfaces:**
- Consumes: `sampleSparse`, `surfaceNetsSparse` (Task 3), `createSimplifier` (Task 4), `bodySdf`, `skinWeights`.
- Produces:

```ts
// src/builder/build.ts
/** Fine sampling: cells along the creature's longest dimension (only near the surface). */
export const FINE_CELLS = 330;
/** LOD0 budget relative to today's 110-cell mesh; LOD1 and LOD2 are ¼ and 1/16 of LOD0. */
export const LOD0_CELLS = 110, LOD0_BUDGET = 1.2;
// LodMesh, BodyData unchanged in shape (Task 9 adds `feature`)

// src/builder/importance.ts
/** How much detail each vertex deserves (≥ 1): faces most, then feet and joints. */
export function importance(sk: Skeleton, positions: Float32Array): Float32Array;
export const ROLE_IMPORTANCE: Record<Role, number>; // head 6, mouth 8, eye 8, ear 5, foot 3, horn 2, antenna 2, neck 1.5, leg 1.5, others 1
```

Pipeline:
1. `fine = longest / FINE_CELLS`; `field = sampleSparse(sdf, min, max, fine)`; `raw = surfaceNetsSparse(field)`.
2. `weight = importance(skeleton, raw.positions)`: per vertex, the role of the nearest bone (smallest `boneSdf`, eyes included) gives `ROLE_IMPORTANCE[role]`; leg bones get +1.5 within one radius of either end (joints).
3. Budget: `area ≈ rawVertexCount · fine²`; `lod0Tris = round(LOD0_BUDGET · 2 · area / (longest / LOD0_CELLS)²)`; LOD1 `lod0Tris / 4`, LOD2 `lod0Tris / 16`.
4. One simplifier; for each requested LOD in ascending order: `collapseTo(budget)`, `snapshot()`.
5. Per snapshot: **snap** each vertex to the surface with one Newton step (`p -= d · ∇d / |∇d|²`, gradient by central differences with `h = fine / 2`), normals = normalised gradient at the snapped point, then `skinWeights` as now.
6. `buildBody(recipe, lods)` keeps its signature; requesting only `[2]` still runs the chain down to LOD2 (snapshots only what is asked).
7. Remove `LOD_CELLS` (update its users: `tools/perf.ts`, tests).

Tests:
- Update `tests/builder/build.test.ts` "makes three levels of detail, each closed": LOD triangle counts decrease (LOD1 ≈ ¼ LOD0 ± 30%, LOD2 ≈ 1/16 ± 40%), each LOD closed (every edge in exactly two triangles).
- New: "the face is denser than the flank": fox LOD0, count vertices whose nearest bone is `head`/`mouth` vs `torso`, divide by each group's surface area (sum of incident triangle areas / 3); face density > 2.5 × torso density.
- New: "LOD0 stays near today's budget": fox LOD0 triangles within ±25% of `1.2 × 2 × 9560` (today's fox had 9560 vertices at 110 cells).
- `tests/builder/importance.test.ts`: a vertex at the fox's nose tip weighs 8; one on the hips weighs 1; one at a knee weighs ≥ 2.5.
- "is deterministic" keeps passing.

- [ ] **Step 1:** Write the tests above (failing). **Step 2:** Run — fail.
- [ ] **Step 3:** Implement. **Step 4:** `npm test`; `npx tsx tools/perf.ts` → every body under 3 s (all three LODs). If any is over, first profile (sampling vs simplification vs skinning), then lower `FINE_CELLS` to 280; report the numbers either way.
- [ ] **Step 5:** Lab check: `preview_start` `lab`, `__lab.portrait` the fox as `t5-fox`; look at the shot (the body should look like before, just cleaner); check LOD 1 and 2 in the workshop.
- [ ] **Step 6:** Commit `feat(builder): sparse fine meshing simplified by importance into LOD0-2`.

---

### Task 6: Anatomy layer foundation and body rules

**Files:** create `src/builder/anatomy/shapes.ts`, `src/builder/anatomy/body.ts`, `src/builder/anatomy/index.ts`, `tests/builder/anatomy.test.ts`; modify `src/builder/sdf.ts`, `src/builder/build.ts`.

**Interfaces — Produces:**

```ts
// src/builder/anatomy/shapes.ts
export type Mark = 'nose' | 'earInner' | 'mouth' | 'hoof';
export type Shape =
  | { type: 'ellipsoid'; c: Vec3; ax: [Vec3, Vec3, Vec3] /* orthonormal */; r: Vec3 /* radius along each axis */ }
  | { type: 'cone'; a: Vec3; b: Vec3; r0: number; r1: number };   // round cone, as the bones
export type Feature = {
  op: 'add' | 'carve' | 'mark';       // mark: changes no shape, only colours (Task 9)
  shape: Shape;
  k: number;                          // blend radius (smooth union / smooth subtraction)
  mark?: Mark; markBand?: number;     // vertices within markBand of the shape's surface get the mark
  facing?: Vec3;                      // earInner only: the ear's front axis (marks only front-facing vertices)
  min: Vec3; max: Vec3;               // reach box (shape bounds + k + margin)
};
export function shapeSdf(p: Vec3, s: Shape): number;          // ellipsoid: IQ's bound  k0*(k0-1)/k1; cone: roundCone
export function feature(op: Feature['op'], shape: Shape, k: number, extra?: { mark?: Mark; markBand?: number }): Feature; // computes min/max
export type Frame = { a: Vec3; up: Vec3; side: Vec3 };           // along the bone, up (world up made ⟂), side = cross(up, a)
export function boneFrame(b: BoneDef): Frame;
export function smax(a: number, b: number, k: number): number;   // -smin(-a, -b, k)

// src/builder/anatomy/index.ts
export type Detail = { cell: number };                            // the fine cell size (skip features smaller than ~2 cells)
export type Anatomy = { features: Feature[]; slim: Float32Array /* per bone radius scale */ };
export function anatomy(sk: Skeleton, recipe: Pick<Recipe, 'build' | 'face' | 'skin'>, detail: Detail): Anatomy;

// src/builder/anatomy/body.ts
export function bodyFeatures(sk: Skeleton, build: Build, detail: Detail): Feature[];
export function slimLowerLegs(sk: Skeleton, build: Build): Float32Array;

// src/builder/sdf.ts
export function bodySdf(sk: Skeleton, anat?: Anatomy, margin = 0.03): Sdf;
```

`bodySdf` order: bones blended as today (each bone's `r0`/`r1` multiplied by `anat.slim[i]`), then every `add` feature (`d = smin(d, f, k)`), then every `carve` (`d = smax(d, -f, k)`); `mark` features are ignored. Reach boxes skip features exactly as bones are skipped (outside the box an add cannot lower `d`; a carve outside its box cannot raise it).

Body rules (`m = build.muscle`; skip all muscle shapes when `m < 0.05`; `r` = the bone's larger radius; "outward" = `+x` for bones with `start.x > 0`, `−x` for `< 0`; centre-line bones get no outward push):
1. **Upper-leg muscle** — every `leg` bone whose parent is `torso`. Hind if its start `z` is behind the torso chain's middle (mean of torso bone midpoints), else front. Ellipsoid along the bone frame:
   - hind (haunch): centre `lerp(start, end, 0.25) + outward·0.2r + up·0.15r − z·0.15r`; radii along `0.42·len`, side `r·(0.85 + 0.35m)`, front/back `r·(1.0 + 0.4m)`; `k = 0.5r`.
   - front (shoulder/upper arm): centre `lerp(start, end, 0.18) + outward·0.15r`; radii along `0.38·len`, side `r·(0.75 + 0.25m)`, front/back `r·(0.95 + 0.3m)`; `k = 0.45r`.
2. **Joint knob** — every `leg` bone whose parent is `leg`: sphere (ellipsoid with equal radii) at `start`, radius `max(parent.r1, r0)·(1.0 + 0.15m)`, `k = 0.3·radius`.
3. **Slim lower legs** — `slimLowerLegs`: bones with role `leg` whose parent is `leg` get scale `1 − 0.12m`; everything else 1.
4. **Ribcage** — the torso bone with the largest end `z`: centre `lerp(start, end, 0.55) + up·0.05r`, radii along `0.45·len`, side `r·(1.05 + 0.08m)`, up `r·(1.0 + 0.05m)`, `k = 0.4r`. Skip when the skeleton has no `leg` bones (legless bodies).
5. **Belly tuck** — needs ≥ 2 leg chains: the torso bone with the smallest start `z`; carve ellipsoid at `lerp(start, end, 0.7) − up·1.25r`, radii along `0.3·len`, side `0.9r`, up `0.45r·(0.5 + m)`, `k = 0.35r`.
6. **Shoulder blades** — exactly 4 leg chains: for each front upper leg, ellipsoid at `leg.start + up·0.9·torsoR + outward·0.35·torsoR` (torsoR = the parent torso's larger radius), radii along-body `0.35·torsoR`, side `0.15·torsoR`, up `0.25·torsoR`, scaled by `m`, `k = 0.3·torsoR`.
7. **Neck** — every `neck` bone: crest = cone from `start + up·0.55r0` to `end + up·0.55r1`, radii `0.4r0·m`, `0.4r1·m`, `k = 0.5r`; throat = cone from `start − up·0.5r0` to `end − up·0.5r1`, radii `0.35r0`, `0.3r1`, `k = 0.5r`.

Tests (`tests/builder/anatomy.test.ts`), using `buildSkeleton` on fixtures and natives:
- A fox's hind thigh gets one haunch feature whose centre is behind and outward of the thigh's start; a front leg gets a shoulder feature.
- A quadruped fixture's knees get knobs (one per leg-leg joint).
- `muscle = 0` gives no muscle shapes (joint knobs remain).
- The snake fixture and the blob get no leg or belly features (and no crash); the hexapod gets no shoulder blades.
- `bodySdf` with features is ≤ the plain `bodySdf` at a point inside a haunch (adds only lower `d` there) and ≥ it inside the belly tuck.
- `anatomy()` is deterministic (`toEqual` on two calls).

- [ ] **Step 1:** Tests (failing). **Step 2:** Run. **Step 3:** Implement, wire into `buildBody` (`bodySdf(skeleton, anatomy(skeleton, recipe, { cell: fine }))`; `importance` is unchanged). **Step 4:** `npm test`, `npx tsx tools/perf.ts` (still under 3 s).
- [ ] **Step 5:** Portraits of fox, deer, wolf, rabbit as `t6-*`; compare with `before-*`; tune the numbers above if a shape reads wrong (note any change in the report).
- [ ] **Step 6:** Commit `feat(builder): anatomy layer with muscles, joints, ribcage, belly and neck`.

---

### Task 7: Feet

**Files:** create `src/builder/anatomy/feet.ts`; modify `src/builder/anatomy/index.ts`, `src/builder/sdf.ts` (`blendFor` for hooves); extend `tests/builder/anatomy.test.ts`.

**Interfaces — Produces:** `export function footFeatures(sk: Skeleton, build: Build, detail: Detail): Feature[]`; `blendFor(role, feet?)` returns 0.05 for `foot` when `feet === 'hooves'`.

Rules, for every `foot` bone `f` (frame `a, up, side`; `rf = max(f.r0, f.r1)`; `L = f.length`):
- **paws:** four toe pads, ellipsoids centred at `end − a·0.25rf − up·0.3rf + side·s·rf` for `s ∈ {−0.6, −0.2, 0.2, 0.6}`, radii along `0.45rf`, side `0.3rf`, up `0.32rf`, add, `k = 0.12rf`; three carved grooves between them: cones from `end − a·0.6rf` to `end + a·0.2rf` at `side·{−0.4, 0, 0.4}·rf − up·0.1rf`, radius `max(0.06rf, detail.cell)`, `k = 0.05rf`. Skip the grooves when `0.06rf < detail.cell`.
- **hooves:** carve the split: cone from `lerp(start, end, 0.55) − up·0.2rf` to `end + a·0.1rf − up·0.2rf`, radius `max(0.08rf, detail.cell)`, `k = 0.04rf` (skip when `0.08rf < detail.cell`); a `mark` feature `hoof` = the foot bone's own cone grown by `0.1rf`, `markBand = 0.3rf`.
- **talons:** three forward toes and one back: toe length `T = max(L, 2.5rf)`; forward toes are cones from `end` towards `a` rotated about `up` by `−28°, 0°, +28°`, then tilted down 10°, length `T`, radii `0.38rf` → `0.07rf` (pointed); back toe towards `−a` tilted down 15°, length `0.6T`; add, `k = 0.15rf`.
- **webbed:** the same three forward toes, unpointed (`0.3rf` → `0.2rf`), plus a web: ellipsoid centred `end + a·0.5T − up·0.1rf`, axes (`a`, `side`, `up`), radii `0.5T`, `0.75T`, `max(0.06rf, detail.cell)`; add, `k = 0.1rf`.
- **plain:** nothing.

Tests: the deer's 4 feet get a split each and a hoof mark; the hawk gets 4 toes per foot; the duck has webs; the snake fixture and `plain` produce nothing; tiny feet (scale a fox recipe to `sizeM` 0.05 by scaling parts) skip grooves.

- [ ] Steps: failing tests → implement → `npm test` + perf → portraits `t7-deer`, `t7-hawk`, `t7-duck`, `t7-fox` (feet visible in the side shot) → commit `feat(builder): paws, hooves, talons and webbed feet`.

---

### Task 8: Faces — skull, brow, sockets, cheeks, muzzle, nose, mouth and ears

**Files:** create `src/builder/anatomy/face.ts`, `tests/builder/face.test.ts`; modify `src/builder/anatomy/index.ts`.

**Interfaces — Produces:**

```ts
/** Where the mouth opens: the hinge (mouth corners' midpoint), the tip, and the slit's plane. */
export type MouthFrame = { hinge: Vec3; tip: Vec3; forward: Vec3; up: Vec3; side: Vec3; halfThick: number; head: number /* head bone */; mouth: number /* front mouth bone or -1 */ };
export function mouthFrame(sk: Skeleton, face: Face, detail: Detail): MouthFrame | null;   // null when there is no head bone
export function faceFeatures(sk: Skeleton, recipe: Pick<Recipe, 'build' | 'face' | 'skin'>, detail: Detail): Feature[];
// Anatomy gains: mouth: MouthFrame | null
```

Definitions: `H` = the first `head` bone (none → no face features, `mouthFrame` null). `rH = max(H.r0, H.r1)`, head frame from `boneFrame(H)`. `M` = among `mouth` bones that descend from `H`, the one with the largest end `z` (−1 if none). Tip `T` = `M.end` if `M` exists, else `H.end`; `rn = max(M.r1, 0.35·M.r0)` (or `0.35rH` without `M`). Eyes `E`: `eye` bones whose ancestor chain contains `H`; for each, the eyeball centre `c = E.start + dirE·len/2` and radius `re = max(E.r0, E.r1)·skin.eyes.size` (exactly as `src/skin/eyes.ts` places them); `out` = `dirE`.

Features:
1. **Cranium** (always): ellipsoid at `lerp(H.start, H.end, 0.3) + up·0.25rH`, radii along `0.45·len_H`, side `0.85rH`, up `0.75rH`; add, `k = 0.5rH`.
2. **Socket** per eye: carve sphere at `c + out·0.35re`, radius `1.2re`, `k = 0.4re`. (The eyeball fills it; the lids in Task 11 sit in it.)
3. **Brow** per eye: ellipsoid at `c + up·1.0re + out·0.15re`, radii side `1.2re`, up `0.35re·(0.5 + brow)`, out `0.45re·(0.5 + brow)`; add, `k = 0.3re`. Skip when `brow < 0.05`.
4. **Cheek** per eye (only `pad`, `slits`, `none` noses — not beaks or bills): ellipsoid at `c − up·1.2re − a·0.5re − out·0.3re`, radii `1.3re`, `0.9re`, `0.8re`, scaled by `0.6 + 0.4·muscle`; add, `k = 0.6re`.
5. **Muzzle crease** (`pad` only, when `M` exists): carve cone from (each side) `c − up·0.6re + a·0.6re` to `T − a·0.5rn + up·0.4rn + side·±0.5rn`, radius `max(0.05·M.r0, detail.cell)`, `k = 0.04·M.r0`. Skip when `0.05·M.r0 < detail.cell`.
6. **Nose** by `face.nose`:
   - `pad`: ellipsoid at `T + up·0.2rn`, radii side `0.85rn`, up `0.6rn`, along `0.55rn`; add, `k = 0.3rn`, mark `nose`, `markBand = 0.25rn`. Nostrils: carve spheres at `T + a·0.35rn ± side·0.38rn + up·0.15rn`, radius `0.2rn`, `k = 0.08rn`, mark `nose` (skip if `0.2rn < 1.5·detail.cell`). Groove: carve cone `T − up·0.15rn + a·0.3rn` → `T − up·0.8rn + a·0.2rn`, radius `max(0.07rn, detail.cell)` (skip if `0.07rn < 0.7·detail.cell`).
   - `beak`: hook = cone from `T − a·0.2rn` to `T + a·0.6rn − up·0.9rn`, radii `0.45rn` → `0.06rn`; add, `k = 0.2rn`. Nostrils: carve spheres at `M.start + a·0.3·len_M + up·0.6·M.r0 ± side·0.4·M.r0`, radius `0.12·M.r0` (skip if below `1.5·cell`).
   - `bill`: ellipsoid at `lerp(M.start, M.end, 0.6)`, axes `a, side, up`, radii `0.55·len_M`, `1.25·max(M.r0, M.r1)`, `0.35·max(M.r0, M.r1)`; add, `k = 0.3·M.r0`. Nostrils as for `beak`.
   - `slits`: two carve cones at the top of the tip, `T + up·0.4rn ± side·0.3rn` → same `+ a·0.25rn`, radius `max(0.08rn, detail.cell)` (skip if `0.08rn < 0.7·cell`).
   - `none`: nothing.
7. **Mouth slit** (always, when `mouthFrame` is not null): `mouthFrame` sets `forward = a_M` (or the head's `a`), `up`/`side` from the head frame; `tip` = `T − up·0.35rn` for `pad`/`slits`/`none`, `T` for `beak`/`bill` (the mandibles meet on the axis); `hinge` = the point on the head's centre plane below the eyes: `lerp(H.start, H.end, 0.55) − up·0.3rH` with `x = 0` (for heads without eyes use the same); `halfThick = max(0.035·rM, 1.1·detail.cell)` (`rM = max(M.r0, M.r1)`, or `rH`). The carve is an ellipsoid centred at `lerp(hinge, tip, 0.5) + forward·0.15·|tip − hinge|`, axes `forward, side, up`, radii `0.62·|tip − hinge|`, `1.4·max(rM, rH·0.8)`, `halfThick`; `k = 0.5·halfThick`; mark `mouth`, `markBand = 3·halfThick`.
8. **Ear cup** per `ear` bone with `squash < 0.8`: `t = thinAxis(E)` (its front face); `rmid = (r0 + r1)/2`; `hth = rmid·squash`; if `hth < 1.5·detail.cell` → only a `mark` feature `earInner` (the ear's own cone, `markBand = hth`, so the whole front shows the colour — weight it by `dot(normal, t) > 0` later in Task 9). Otherwise carve ellipsoid at `lerp(start, end, 0.5) + t·1.6hth`, axes (`a`, `cross(t, a)`, `t`), radii `0.38·len`, `0.55·rmid`, `1.4hth`; `k = 0.3hth`; mark `earInner`, `markBand = 0.6hth`.

Tests (`tests/builder/face.test.ts`):
- The fox gets: 1 cranium, 2 sockets, 2 brows, 2 cheeks, a pad nose with 2 nostrils (at full detail), a mouth carve, 2 ear cups.
- `mouthFrame(fox)`: `tip.z > hinge.z`, the hinge is below both eye centres, `halfThick ≥ 1.1·cell`.
- The hawk gets a beak hook and no cheeks; the duck a bill; the trout `slits`; the blob fixture (no head) gets no face features and a null mouth frame.
- Carving: `bodySdf` at the mouth slab's centre is > 0 (empty) for the fox; at the socket centre offset `out·1.2re` it is > the plain SDF.
- Building the fox at all three LODs still gives closed meshes (the slit must not tear: every edge in two triangles).

- [ ] Steps: failing tests → implement → `npm test` + perf → portraits of all 8 natives as `t8-*` (look at each face; tune numbers that read wrong, list changes in the report) → commit `feat(builder): faces with skull, brow, sockets, cheeks, noses, mouth slit and ear cups`.

---

### Task 9: The feature attribute and face colours

**Files:** modify `src/builder/build.ts` (`feature` per LOD), `src/builder/worker.ts` (transfer it), `src/builder/importance.ts` (marks raise importance), `src/render/creature.ts`, `src/skin/material.ts`, `src/skin/fur.ts`, `src/skin/patterns.ts`; tests in `tests/builder/build.test.ts`, `tests/skin/patterns.test.ts`, `tests/render/creature.test.ts`.

**Interfaces — Produces:**
- `LodMesh.feature: Float32Array` (4 per vertex: nose, earInner, mouth, hoof; 0…1).
- `src/builder/anatomy/shapes.ts`: `export function marksAt(features: Feature[], p: Vec3, n: Vec3, out: Float32Array, o: number): void` — for each feature with a `mark`, `w = 1 − smoothstep(0, markBand, |shapeSdf(p)|)` (for `earInner` additionally × `smoothstep(0, 0.3, dot(n, t))` where `t` is the ear's front axis, carried on the feature as `facing?: Vec3`); writes the per-channel max.
- `importance`: + `6 · max(marks)` (marked areas keep detail). (Compute marks on the raw fine vertices with their SDF-gradient normals.)
- `RegionPack` gains `nose: string` and `earInner: string` (hex): `face.noseColor ?? darken(headRegionColor, 0.25)` and `face.earInner ?? mix(earRegionColor, '#f0c8b8', 0.5)` (`earRegion` = the region of the first `ear` part, else the head's).
- `packUniforms`: `parC[0].yzw = nose rgb`, `parC[1].yzw = earInner rgb` (lanes unused today; **no new uniform buffer**).
- `regionNodes` returns `feature` (the `feature` attribute, vec4) and `nose`, `earInner` colour nodes.
- `createCreatureObject`: `g.setAttribute('feature', new BufferAttribute(l.feature, 4))` (the 8th vertex buffer).

Material (`createSkinMaterial`), after the pattern colour:
- `c1 = mix(color, nose, f.x)`; `c2 = mix(c1, earInner, f.y·0.85)`; `c3 = mix(c2, #3a2220, smoothstep(0, 0.5, f.z))` then `mix(c3, #9a4a48, smoothstep(0.75, 1, f.z))` (dark lips, a gum/tongue tone deep inside); `c4 = mix(c3', color·0.3, f.w)` (hooves dark).
- Roughness: `mix(roughness, 0.25, f.x)` (wet nose), `mix(…, 0.5, f.w)`; clearcoat `max(clearcoat, 0.8·f.x)`; sheen × `(1 − max(f.x, f.z))`.
- Fur (`furMaterial`): `len = furLength · (1 − max(f.x, f.z, f.w, 0.7·f.y))`.

Tests:
- Build test: the fox's LOD0 has vertices with `nose > 0.9` (near the nose tip) and `earInner > 0.5`, and the hips have all four channels 0; the deer's hooves have `hoof > 0.9`.
- `packRegions`: `nose` falls back to a darkened head colour; a given `noseColor` wins.
- Creature test: the geometry has exactly 8 attributes, including `feature`.

- [ ] Steps: failing tests → implement → `npm test` + `npx tsc --noEmit` → portraits `t9-*` for fox, rabbit, deer, duck, hawk (nose, inner ear, mouth line visible) → check the lab console for WebGPU errors (attribute/uniform limits) → commit `feat(skin): nose, inner ear, mouth and hoof colours from a feature attribute`.

---

### Task 10: The jaw bone and jaw skinning

**Files:** modify `src/builder/skeleton.ts` (`BoneDef.jaw?`, `Skeleton.jaw`), `src/builder/build.ts`, `src/builder/weights.ts`; tests in `tests/builder/skeleton.test.ts`, `tests/builder/build.test.ts`.

**Interfaces — Produces:**
- `BoneDef.jaw?: true`; `Skeleton.jaw: number` (index of the jaw bone, −1 when none; `buildSkeleton` sets −1).
- `export function addJaw(sk: Skeleton, mouth: MouthFrame): Skeleton` (build.ts or skeleton.ts): appends one bone `{ name: `${H.name}~jaw`, partId: H.partId, mirrored: false, parent: mouth.head, role: 'mouth', region: (mouth bone's region, else H's), start: mouth.hinge, end: mouth.tip − up·halfThick, r0: 0.6·rH, r1: rn·0.6, squash: 1, flatFacing: 'up', pointed: false, depth: H.depth + 1, jaw: true }` and sets `jaw` to its index. Existing bone indices do not change.
- `skinWeights(positions, sk, regions, mouth?: MouthFrame | null)`: the jaw bone is excluded from the distance-based weighting; then for every vertex whose nearest bone is `H` or a descendant `mouth` bone: `below = smoothstep(+halfThick, −halfThick, dot(p − hinge, up))`, `ahead = smoothstep(−0.3rH, 0.1rH, dot(p − hinge, forward))`, `j = below · ahead`. When `j > 0`: scale the existing four weights by `1 − j`, then put `j` on the jaw bone in the slot with the smallest weight (renormalise to sum 1).
- `buildBody` order: `buildSkeleton` → `anatomy` (gives `mouth`) → mesh with the skeleton **without** the jaw → `addJaw` → `skinWeights(..., mouth)`. The returned `BodyData.skeleton` includes the jaw.
- `individualVariation` needs nothing new (the jaw's `partId` is the head's).

Tests:
- Fox skeleton has `jaw ≥ 0`, its parent is the head, its start is the mouth hinge; the blob has `jaw === −1` and the same bone count as before.
- Fox LOD0: every vertex with a jaw weight > 0.5 lies below the slit plane and ahead of `hinge − 0.3rH`; no vertex above the slit by more than `2·halfThick` has any jaw weight; the leg and torso vertices have none.
- Weights still sum to 1 (existing test).
- Rotating the jaw bone by 0.4 rad in a three skinned mesh (as `tests/render/creature.test.ts` builds objects) moves the chin vertices down and leaves the forehead still (CPU skinning check via `SkinnedMesh.applyBoneTransform` / `getVertexPosition`).

- [ ] Steps: failing tests → implement → `npm test` → commit `feat(builder): a jaw bone that carries the lower jaw`.

---

### Task 11: Eyelids

**Files:** modify `src/skin/eyes.ts`, `src/render/creature.ts`; create `tests/skin/eyes.test.ts`.

**Interfaces — Produces:**

```ts
export type Eye = Mesh & { blink(amount: number): void; lids: Mesh[] };   // amount 0 open … 1 shut
/** Lid rim elevations (radians) for a closing amount: upper +50° → −35°, lower −55° → −35°. */
export function lidAngles(amount: number): { upper: number; lower: number };
export function createEyes(body: BodyData, recipe: Recipe, bones: Bone[], tint?: Vector3): Eye[];
```

- With `recipe.face.lids`: each eye gets two lid meshes (children of the eye mesh, so they share its scale and orientation; the eye looks along local `+z`): hemispherical caps of radius `1.07` (eye-local units) from `SphereGeometry(1.07, 24, 8, 0, 2π, 0, π/2)`, i.e. the half above the `y = 0` plane. Unrotated, a cap's rim lies in that plane, so its front edge is at elevation 0°. The **upper lid** covers everything above its rim: to put the rim's front edge at elevation `e`, rotate it about local `x` so the front tips up by `e` (`rotation.x = −e` in three's right-handed convention: verify with the ray test below and flip the sign if needed). The **lower lid** is the same geometry turned upside down (`rotation.z = π`), covering everything below its rim, rotated about `x` the same way so its front edge sits at elevation `e_lower`. At `upper = lower = −35°` the two rims meet in front, below the pupil.
- Lid material: one `MeshStandardNodeMaterial` per creature (shared by its lids): colour = the head region's base colour × the per-object tint (`userData.tint`, set on each lid like the body meshes) darkened towards a rim line: `mix(color, color·0.35, smoothstep(0.75, 1, uv.y))` for the upper lid's edge (use the cap's `uv` v coordinate; flip for the lower), roughness 0.8. Lids cast no shadow.
- `blink(amount)`: sets both lids from `lidAngles(amount)`; the eyeball is no longer squashed.
- Without lids (`face.lids === false`): no lid meshes; `blink` does nothing.
- `createCreatureObject` passes the tint to `createEyes`.

Tests (`tests/skin/eyes.test.ts`, pure three objects, no renderer):
- `lidAngles(0)` = {upper ≈ 50°, lower ≈ −55°}; `lidAngles(1)` = {−35°, −35°}; monotone in between.
- With lids shut, a ray from the eye centre straight forward (`+z` local) hits a lid (use `Raycaster` against the lid meshes after `updateMatrixWorld`); with lids open it hits none.
- The trout's eyes have no lids and `blink(1)` leaves the eyeball scale unchanged.

- [ ] Steps: failing tests → implement → `npm test` → portraits `t11-fox`, `t11-hawk`; also a shot with `__lab.creature.eyes.forEach(e => e.blink(1))` then `step(1)` → commit `feat(skin): eyelids that blink, half-close and shut in sleep`.

---

### Task 12: Moving faces — jaw, lids and ears in motion; lab face controls

**Files:** modify `src/motion/actions.ts`, `src/motion/rig.ts`, `src/motion/secondary.ts`, `src/lab/main.ts`, `src/lab/ui/workshop.ts`; tests in `tests/motion/actions.test.ts`, create `tests/motion/face.test.ts`.

**Interfaces — Produces:**

```ts
// RigIntents (actions.ts) gains
mouth: 'shut' | 'chew' | 'lap';
ears: 'rest' | 'alert' | 'back';
// CreatureRig gains the same two fields (default 'shut', 'rest')

// secondary.ts
export type FaceCmd = 'blink' | 'yawn' | 'chew' | 'alert' | 'back';
/** Pure face pose for one moment, for testing and for SecondaryMotion. */
export function facePose(s: FaceState, dt: number, rig: { callNow: number; sleepNow: number; headDownNow: number; mouth: 'shut' | 'chew' | 'lap'; ears: 'rest' | 'alert' | 'back' }): { jaw: number /* radians open */; lids: number /* 0..1 */; earPitch: number; earRoll: number };
export type FaceState = { t: number; blinkAt: number; yawn: number /* seconds left */; wasAsleep: boolean; rng: () => number };
// SecondaryMotion gains: trigger(cmd: FaceCmd): void
```

Behaviour:
- **Actions:** `set()` resets `mouth = 'shut'`, `ears = 'rest'`. `eat` (and any `graze` step) → `mouth = 'chew'` while the graze runs; `drink`'s graze → `'lap'`; `flee` → `ears = 'back'`; when `update()` picks the camera as the look target → `ears = 'alert'` until the next look change.
- **Jaw** (radians, about the jaw bone's local `x`, opening downward): call `0.45·callNow`; chew (when `mouth === 'chew'` and `headDownNow > 0.8`) `0.08 + 0.07·sin(2π·2.5t)`; lap (`'lap'`, head down) `0.05 + 0.05·sin(2π·5t)`; yawn: starts once when `sleepNow` passes 0.5 (or on `trigger('yawn')`), lasts 2.5 s, opening `0.6·sin(π·u)` (u = progress). Take the largest. Without a jaw bone (`skeleton.jaw < 0`), keep today's behaviour (mouth bones pitch with `callNow`); with a jaw, mouth bones no longer pitch.
- **Lids:** blinks as today (every 2–6 s, 0.15 s), plus a floor: `0.45` while chewing, `sleepNow` while asleep; `trigger('blink')` blinks now. Value passed to `eye.blink()`.
- **Ears** (added to today's twitch target): `alert` → pitch −0.3 (forward/up), `back` → +0.8 and roll +0.3 (flattened), sleep → +0.4·sleepNow (droop, as today). Idle swivel: each ear's twitch timer is already independent; keep it.
- **Lab:** the workshop gets a `Face` row with buttons `Blink`, `Yawn`, `Chew`, `Alert`, `Ears back`, calling `on.face(cmd)`; `main.ts` maps them to `rig.secondary.trigger(cmd)` (chew sets `rig.mouth = 'chew'` and `rig.headDown = 1` for 4 s; alert/back set `rig.ears` for 3 s).

Tests:
- `tests/motion/actions.test.ts` (fake rig): `eat` sets `mouth` to `'chew'` during the graze; `drink` sets `'lap'`; `flee` sets `ears = 'back'`; `set('idle')` resets both.
- `tests/motion/face.test.ts` (`facePose`): call → jaw ≈ 0.45 at `callNow = 1`; chewing oscillates between ~0.01 and ~0.15; a yawn fires once as sleep rises and not again while asleep; lids ≥ 0.45 while chewing; ears `back` → pitch > 0.7.

- [ ] Steps: failing tests → implement → `npm test` → in the lab, trigger each face command on the fox and save shots `t12-call`, `t12-yawn`, `t12-chew`, `t12-ears-back`, `t12-sleep` (use `step()` to reach the moment) → commit `feat(motion): jaw, lids and ears move with calls, eating, drinking, sleep and fear`.

---

### Task 13: The native cast — hints and retune

**Files:** modify `src/cast/*.ts` (the 8 natives), `tests/cast/cast.test.ts` (if a snapshot or count changes).

Set these hints (other fields inferred):

| Animal | build | face |
|---|---|---|
| deer | muscle 0.8, hooves | pad `#1c1714`, earInner `#e9d6cc`, brow 0.3 |
| rabbit | muscle 0.4, paws | pad `#c98b8b`, earInner `#e8b4b0`, brow 0.2 |
| fox | muscle 0.6, paws | pad `#1a1410`, earInner `#f0e6da`, brow 0.35 |
| wolf | muscle 0.75, paws | pad `#151212`, earInner `#d8cfc4`, brow 0.45 |
| duck | muscle 0.4, webbed | bill, brow 0.2 |
| hawk | muscle 0.6, talons | beak, brow 0.75 |
| trout | muscle 0.3, plain | slits, lids false, brow 0 |
| frog | muscle 0.2, webbed | slits, brow 0.1 |

Then retune proportions where the new shapes show they are off: compare each `t13-<id>-*` portrait against how the real animal reads (silhouette, head-to-body ratio, leg thickness, ear size, eye placement). At most a handful of numeric changes per animal unless something is clearly wrong; list every change and why in the commit message.

- [ ] Steps: set hints → `npm test` → portraits `t13-*` → retune → portraits again → commit `feat(cast): build and face hints for the native cast, proportions retuned`.

---

### Task 14: Verify in the valley, after-shots, docs

**Files:** modify `README.md` (builder section: anatomy, meshing, build times, triangle counts), `docs/superpowers/HANDOFF.md` (status, known issues, backlog for 3a, next: 3b brainstorm).

- [ ] **Step 1:** `npx tsx tools/perf.ts` → every body under 3 s; record vs baseline.
- [ ] **Step 2:** Valley: open `/`, `await __valley.perf()`; River Bend within ~1 ms of the baseline. If not, lower `LOD0_BUDGET` (then re-run perf) or fewer fur shells on LOD1, and note it.
- [ ] **Step 3:** After-shots: `__lab.portrait` for every native and fixture as `after-*`; tile `before-faces`/`after-faces` side by side (`python tools/tile.py .shots/compare-faces.png .shots/before-<id>-face.png .shots/after-<id>-face.png … --cols 2`), same for `-34` and `-side`; valley shots with `__valley.shot` at Meadow and Lake Shore of a deer, fox and duck up close (use `__valley.view` then fly the camera near a resident with the dev hooks).
- [ ] **Step 4:** Run the 4 test drawings through the designer once (`/drawings.html`, Run all; about $1–1.50 on Sonnet with the owner's key); portrait each result as `after-drawing-<n>`.
- [ ] **Step 5:** Update README and HANDOFF; `npm test`, `npx tsc --noEmit`, `npm run build`; commit `docs: Lifeform Polish 3a results, numbers and handoff`.
- [ ] **Step 6:** Send the owner the comparison sheets and ask for the OK to merge.
