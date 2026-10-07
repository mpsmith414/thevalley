# Creature Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser lab where any creature recipe (hand-written, or made by Claude from a drawing or words, then corrected by "look again" passes) becomes a realistic 3D creature that stands, walks, runs, eats, sleeps and calls on a turntable stage. Eight hand-tuned native animals set the quality bar.

**Architecture:** Pure, tested modules do the hard work: the recipe format, edits, skeleton, signed-distance body, surface-nets mesher, skin weights, gait and IK. The body builder runs in a Web Worker. Three.js WebGPU (TSL node materials) renders it, and a procedural rig drives the bones every frame. A small Hono server holds the Anthropic key and answers three requests (`read`, `look-again`, `tweak`). The browser drives the design loop, because building and rendering happen there.

**Tech Stack:** Node 24, TypeScript, Vite 8, Vitest 5, three 0.186 (`three/webgpu`, `three/tsl`), zod 4, idb 8, @anthropic-ai/sdk, hono and @hono/node-server, tsx, concurrently.

## Global Constraints

- Specs: `docs/superpowers/specs/2026-10-06-creature-lab-design.md`, `docs/superpowers/specs/2026-10-06-vision-and-roadmap.md`.
- **Creature space:** metres, `+z` forward (towards the head), `+y` up, `+x` the creature's left. `mirror` copies a part across `x = 0`.
- **Recipe:** `schemaVersion: 1`. At most 48 parts in a recipe and 96 bones after mirroring. At most 8 skin regions. All vectors are `{x, y, z}` objects, never tuples (structured outputs).
- **Determinism:** no `Math.random` in `src/recipe`, `src/builder` or `src/motion` rest data. Use `mulberry32(seed)` from `src/util/rng.ts`. The same recipe gives an identical mesh hash.
- **AI:** default model `claude-sonnet-5-5`, with `claude-opus-5-5` as a setting (`DESIGNER_MODEL`). The key lives only in the server process (`.env`, which is gitignored). Never send it to the browser.
- **Look-again passes:** default 3, maximum 5 (the server refuses `pass > 5`).
- **Tone:** kid-facing text is short, warm and family-friendly. No gore anywhere.
- **Performance:** LOD0 body build under 3 s, a full drawing-to-creature run under 60 s, 60 fps in the lab on an RTX 3060 Ti.
- **Git:** work on branch `feat/creature-lab`. Never merge to `main` without the owner's OK. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Input:** controller first. Keyboard and mouse must reach every function too.

## File map

```
package.json, tsconfig.json, vite.config.ts, index.html, .gitignore, .env.example, README.md
src/util/        rng.ts, vec.ts, hash.ts
src/recipe/      schema.ts, normalize.ts, edits.ts
src/builder/     skeleton.ts, sdf.ts, mesher.ts, weights.ts, build.ts, worker.ts, client.ts
src/render/      renderer.ts, quality.ts, stage.ts, creature.ts, snapshot.ts
src/skin/        material.ts, patterns.ts, fur.ts, eyes.ts
src/motion/      limbs.ts, gait.ts, ik.ts, chains.ts, rig.ts, actions.ts
src/designer/    types.ts, api.ts, image.ts, loop.ts
src/lab/         main.ts, input.ts, focus.ts, gallery.ts, ui/*.ts, lab.css
src/cast/        deer.ts, rabbit.ts, fox.ts, wolf.ts, duck.ts, hawk.ts, trout.ts, frog.ts, index.ts
server/          index.ts, app.ts, model.ts, prompts.ts
tests/           mirrors src/ and server/
tests/drawings/  synthetic test drawings (+ the owner's son's, added later)
drawings.html, src/drawingset/main.ts   the drawing test-set page
```

---

### Task 1: Scaffold, the recipe format and normalising

**Files:** create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.env.example`, `src/util/rng.ts`, `src/util/vec.ts`, `src/util/hash.ts`, `src/recipe/schema.ts`, `src/recipe/normalize.ts`, `tests/recipe/normalize.test.ts`, `tests/util/hash.test.ts`.

**Interfaces — Produces:**
- `mulberry32(seed: number): () => number`. `Vec3 = {x: number; y: number; z: number}` with `v3`, `add`, `sub`, `scale`, `len`, `norm`, `dot`, `cross`, `lerp` in `vec.ts`.
- `stableStringify(v: unknown): string` (sorted keys) and `hash(v: unknown): string` (FNV-1a hex of the stable string).
- `ROLES` (`'head' | 'neck' | 'torso' | 'leg' | 'foot' | 'wing' | 'tail' | 'fin' | 'horn' | 'antenna' | 'ear' | 'eye' | 'mouth' | 'other'`), `COVERINGS` (`'fur' | 'scales' | 'feathers' | 'skin' | 'shell' | 'slime'`), `PATTERNS` (`'stripes' | 'spots' | 'patches' | 'rings' | 'gradient'`), `GAITS` (`'walk' | 'hop' | 'slither' | 'waddle' | 'fly' | 'swim' | 'hover'`).
- `RecipeSchema` (zod) and `type Recipe`, `Part`, `Region`, `Pattern`, `Role`. Shape:

```ts
Part = { id: string; parent: string | null; role: Role; attach: number /*0..1 along parent*/; offset: Vec3 /*start shift, m*/;
  dir: Vec3; length: number; r0: number; r1: number; squash: number /*1 round … 0.1 flat*/;
  pointed: boolean; mirror: boolean; region: string }
Region = { id: string; covering: Covering; color: string /*#rrggbb*/; belly: string | null;
  furLength: number; fluff: number; pattern: Pattern | null }
Pattern = { kind: PatternKind; color: string; scale: number; amount: number; along: boolean }
Recipe = {
  schemaVersion: 1; id: string; name: string; seed: number;
  source: { kind: 'native' | 'drawing' | 'words' | 'both'; description: string };
  parts: Part[];
  skin: { regions: Region[]; eyes: { color: string; pupil: 'round' | 'slit' | 'bar' | 'none'; size: number } };
  motion: { gait: Gait; bounce: number; sway: number; stance: 'low' | 'normal' | 'upright' };
  life: { sizeM: number; massKg: number; topSpeed: number; stamina: number; lifespanDays: number;
    maturityDays: number; litterMin: number; litterMax: number; juvenileHead: number; juvenileFluff: number };
  mind: { plants: string[]; preyMin: number; preyMax: number; scavenger: boolean; boldness: number;
    jumpiness: number; social: 'solitary' | 'pair' | 'herd' | 'pack' | 'flock';
    activity: 'day' | 'night' | 'twilight'; habitat: ('ground' | 'water' | 'air' | 'trees' | 'burrow')[];
    senses: { fov: number; acuity: number; night: number; smell: number; hearing: number; colour: 'muted' | 'normal' | 'vivid' } };
  inheritance: { path: string; spread: number }[];
}
```

  The zod schema has **no numeric min/max** (structured outputs ignore them). Ranges live in `LIMITS`.
- `LIMITS` (e.g. `length: [0.005, 6]`, `r0/r1: [0.002, 2]`, `squash: [0.1, 1]`, `attach: [0, 1]`, `furLength: [0, 0.15]`, `sizeM: [0.02, 8]`, `topSpeed: [0.05, 25]`, `fov: [30, 340]`, `spread: [0, 0.3]`, the rest `[0, 1]` or a sensible range) and `MAX_PARTS = 48`, `MAX_BONES = 96`, `MAX_REGIONS = 8`.
- `normalizeRecipe(raw: unknown): { recipe: Recipe; fixes: string[] }`. It throws `RecipeError` only when there is no object or no usable part. It clamps every number to `LIMITS`, normalises `dir` (a zero vector becomes `{0, 0, 1}`), keeps the first `parent: null` part as the single root (other roots and dangling parents are re-attached to the root), de-duplicates ids, drops parts beyond `MAX_PARTS` or past `MAX_BONES` after mirroring, rejects cycles by re-attaching to the root, adds a default `body` region when needed, points unknown `region` references at the first region, truncates regions to 8, and validates colours (`#rrggbb`, else `#8a7a66`). Every change adds a human-readable string to `fixes`.

- [ ] **Step 1:** create the scaffold. In `package.json` (`"type": "module"`), scripts: `dev` = `concurrently -k -n web,api "vite --host" "node --env-file-if-exists=.env --import tsx --watch server/index.ts"`, `test` = `vitest run`, `build` = `tsc --noEmit && vite build`, `api` = the server half alone. Run `npm i three zod idb @anthropic-ai/sdk hono @hono/node-server` and `npm i -D typescript vite vitest @types/three @types/node tsx concurrently`. In `vite.config.ts`: proxy `/api` to `http://localhost:8787`, worker `format: 'es'`, vitest `environment: 'node'`. In `.gitignore`: `node_modules`, `dist`, `.env`. In `.env.example`: `ANTHROPIC_API_KEY=` and `DESIGNER_MODEL=claude-sonnet-5-5`.
- [ ] **Step 2: failing tests.**
  - `hash`: equal for objects with different key order, different for different values.
  - `normalizeRecipe`:
    - a minimal valid recipe passes unchanged (`fixes` is empty);
    - `length: 99` clamps to 6 with a fix;
    - `dir: {0, 0, 0}` becomes forward;
    - two roots become one;
    - an unknown parent is re-attached to the root;
    - a cycle a→b→a is broken;
    - duplicate ids are renamed `id_2`;
    - 60 parts are cut to 48;
    - 40 mirrored parts are cut so bones stay ≤ 96;
    - a missing region falls back to the first;
    - a bad colour becomes `#8a7a66`;
    - `null` input throws `RecipeError`.
- [ ] **Step 3:** `npx vitest run tests/recipe tests/util` fails because the modules are missing.
- [ ] **Step 4:** implement. Helper: `const clamp = (v, [lo, hi], name) => { const c = Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo)); if (c !== v) fixes.push(`${name} ${v}→${c}`); return c }`. First run the `RecipeSchema.safeParse` of a shallow-defaulted copy (`defaultsFor(raw)` fills missing sections from `DEFAULT_RECIPE`), then walk the fields.
- [ ] **Step 5:** the tests pass. `npx tsc --noEmit` is clean. Commit `feat(recipe): project scaffold, the recipe format and normalising`.

### Task 2: Recipe edits

**Files:** create `src/recipe/edits.ts`, `tests/recipe/edits.test.ts`.

**Interfaces:**
- Consumes `Recipe`, `Part`, `normalizeRecipe`.
- Produces:
  - `RecipeEditSchema` (zod) and `type RecipeEdit = { op: 'set'; path: string; valueJson: string } | { op: 'addPart'; part: Part } | { op: 'removePart'; id: string }`.
  - `applyEdits(recipe: Recipe, edits: RecipeEdit[]): { recipe: Recipe; applied: number; skipped: string[] }`.
- **Path syntax:** dot-separated. `parts.<partId>.<field>` and `skin.regions.<regionId>.<field>` (also `.pattern.<field>`) address items by id. Every other segment is an object key, e.g. `motion.bounce`, `life.sizeM`, `skin.eyes.color`. `valueJson` is parsed with `JSON.parse`.
- `removePart` removes the part and all its descendants, but never the root. `addPart` with an existing id is skipped. Bad paths and bad JSON are skipped with a reason. The result always goes through `normalizeRecipe`.

- [ ] **Step 1: failing tests.**
  - `set parts.tail.length "0.6"` changes only that field.
  - `set skin.regions.body.pattern.scale` works.
  - `set motion.bounce "2"` is clamped to 1 by normalise.
  - `addPart` adds a horn.
  - `removePart` of the neck also removes the head (a descendant).
  - Removing the root is skipped.
  - An unknown part id and malformed JSON are skipped with a reason.
  - `applied` counts correctly.
  - The input recipe is not mutated.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement with `structuredClone`, then a segment walker that resolves `parts` and `skin.regions` arrays by `id`.
- [ ] **Step 4:** the tests pass. Commit `feat(recipe): small recipe edits`.

### Task 3: The skeleton (mirroring, bones, standing balance)

**Files:** create `src/builder/skeleton.ts`, `tests/builder/skeleton.test.ts`, and the test fixture `tests/fixtures/recipes.ts`. The fixture holds `quadruped` (torso, neck, head, 4 mirrored leg pairs as upper and lower plus feet, tail), `snake` (a chain of 8 body segments), `hexapod` (6 legs), `blob` (one round torso) and `biped`.

**Interfaces:**
- Consumes `Recipe`.
- Produces:

```ts
type BoneDef = { name: string; partId: string; mirrored: boolean; parent: number /*-1 root*/;
  role: Role; region: string; start: Vec3; end: Vec3; r0: number; r1: number; squash: number;
  pointed: boolean; depth: number }
type Skeleton = { bones: BoneDef[]; contacts: number[]; min: Vec3; max: Vec3 }
expandParts(recipe: Recipe): BoneDef[]
// parent order is preserved: parents come before children.
// A child's start = lerp(parent.start, parent.end, attach) + offset; end = start + dir * length.
// A mirrored part produces the part (x as given) plus a copy with x negated for start/end/dir,
// named `${id}` and `${id}~m`. Descendants of a mirrored part are mirrored with it,
// and the copy's children attach to the copy.
groundFit(bones: BoneDef[]): { bones: BoneDef[]; contacts: number[] }
// contacts = the lowest-ending bones of each leg chain (role foot, else leg tips), else the torso
// (belly) for legless bodies. Everything is shifted in y so min(contact.end.y - contact.r1) === 0,
// and in x/z so the support centre (mean of contact ends) sits under the torso's centre of mass
// (shift x/z of the whole body so the root midpoint is above the support centroid; x is kept at 0
// when the creature is symmetric).
buildSkeleton(recipe: Recipe): Skeleton  // min/max include radii
```

- [ ] **Step 1: failing tests.**
  - `quadruped`: one mirrored leg chain becomes 2 chains with x of opposite sign; the mirrored copy's children attach to the copy; bone count matches; parents precede children.
  - `groundFit`: the lowest foot surface sits at y = 0 (±1e-6), all four feet are contacts, and the root is above the support centroid (|dx|, |dz| < 1e-6).
  - `snake`: contacts are torso/body bones and the body rests at y = 0.
  - `blob`: the root is the single contact.
  - `hexapod`: 6 contacts.
  - Determinism: building twice gives deep-equal results.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass. Commit `feat(builder): skeleton from the recipe, mirrored and standing`.

### Task 4: The body field and the mesher

**Files:** create `src/builder/sdf.ts`, `src/builder/mesher.ts`, `tests/builder/sdf.test.ts`, `tests/builder/mesher.test.ts`.

**Interfaces:**
- Consumes `BoneDef`, `Skeleton`.
- Produces:
  - `boneSdf(px, py, pz, b: BoneDef): number`: a round cone from `start` (r0) to `end` (r1) with the cross-section squashed by `squash` (scale distance along the bone's local "up" axis by `1/squash`, then multiply the result by `squash`). `pointed` makes r1 = max(0.002, r1 × 0.15).
  - `blendFor(role: Role): number`, in metres relative to the bone radius: `torso/neck/head: 0.6`, `tail: 0.4`, `leg: 0.25`, `foot: 0.15`, `ear/fin/wing: 0.2`, `horn/antenna: 0.05`, `eye: 0` (eyes are separate meshes, Task 7), `mouth/other: 0.3`. Blend `k = blendFor(role) * min(b.r0, parent.r1)`.
  - `bodySdf(sk: Skeleton): (x, y, z) => number`: `d = min over bones`, combined in bone order with `smin(dParentAccum, dBone, k)` where `smin(a, b, k) = k > 0 ? min(a, b) - h*h*k*0.25 : min(a, b)` with `h = max(k - |a - b|, 0) / k`. Each bone gets an AABB (inflated by radius + k). Bones whose AABB misses the point are skipped. Eye bones are skipped.
  - `MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }`.
  - `surfaceNets(sdf, min: Vec3, max: Vec3, cell: number): MeshData`: sample the grid (pad by 2 cells), place one vertex per sign-changing cell at the average of the edge crossings, emit quads (as 2 triangles, wound outward) for each sign-changing grid edge. Normals come from the SDF central-difference gradient at each vertex.

```ts
export function roundCone(p: Vec3, a: Vec3, b: Vec3, r1: number, r2: number): number {
  // Inigo Quilez, "round cone - exact"
  const ba = sub(b, a), l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pa = sub(p, a), y = dot(pa, ba), z = y - l2;
  const xv = sub(scale(pa, l2), scale(ba, y)), x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
```

- [ ] **Step 1: failing tests.**
  - `roundCone`: inside the midpoint < 0, on the surface ≈ 0 (±1e-4), outside > 0.
  - `squash = 0.2` makes a flat ear: the distance along up is reached 5× sooner.
  - `smin(a, b, 0) === min`, and `smin ≤ min` when k > 0.
  - `surfaceNets` of a sphere SDF (r = 1, cell 0.1):
    - all positions are finite;
    - every vertex is within 0.05 of radius 1;
    - the mesh is closed (every edge shared by exactly 2 triangles);
    - the Euler characteristic is 2;
    - normals point outward (dot(normal, position) > 0).
  - `bodySdf(quadruped)` is negative inside the torso and positive 1 m above.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement. The surface-nets grid uses `Float32Array` samples and an `Int32Array` cell→vertex map.
- [ ] **Step 4:** the tests pass. Commit `feat(builder): the clay body field and the surface-nets mesher`.

### Task 5: Skin weights, `buildBody`, the worker and the client

**Files:** create `src/builder/weights.ts`, `src/builder/build.ts`, `src/builder/worker.ts`, `src/builder/client.ts`, `tests/builder/weights.test.ts`, `tests/builder/build.test.ts`.

**Interfaces:**
- Consumes `buildSkeleton`, `bodySdf`, `surfaceNets`, `hash`.
- Produces:
  - `skinWeights(positions: Float32Array, sk: Skeleton): { skinIndex: Uint16Array; skinWeight: Float32Array; region: Float32Array; partT: Float32Array; boneOf: Uint16Array }`.
    - For each vertex, `s_i = surfaceDistance(vertex, bone_i)` (the round-cone SDF of the bone alone).
    - The influence set is the bones with `s_i < s_min + band`, where `band = 0.5 * radius of the nearest bone`.
    - `w_i = (1 - (s_i - s_min) / band)^2`. Keep the top 4 and normalise them to sum 1.
    - `boneOf` is the nearest bone, `region` is the index of the nearest bone's region in `regions`, and `partT` is the projection 0..1 along the nearest bone.
  - `LOD_CELLS = [110, 56, 28]`: cells along the longest dimension.
  - `type LodMesh = MeshData & { skinIndex: Uint16Array; skinWeight: Float32Array; region: Float32Array; partT: Float32Array }`.
  - `type BodyData = { key: string; skeleton: Skeleton; regions: string[]; lods: LodMesh[] }`.
  - `buildBody(recipe: Recipe, lods = [0, 1, 2]): BodyData`, with `key = hash(recipe.parts) + hash(recipe.skin.regions.map(r => r.id))`.
  - `worker.ts`: `onmessage = ({data: {id, recipe}}) => postMessage({id, body}, transferables)`.
  - `class BuilderClient { build(recipe: Recipe): Promise<BodyData> }`: one module worker (`new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'})`), request ids, an LRU cache of 16 keyed by `key`, and transfers buffers.
  - `individualVariation(recipe: Recipe, seed: number): { boneScale: number[]; tint: { h: number; s: number; l: number } }`. Per-individual differences need no rebuild:
    - `boneScale[i]` = 1 ± up to the `inheritance` spread for `life.sizeM`, applied per limb chain (mirrored pairs get the same value);
    - `tint` is a small HSL shift (h ± 0.02, s and l ± 0.05).

    `seed` 0 returns all-ones and a zero tint. Pure, using `mulberry32`. Applied in Task 6 (bone positions scaled) and Task 7 (a tint uniform).
- Extra tests: `individualVariation` is deterministic per seed, stays within spread, gives mirrored pairs equal scale, and seed 0 is the identity.

- [ ] **Step 1: failing tests.**
  - `skinWeights` on `quadruped` LOD1:
    - weights sum to 1 (±1e-5);
    - indices are < the bone count;
    - a vertex near the middle of the left lower leg gets ≥ 0.85 from that leg;
    - no vertex on the left leg takes weight from a right-leg bone.
  - `buildBody`:
    - three LODs with decreasing vertex counts;
    - LOD0 ≤ 120k vertices for every fixture;
    - two builds give an identical `hash` of positions (determinism);
    - LOD0 of `quadruped` takes < 3000 ms (`performance.now()`).
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement. Compute AABB-culled per-bone distances.
- [ ] **Step 4:** the tests pass. Commit `feat(builder): skin weights, buildBody, worker and client`.

### Task 6: Renderer, stage and the first creature on screen

**Files:** create `src/render/quality.ts`, `src/render/renderer.ts`, `src/render/stage.ts`, `src/render/creature.ts`, `src/lab/main.ts`, `src/lab/lab.css`, `index.html`, `tests/render/stage.test.ts`, and `.claude/launch.json` (name `lab`, `npm run dev`, port 5173).

**Interfaces:**
- `QUALITY: Record<'low' | 'medium' | 'high', { pixelRatio: number; shadowMap: number; furShells: number; lod: 0 | 1 | 2; grass: number }>`:

  | Tier | pixelRatio | shadowMap | furShells | lod | grass |
  |---|---|---|---|---|---|
  | high | 1.5 | 2048 | 16 | 0 | 40000 |
  | medium | 1 | 1024 | 8 | 1 | 15000 |
  | low | 0.75 | 512 | 0 | 2 | 4000 |

  `autoQuality(fpsSamples: number[]): 'low' | 'medium' | 'high'` returns `high` above 55, `medium` above 35, else `low`.
- `createRenderer(canvas: HTMLCanvasElement, tier): Promise<{ renderer: WebGPURenderer; backend: 'webgpu' | 'webgl2' }>`. `new WebGPURenderer({ canvas, antialias: true })`, `await renderer.init()`, the backend read from `renderer.backend.isWebGPUBackend`, `toneMapping = AgXToneMapping`, shadows on.
- `heightAt(x: number, z: number): number`: a pure function in `stage.ts`. The disc has radius 6 m, gentle bumps (`0.08 * sin(1.3x)·cos(1.1z)` plus a second octave), and a slope rising to +0.35 m towards +x on the outer third. There is a pond at `(−2.6, 2.2)`, radius 1.4 m and depth 0.5 m (`export const WATER_LEVEL = 0`, the bed below it). `isWater(x, z)` reports whether a point is in the pond.
- `createStage(scene, tier): Stage`, where `Stage = { heightAt; isWater; radius: 6; update(t: number): void }`. It holds:
  - a displaced ground mesh (TSL colour: grass green blended with soil on the slope);
  - instanced grass blades with TSL wind sway, count from the tier, none on the pond;
  - a water disc (`MeshPhysicalNodeMaterial`, transmission-free, low roughness, tinted);
  - `SkyMesh` with the sun direction plus a PMREM environment;
  - a `DirectionalLight` with shadows sized to the disc, and a `HemisphereLight`.
- `createCreatureObject(body: BodyData, recipe: Recipe, tier, variation = individualVariation(recipe, 0)): CreatureObject`, where `CreatureObject = { root: Group; mesh: SkinnedMesh; bones: Bone[]; restWorld: Vec3[]; setLod(i: 0 | 1 | 2): void; dispose(): void }`.
  - One `Bone` per `BoneDef` at `start`, with child bones positioned relative to their parent.
  - The `BufferGeometry` gets `position`, `normal`, `skinIndex`, `skinWeight`, `region`, `partT`, and `bodyPos` (a copy of the rest position) attributes. Bind with `mesh.bind(new Skeleton(bones))`.
  - Uses a placeholder `MeshStandardNodeMaterial` until Task 7.
- `src/lab/main.ts`: sets up the renderer, stage, an `OrbitControls` camera around the creature, a resize handler and an `fps` sampler that calls `autoQuality` after 3 s. It loads the `quadruped` fixture via `BuilderClient` and shows it at the stage centre, standing on `heightAt(0, 0)`.

- [ ] **Step 1: failing tests** (`stage.test.ts`, pure parts only):
  - `heightAt` is finite across the disc;
  - the slope side is higher than the opposite side;
  - `isWater` is true at the pond centre and false at the origin;
  - `autoQuality` thresholds.
- [ ] **Step 2:** the tests fail. **Step 3:** implement everything.
- [ ] **Step 4:** the tests pass. Then `preview_start lab` and check:
  - no console errors;
  - the screenshot shows the grey clay quadruped standing on the grassy disc with sky, shadow and pond;
  - the backend is `webgpu`.
- [ ] **Step 5:** commit `feat(render): renderer, stage and the first creature on screen`.

### Task 7: The skin material and the eyes

**Files:** create `src/skin/patterns.ts`, `src/skin/material.ts`, `src/skin/eyes.ts`, `tests/skin/patterns.test.ts`. Modify `src/render/creature.ts`.

**Interfaces:**
- `packRegions(recipe: Recipe, regions: string[]): RegionPack`, where `RegionPack = { base: Color[]; belly: Color[]; hasBelly: number[]; covering: number[]; patKind: number[]; patColor: Color[]; patScale: number[]; patAmount: number[]; patAlong: number[]; furLength: number[]; fluff: number[] }`. Each array is padded to 8. Index order is `COVERINGS` and `PATTERNS`, with `-1` for none. This is pure and tested.
- `patternMaskCPU(kind, bodyPos: Vec3, partT: number, scale: number, amount: number): number`: a CPU twin of the shader pattern (stripes, rings and gradient only, which are deterministic without noise). It's for tests and docs.
- `createSkinMaterial(pack: RegionPack): MeshPhysicalNodeMaterial`. In TSL:
  - read `attribute('region')`, `attribute('bodyPos')`, `attribute('partT')`;
  - select uniforms by region through `uniformArray(...).element(regionIndex)`;
  - patterns:
    - stripes: `step(1 - amount, 0.5 + 0.5 * sin(dot(bodyPos, axis) * 2π / scale))`, with the axis along z (or y when `along`);
    - spots: `mx_worley_noise_float(bodyPos / scale) < amount * 0.6`;
    - patches: `mx_noise_float(bodyPos / scale) > 1 - 2 * amount`;
    - rings: `step(0.5, fract(partT * (1 / scale)))`;
    - gradient: `mix(base, patColor, partT)`;
  - belly: mix in the belly colour where the rest-pose normal `y < -0.2` (smoothstep);
  - coverings set roughness, sheen, clearcoat and normal detail:

    | Covering | Roughness | Other |
    |---|---|---|
    | fur | 0.95 | sheen 0.4 |
    | feathers | 0.7 | sheen 0.3, feather-scale normal ripple from `mx_worley` |
    | scales | 0.45 | worley-cell normal bumps |
    | skin | 0.6 | |
    | shell | 0.3 | clearcoat 0.6 |
    | slime | 0.1 | clearcoat 1, slightly translucent tint |

- `createEyes(body: BodyData, recipe: Recipe): Mesh[]`. One glossy sphere per `eye` bone, radius `max(r0, r1) × recipe.skin.eyes.size × 2` (clamped), parented to the eye bone. A TSL iris colour with a pupil shape from the local position (round: disc; slit: a narrow vertical ellipse; bar: a horizontal ellipse; none: all iris) and clearcoat 1. Each eye exposes `blink(amount: 0..1)`, which scales local y.

- [ ] **Step 1: failing tests:**
  - `packRegions` pads to 8 and maps indices;
  - `patternMaskCPU` stripes alternate across one `scale`;
  - rings flip at `partT` multiples of `scale`;
  - gradient is monotonic in `partT`.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement, and wire the material and eyes into `createCreatureObject`.
- [ ] **Step 4:** the tests pass. In the browser:
  - give the fixture a striped fur body, a spotted scaly tail and slit eyes;
  - screenshot from the side and the front;
  - check that patterns wrap around legs without seams and that there are no console errors.
- [ ] **Step 5:** commit `feat(skin): one shared skin material with patterns, coverings and lively eyes`.

### Task 8: Fur shells

**Files:** create `src/skin/fur.ts`, `tests/skin/fur.test.ts`. Modify `src/render/creature.ts`.

**Interfaces:**
- `furShellOffsets(count: number, length: number): number[]`: shell distances, quadratic (denser near the skin). It's pure and tested.
- `createFurShells(mesh: SkinnedMesh, pack: RegionPack, count: number): SkinnedMesh[]`.
  - Each shell shares the geometry and the skeleton.
  - A `MeshStandardNodeMaterial` with `positionNode = positionLocal + normalLocal * furLen(region) * shellT`. `furLen` is 0 for non-fur coverings, which collapses those shells.
  - Strand mask: `hash(floor(bodyPos * density))` against `shellT`. Tip taper and clumping come from `fluff`.
  - `alphaTest` 0.5, colour from the same region and pattern functions (export `regionColorNode` from `material.ts`), darker at the root (ambient occlusion by `shellT`).
  - Shell count comes from the quality tier. `setLod(2)` hides the shells.

- [ ] **Step 1: failing test:** `furShellOffsets(16, 0.04)` is increasing, ends at 0.04, and its first gap is smaller than its last.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** in the browser, compare the fixture with short, fluffy fur at 16 shells and at low quality (0 shells). Screenshot both. Check fps on high.
- [ ] **Step 5:** commit `feat(skin): soft fur shells`.

### Task 9: Legs that walk — limbs, gaits, IK, the rig

**Files:** create `src/motion/limbs.ts`, `src/motion/gait.ts`, `src/motion/ik.ts`, `src/motion/rig.ts`, `tests/motion/limbs.test.ts`, `tests/motion/gait.test.ts`, `tests/motion/ik.test.ts`. Modify `src/lab/main.ts`.

**Interfaces:**
- `type Limb = { kind: 'leg' | 'wing' | 'fin'; chain: number[] /*bone indices root→tip*/; side: -1 | 0 | 1; rank: number /*0 = frontmost on its side*/; length: number }`.
- `findLimbs(sk: Skeleton): Limb[]`. A leg chain starts at a `leg` bone whose parent is not a leg, and continues through `leg` and `foot` children. Wings and fins work the same way. The side comes from the sign of `start.x`. `rank` comes from sorting by `start.z` descending within each side.
- `type GaitName = 'walk' | 'trot' | 'gallop' | 'tripod' | 'wave' | 'hop' | 'biped'`.
- `chooseGait(legs: Limb[], recipe: Recipe, speedFrac: number): GaitName`:
  - hop when `motion.gait === 'hop'`;
  - biped with 2 legs;
  - with 4 legs: walk below 0.35, trot below 0.75, else gallop;
  - tripod with 6 legs;
  - wave for any other count.
- `phasesFor(legs: Limb[], gait: GaitName): { phase: number[]; duty: number }` (phases 0..1):
  - biped: L 0, R 0.5, duty 0.6;
  - walk: left-hind 0, left-front 0.25, right-hind 0.5, right-front 0.75, duty 0.7;
  - trot: diagonals left-front + right-hind 0, right-front + left-hind 0.5, duty 0.5;
  - gallop: left-front 0, right-front 0.1, left-hind 0.5, right-hind 0.6, duty 0.4;
  - tripod: L0, R1 and L2 at 0, the others at 0.5, duty 0.5;
  - wave: `(rank / perSide) * 0.5 + (side < 0 ? 0.5 : 0)`, duty 0.65;
  - hop: front 0.1, hind 0, duty 0.3.
- `fabrik(joints: Vec3[], lengths: number[], target: Vec3, pole: Vec3 | null, iterations = 12): Vec3[]`. If the target is unreachable the chain is straightened towards it. The pole bends knees: a forward pole for back legs and the reverse for front "knees" is decided by the rig.
- `class CreatureRig`:
  - `constructor(obj: CreatureObject, body: BodyData, recipe: Recipe, ground: { heightAt; isWater })`;
  - `moveTo(target: Vec3 | null)`, `setSpeed(frac: number)`, `update(dt: number)`.
  - Root motion: turn towards the target (a turn rate from the body length) and move at `frac × topSpeed` (walk ≈ 0.25). Foot targets come from rest foot positions transformed by the root, plus the stride (`speed × cycle × duty`) and an arc-shaped lift (`0.15 × leg length`) while in swing. Planted feet stay fixed in the world.
  - Body height = mean contact ground height + rest height + bounce. Body pitch and roll come from the front/back and left/right foot height differences.
  - Each leg chain is solved with FABRIK. Bone quaternions are rebuilt by aiming each bone's rest direction at its solved direction (`Quaternion.setFromUnitVectors` in the parent space).

- [ ] **Step 1: failing tests:**
  - `findLimbs(quadruped)` gives 4 legs, 2 per side, front rank 0;
  - `findLimbs(hexapod)` gives 6;
  - `findLimbs(snake)` gives none;
  - `phasesFor` matches the tables above for each gait;
  - in walk, the two legs on one side are never in phase;
  - `chooseGait` thresholds;
  - `fabrik` keeps bone lengths (±1e-4), reaches a reachable target (< 1e-3), points at an unreachable one, and the pole puts the knee on the pole side.
- [ ] **Step 2:** the tests fail. **Step 3:** implement.
- [ ] **Step 4:** the tests pass. In the browser:
  - the fixture walks in a circle across the slope;
  - feet visibly plant without sliding (a frame-by-frame check: a planted foot's world position changes by < 1 cm);
  - trot and gallop switch with speed.
  - Record a short GIF-style sequence of screenshots.
- [ ] **Step 5:** commit `feat(motion): limbs, gaits and planted feet`.

### Task 10: The rest of the motion — chains, wings, swimming, life, actions

**Files:** create `src/motion/chains.ts`, `src/motion/actions.ts`, `tests/motion/chains.test.ts`, `tests/motion/actions.test.ts`. Modify `src/motion/rig.ts`.

**Interfaces:**
- `springStep(state: { pos: number; vel: number }, target: number, stiffness: number, damping: number, dt: number)`. Pure and tested, stable for `dt ≤ 1/20`.
- `undulation(i: number, n: number, t: number, amp: number, freq: number, phaseLag: number): number`, the lateral angle for a segment along a chain.
- `findChains(sk: Skeleton): { kind: 'tail' | 'neck' | 'spine' | 'ear' | 'antenna'; chain: number[] }[]`.
- `type Action = 'idle' | 'walk' | 'run' | 'eat' | 'drink' | 'sleep' | 'call' | 'flee' | 'wander'`.
- `class ActionController`:
  - `constructor(rig: CreatureRig, recipe: Recipe, stage: Stage, rng)`;
  - `set(action: Action)`, `update(dt)`;
  - `current: Action`.
- Rig additions:
  - **Tail, ear and antenna** follow-through on springs, with sway scaled by `motion.sway`.
  - **Neck and head:** look-at towards a point of interest (the camera, or wander targets), clamped to 60°.
  - **Legless bodies** (no legs, gait `slither`): a travelling undulation down the spine chain, with the body hugging the ground (each segment at `heightAt`).
  - **`swim`:** inside `isWater`, the body sits at `WATER_LEVEL − 0.4 × body height` with tail and body undulating and fins paddling (a phase sine). A swimmer's `wander` stays inside the pond.
  - **Wings:**
    - folded at rest (the wing chain is rotated against the body);
    - `fly` (gait `fly`, or a bird's `wander` sometimes takes off): flap at `f = clamp(3 / sqrt(sizeM), 1.5, 12)` Hz, glide every few seconds, circle at 2–4 m altitude, land again;
    - `hover`: fast flaps while staying in place.
  - **Breathing:** torso scale ±1.5 % at `0.25 + 0.5 × jumpiness` Hz.
  - **Blinking:** every 2–6 s, using the eyes' `blink`.
- Actions:
  - `eat` and `drink`: walk to a spot (water edge for drink), lower the head chain to the ground, nibble.
  - `sleep`: lower the body to the ground (legs fold by moving the body down with feet planted), stop breathing variance, close the eyes, curl the tail.
  - `call`: raise the head, open the mouth bone if any, give a little body pulse.
  - `flee`: run away from the camera, then resume.
  - `wander`: pick random targets on the disc (`rng`) and mix walk, idle and eat (birds fly, swimmers swim).

- [ ] **Step 1: failing tests:**
  - `springStep` converges to the target with no blow-up at dt 0.05;
  - `undulation` is a travelling wave (segment i+1 lags segment i);
  - `findChains(quadruped)` finds the tail;
  - `ActionController` with a fake rig: `set('sleep')` ends in the lying state within 3 s of updates; `wander` only ever chooses targets inside the disc; a swimmer's targets stay inside the pond.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** in the browser, check the snake slither, the quadruped's tail sway and blinking, sleep and eat, and a winged fixture flapping a circle and landing. Screenshots.
- [ ] **Step 5:** commit `feat(motion): tails, slithering, swimming, wings, breathing and actions`.

### Task 11: Native cast I — deer, rabbit, red fox, wolf

**Files:** create `src/cast/deer.ts`, `src/cast/rabbit.ts`, `src/cast/fox.ts`, `src/cast/wolf.ts`, `src/cast/index.ts`, `src/cast/cards.ts`, `tests/cast/cast.test.ts`. Modify `src/lab/main.ts` (a temporary cast picker: number keys 1–8, and LB/RB on the controller).

**Interfaces:**
- `CAST: { recipe: Recipe; cards: KidCards }[]`.
- `KidCards = { name: string; eats: string; speed: string; mood: string; special: string }`. It lives in `src/designer/types.ts`, so create that file now with `KidCards` only.
- Each recipe is hand-tuned to real proportions (deer ≈ 1.1 m at the shoulder, rabbit 0.4 m long, fox 0.9 m with tail, wolf 1.6 m with tail):
  - legs split into upper, lower and foot (fox and wolf digitigrade, deer with long, thin lower legs and hooves as small pointed `foot` parts);
  - a muscled torso built from 2–3 overlapping torso parts (chest, belly, hips);
  - ears flat (`squash` 0.2);
  - real colours and belly countershading (deer brown with a cream belly and white tail underside; fox orange with a white chest and black socks via a leg region; wolf grey with a cream belly);
  - sensible `life`, `mind` and `inheritance` values;
  - deer `walk`, rabbit `hop`, fox and wolf `walk`.

- [ ] **Step 1: failing tests** (across all CAST entries):
  - `normalizeRecipe(recipe).fixes` is empty (hand-tuned recipes are already clean);
  - `buildBody` succeeds;
  - LOD0 vertex count ≤ 120k;
  - every 4-legged member yields 4 legs from `findLimbs`;
  - names are unique.
- [ ] **Step 2–3:** write the recipes. Iterate visually: side, front and three-quarter screenshots for each animal. Adjust proportions and blends until each reads instantly as that animal. Allowed builder fixes include `blendFor` tuning, as long as the earlier tests stay green.
- [ ] **Step 4:** the tests pass. Send the owner the screenshots (4 animals × 3 views, plus walk/run frames).
- [ ] **Step 5:** commit `feat(cast): deer, rabbit, fox and wolf`.

### Task 12: Native cast II — duck, hawk, trout, frog

**Files:** create `src/cast/duck.ts`, `src/cast/hawk.ts`, `src/cast/trout.ts`, `src/cast/frog.ts`. Modify `src/cast/index.ts` and `tests/cast/cast.test.ts`.

- Duck: `waddle` on land; swims on the pond surface (`habitat` includes water, so its swim mode floats at the waterline); flies sometimes. Feathers, with green-head/brown-body regions.
- Hawk: perches on the stage, takes off and circles high (4–6 m), glides, lands. Feathers, a barred belly (`stripes` along), a hooked beak (a pointed `mouth`).
- Trout: lives in the pond. Gait `swim`, a fin set (dorsal, pectoral and tail fins as flat parts), scales, spots.
- Frog: `hop` with long folded hind legs, sits on the pond edge, skin covering with a slimy sheen (`slime` on the back region) and patches.
- Tests: extend the cast test to all 8. Duck and hawk get 2 legs and 2 wings, the trout gets 0 legs and ≥ 3 fins, the frog gets 4 legs.
- [ ] **Steps:** tests, then recipes, then visual iteration as in Task 11. Send screenshots. Commit `feat(cast): duck, hawk, trout and frog`.

### Task 13: The Creature Designer service

**Files:** extend `src/designer/types.ts`. Create `server/index.ts`, `server/app.ts`, `server/model.ts`, `server/prompts.ts`, `tests/server/app.test.ts`, `tests/server/prompts.test.ts`, and `tests/fixtures/designer/*.json` (recorded responses).

**Interfaces — `src/designer/types.ts` (shared by browser and server):**

```ts
type ImageIn = { base64: string; mediaType: 'image/jpeg' | 'image/png' };
type View = { angle: 'side' | 'front' | 'threeQuarter' | 'top'; facing: 'left' | 'right' | 'toward' };
type ReadRequest = { image: ImageIn | null; words: string };
type ReadResult = { status: 'ok'; recipe: Recipe; checklist: string[]; view: View; cards: KidCards; fixes: string[] }
               | { status: 'noCreature' | 'declined'; message: string };
type LookAgainRequest = { image: ImageIn | null; words: string; render: ImageIn; recipe: Recipe; checklist: string[]; pass: number };
type LookAgainResult = { status: 'ok'; verdict: 'matches' | 'edits'; edits: RecipeEdit[]; note: string };
type TweakRequest = { recipe: Recipe; cards: KidCards; words: string };
type TweakResult = { status: 'ok'; edits: RecipeEdit[]; cards: KidCards; note: string } | { status: 'declined'; message: string };
```

**Server:**
- `interface DesignerModel { read(r: ReadRequest): Promise<unknown>; lookAgain(r: LookAgainRequest): Promise<unknown>; tweak(r: TweakRequest): Promise<unknown> }`. It returns the raw parsed output; the app validates it.
- `createApp(model: DesignerModel): Hono` with these routes:
  - `GET /api/health` returns `{ ok: true, model }`.
  - `POST /api/read`, `POST /api/look-again`, `POST /api/tweak`:
    - validate the request with zod (400 on bad input; 413 when the body is over 12 MB);
    - `pass > 5` returns 400;
    - call the model;
    - validate the output with the wire schemas (`ReadWire`, `LookAgainWire`, `TweakWire`);
    - run recipes through `normalizeRecipe` and keep its `fixes`;
    - on a schema failure, retry the model call once (the "repair attempt"), then return 422 `{ error: 'invalid' }`;
    - when the model throws `Anthropic.APIConnectionError`, a 5xx, a 429 or a missing key, return 503 `{ error: 'resting' }`.
- `createClaudeModel({ model, effort }): DesignerModel`:
  - `client.messages.parse({ model, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort, format: zodOutputFormat(ReadWire) }, system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], messages })`. The default effort is `medium`.
  - Images go in as `{ type: 'image', source: { type: 'base64', media_type, data } }` blocks, with "This is the drawing" and "This is what I built" text labels.
  - `stop_reason === 'refusal'` maps to `{ status: 'declined', message: 'Let’s make a different creature!' }`.
  - Read the TS SDK docs bundled with the `claude-api` skill before writing this file. Server-side refusal fallbacks (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'` on `client.beta.messages.parse`) are enabled when the installed SDK's typings accept them on the beta parse path. Otherwise use the plain `client.messages.parse` and rely on the refusal mapping. Note which one was used in `server/model.ts`.
- `SYSTEM_PROMPT` in `prompts.ts` is stable, with no dates or ids, so it caches. It contains:
  1. the role ("you design creatures for a family nature game");
  2. the full recipe field guide (creature space axes, units, how parts chain, attach/dir/length/r0/r1/squash/pointed/mirror with worked examples: a quadruped leg, a flat ear, a curled tail as 4 chained parts, a wing);
  3. **faithfulness rules**:
     - never turn it into a known animal;
     - count legs, heads, horns, eyes and tails exactly;
     - colours from the drawing;
     - keep odd details;
     - hidden sides mirror visible ones;
     - words describe behaviour and fill gaps;
  4. sizing guidance (a drawing has no scale, so infer it from what it seems to be, or use words like "giant" or "tiny");
  5. checklist rules (short, countable, visual facts);
  6. look-again rules (compare silhouette, proportions, counts, colours and patterns; prefer few, precise `set` edits; say `matches` when it would be recognisable to the child who drew it);
  7. family-friendly rules (`noCreature` for photos of people or empty pages, a friendly decline for unkind requests, real pet photos welcome);
  8. kid-card style (short, warm, e.g. "eats: flowers 🌸").
- `server/index.ts` serves the app with `@hono/node-server` on port 8787 and the model from `process.env.DESIGNER_MODEL ?? 'claude-sonnet-5-5'`.

- [ ] **Step 1: failing tests** with a fake `DesignerModel` that returns recorded fixtures:
  - read ok: a normalised recipe comes back, and `fixes` is passed through;
  - malformed output, then a good one: retried once, 200;
  - malformed twice: 422;
  - a model throwing a connection error: 503 `resting`;
  - `pass: 6`: 400;
  - a 13 MB body: 413;
  - `noCreature` is passed through;
  - tweak returns edits and cards;
  - `SYSTEM_PROMPT` contains no digits that look like dates (`/20\d\d-\d\d/`) and mentions "never" plus "known animal".
- [ ] **Step 2:** the tests fail. **Step 3:** implement.
- [ ] **Step 4:** the tests pass. Live check, **only if a key is configured** (`node --env-file=.env --import tsx server/index.ts`, then `curl /api/health`), otherwise skip. Commit `feat(designer): the creature designer service`.

### Task 14: The design loop in the browser

**Files:** create `src/designer/api.ts`, `src/designer/image.ts`, `src/designer/loop.ts`, `src/render/snapshot.ts`, `tests/designer/loop.test.ts`, `tests/designer/image.test.ts`.

**Interfaces:**
- `api = { read(r): Promise<ReadResult>; lookAgain(r): Promise<LookAgainResult>; tweak(r): Promise<TweakResult> }`. It uses `fetch('/api/…')`. Any 503 or network failure throws `DesignerResting`. A 422 throws `DesignerInvalid`.
- `prepareImage(file: Blob): Promise<ImageIn>`:
  - `createImageBitmap(file, { imageOrientation: 'from-image' })` to respect phone rotation (the "straighten" from the spec);
  - downscale to 1024 px on the longest side;
  - auto-levels (per-channel 1 %–99 % stretch, done by the pure `levels(data: Uint8ClampedArray): Uint8ClampedArray`);
  - JPEG at 0.9.
- `renderView(obj: CreatureObject, view: View, size = 768): Promise<ImageIn>` in `snapshot.ts`:
  - an offscreen scene with a plain `#e9e6df` background and soft studio light;
  - the creature in its rest pose;
  - a camera framed to the creature's bounds from the view (side facing left: camera on −x looking +x, or the reverse for right; front: camera on +z; three-quarter: 45°; top: from above);
  - render to a `RenderTarget`, then `renderer.readRenderTargetPixelsAsync`, a canvas and a PNG.
- `designCreature(input: ReadRequest, deps: { api; build(r: Recipe): Promise<BodyData>; snapshot(body: BodyData, recipe: Recipe, view: View): Promise<ImageIn> }, opts: { passes: number }, onProgress: (s: ProgressStep) => void): Promise<DesignOutcome>`.
  - `ProgressStep = { kind: 'reading' } | { kind: 'building' } | { kind: 'looking'; pass: number; render: ImageIn } | { kind: 'fixing'; pass: number; note: string } | { kind: 'done' }`.
  - `DesignOutcome = { status: 'ok'; recipe: Recipe; cards: KidCards; checklist: string[]; view: View; history: { pass: number; render: ImageIn; verdict: 'matches' | 'edits'; note: string; edits: number }[] } | { status: 'noCreature' | 'declined'; message: string }`.
  - The loop: read, then build. For pass 1..passes: snapshot, then lookAgain. On `matches`, stop. Otherwise `applyEdits`, then rebuild. A rebuild failure keeps the last good recipe and stops.
- `tweakCreature(recipe, cards, words, deps)` returns `{ recipe, cards, note }` (applyEdits plus a rebuild).

- [ ] **Step 1: failing tests** with fakes:
  - progress order is reading → building → looking 1 → fixing 1 → building → looking 2 → done when pass 2 says `matches`;
  - it stops at `passes`;
  - `noCreature` is returned without building;
  - when an edit makes the build throw, the outcome keeps the previous recipe;
  - `levels` stretches a dull image to the full range and leaves a full-range image unchanged.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** the tests pass. In the browser, call `renderView` on the deer from the side and check the screenshot shows a clean side silhouette on a plain background. Commit `feat(designer): the drawing → creature loop with look-again`.

### Task 15: The lab UI

**Files:** create `src/lab/input.ts`, `src/lab/focus.ts`, `src/lab/gallery.ts`, `src/lab/ui/shell.ts`, `src/lab/ui/newCreature.ts`, `src/lab/ui/progress.ts`, `src/lab/ui/cards.ts`, `src/lab/ui/tweak.ts`, `src/lab/ui/galleryPanel.ts`, `src/lab/ui/workshop.ts`, `tests/lab/input.test.ts`, `tests/lab/focus.test.ts`, `tests/lab/gallery.test.ts`. Modify `src/lab/main.ts` and `src/lab/lab.css`.

**Interfaces:**
- `readPad(gp: Gamepad | null): PadState` with `{ lx, ly, rx, ry, a, b, x, y, lb, rb, lt, rt, start, select, up, down, left, right }`. Deadzone 0.15. `edges(prev, next)` returns the newly pressed buttons. Pure and tested.
- `class Input`: merges the gamepad, keyboard (WASD/arrows orbit, Q/E zoom, Enter = A, Esc = B, 1–8 pick a cast member, Tab = next panel) and mouse (drag orbit, wheel zoom). It emits `orbit(dx, dy)`, `zoom(d)`, `press(button)`.
- `focus.ts`: `nextFocus(rects: {id, x, y, w, h}[], current: string, dir: 'up' | 'down' | 'left' | 'right'): string`. Spatial navigation picks the nearest element in that direction (angle-weighted). Pure and tested. D-pad and left stick move the focus; A clicks; B closes the panel.
- `gallery.ts` (IndexedDB via `idb`, db `creature-lab`, store `creatures`):
  - `GalleryItem = { id: string; recipe: Recipe; cards: KidCards; drawing: Blob | null; words: string; thumb: Blob; history: DesignOutcome['history']; createdAt: number; native: boolean }`;
  - `saveItem`, `listItems` (newest first), `deleteItem`;
  - `exportAll(): Promise<Blob>` (JSON with base64 blobs) and `importAll(blob): Promise<number>` (skips existing ids).
  - Natives are seeded from `CAST` on first run and can't be deleted.
- Screens and panels:
  - **Stage view:** the creature, with the kid cards strip along the bottom.
  - The action bar: X walk, Y run, A open a menu, LB/RB previous or next creature, and the d-pad for eat, sleep, call and wander when the stage has focus. Left stick orbits, right stick zooms.
  - **New creature panel:** a drop zone and file picker plus paste, a words box, and a big "Bring it to life!" button.
  - **Progress panel:** friendly step text, plus a side-by-side "your drawing / what I built" panel during look-again, showing each pass's render.
  - **Tweak box:** a words box and an "Change it!" button. It shows the note and updates the cards.
  - **Gallery:** a grid of thumbnails (rendered with `renderView` from three-quarter). Pick one to show it, delete with a confirmation, export and import buttons.
  - **Workshop view:** hidden, toggled with Select or backtick. It shows the skeleton overlay (`SkeletonHelper` plus limb colours), the raw recipe JSON (read-only, with a copy button), the LOD selector, fur on/off, the quality tier, the backend name, fps, the look-again history with notes and edit counts, and the designer model shown from `/api/health`.
  - **Messages:**
    - `DesignerResting`: "The creature designer is resting — try again in a bit."
    - `DesignerInvalid`: "Hmm, that one got muddled — let’s try again!"
    - `noCreature`: "I couldn’t find a creature in that — try another drawing!"
- Style: warm, rounded panels; large type readable on a TV from the couch (base 22 px); a focus ring visible from 3 m away.

- [ ] **Step 1: failing tests:**
  - `readPad` deadzone, `edges`;
  - `nextFocus` in a 3×2 grid (right from the top-left goes to the top-middle; down goes to the bottom-left; nothing in a direction keeps the current);
  - gallery round-trip with `fake-indexeddb` (`npm i -D fake-indexeddb`): save, list, export, import into an empty db, same items;
  - natives can't be deleted.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** in the browser, drive the whole lab by keyboard only, then with simulated gamepad state (inject `navigator.getGamepads` with a stub through the dev hook `window.__lab.padStub`). Screenshot every panel. With a key configured, run one real "words only" creature ("a tiny round green creature with six legs and long floppy ears that eats flowers") end to end and screenshot each look-again pass.
- [ ] **Step 5:** commit `feat(lab): the creature lab — new creature, progress, cards, tweak, gallery, workshop`.

### Task 16: Drawing test set, performance check, README

**Files:** create `drawings.html`, `src/drawingset/main.ts`, `tests/drawings/README.md`, `tools/make-test-drawings.ts`, and `tests/drawings/*.png` (generated). Create `README.md`.

- `tools/make-test-drawings.ts` (run with `tsx`) writes 4 synthetic "kid-style" drawings as PNG through an SVG string and `@resvg/resvg-js` (`npm i -D @resvg/resvg-js`). It uses wobbly crayon strokes (jittered paths, thick round lines) on an off-white paper background:
  1. a purple six-legged lizard with three horns and a zigzag tail;
  2. a round orange fluff-ball with two tiny legs and huge ears;
  3. a long blue snake with butterfly wings;
  4. a green turtle-ish creature with a spotted shell and a long neck.
- `tests/drawings/README.md` explains how to add the son's drawings (drop photos as `*.jpg` here) and the scorecard (1 = "not mine", 2 = "kind of", 3 = "that's MY one!").
- `drawings.html` and `src/drawingset/main.ts` list every image in `tests/drawings` (`import.meta.glob('/tests/drawings/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true })`). A "Run all" button runs `designCreature` for each (passes from the settings), sequentially. It shows a table: the drawing, the final three-quarter render, a side render matching the drawing's view, the passes used, time, a token estimate where available (show "—" otherwise), and a 1/2/3 score picker saved to `localStorage`. "Open in lab" saves the creature to the gallery.
- Performance check: time `buildBody` LOD0 for all 8 cast members plus the generated creatures, and show it in the workshop. Measure fps in the lab on high quality with the heaviest cast member walking.
- `README.md` covers what the project is, `npm i`, copying `.env.example` to `.env` and setting the key, `npm run dev` (lab at `/`, drawing set at `/drawings.html`), `npm test`, the controls (controller and keyboard), the settings (`DESIGNER_MODEL`, passes), and links to the specs.

- [ ] **Step 1:** generate the drawings. Commit them.
- [ ] **Step 2:** build the page. With a key configured, run the 4 drawings and screenshot the scorecard plus each creature's side-by-side.
- [ ] **Step 3:** record the performance numbers (build ms per creature, lab fps) in the README "Status" section.
- [ ] **Step 4:** `npm test` all green, `npx tsc --noEmit` clean, `npm run build` succeeds.
- [ ] **Step 5:** commit `feat(lab): drawing test set, performance check and README`.

---

## Done when (from the spec)

1. All 8 native animals look natural and move convincingly (owner-approved screenshots).
2. The son recognises most of his drawings on the drawing-set scorecard (owner-run).
3. LOD0 build < 3 s, drawing-to-creature < 60 s, 60 fps in the lab on the RTX 3060 Ti.
