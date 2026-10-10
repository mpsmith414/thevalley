# Sub-project 3a: Lifeform Polish — Shapes and Faces — Design

Date: 2026-10-09 · Status: approved in brainstorming · Parent: `2026-10-06-vision-and-roadmap.md`
Branch: `feat/lifeform-polish`

## Goal

Creatures read as animals, not tubes: muscle and joint definition, real paws, hooves and toes, and faces with eye
sockets, lids, brow, cheeks, a nose, a jaw and cupped ears. It must work for the native cast **and** for anything drawn.

Lifeform Polish is split in two. **3a (this spec): shapes and faces.** 3b (fur, motion, post-processing) gets its own
brainstorm afterwards, on top of the better bodies.

Decisions from brainstorming:

| Question | Decision |
|---|---|
| Scope | Shapes and faces only; fur, motion and post-processing are 3b. |
| Where detail comes from | Automatic anatomy derived from part roles, plus a few optional recipe hints Claude can fill in. |
| Faces | Shaped, with key movement: lids, jaw and ears move. No mood system (needs sub-project 4). |
| Approach | Keep the SDF builder; add an anatomy layer, fine sampling near the surface and importance-weighted simplification. |

## Why the current bodies look blobby

- Every part is one round cone, blended with a smooth minimum. Nothing adds muscle, joints, sockets or creases.
- LOD0 samples ~110 cells along the whole animal, so a fox head (0.1 m of a 1 m fox) is ~11 cells across. No face
  detail can survive that, whatever shape the distance function has.
- Eyes are spheres stuck on the head; a blink squashes the eyeball.

## 1. Scope and "done when"

**In scope:** body anatomy, face sculpting, finer mesh detail where it shows, moving eyelids, jaw and ears, face
feature colours (nose, inner ear, lips, mouth, hoof), a hand pass over the native cast, the designer prompt learning
the hints, and the recipe upgrade from v1 to v2.

**Out of scope:** fur rework, spine flex and weight shift, post-processing, moods, teeth.

**Done when:**

1. The owner OKs a **before/after contact sheet**: the 8 natives (deer, rabbit, fox, wolf, duck, hawk, trout, frog),
   each as a face close-up, a three-quarter view and a side view; the odd test bodies (`tests/fixtures/recipes.ts`:
   quadruped, snake, hexapod, blob, biped, bird); the 4 test drawings run once through the designer at the end (about
   $1–1.50 on Sonnet with the owner's key); a few valley shots.
2. Every native and fixture body builds (all three LODs, main thread, `npx tsx tools/perf.ts`) in **under 3 s**.
3. The heaviest valley viewpoint (River Bend, `__valley.perf()`) is **no more than ~1 ms slower** than before.
4. All tests pass, `npx tsc --noEmit` is clean, `npm run build` works.

## 2. Recipe hints (schema v2)

`SCHEMA_VERSION` becomes 2. Three new top-level fields, all filled by `normalizeRecipe` when missing:

```ts
build: {
  muscle: number;            // 0..1: 0 soft and smooth (frog, baby, slug), 1 lean and sculpted (deer, wolf)
  feet: 'paws' | 'hooves' | 'talons' | 'webbed' | 'plain';
},
face: {
  nose: 'pad' | 'beak' | 'bill' | 'slits' | 'none';
  noseColor: string | null;  // #rrggbb; null = a darkened head colour
  lids: boolean;             // false for fish
  earInner: string | null;   // #rrggbb; null = a lightened ear colour
  brow: number;              // 0..1 brow ridge weight
}
```

`LIMITS` gains `muscle: [0, 1]` and `brow: [0, 1]`. The schema keeps no numeric ranges (as before).

**Inference** (`normalizeRecipe`, used for v1 recipes and for any missing field), from the head region's covering, the
gait, the habitat and the parts:

- `muscle`: 0.6 for fur, 0.5 for feathers, 0.3 for skin/scales, 0.15 for slime/shell; −0.2 for `hop` gait with a big
  torso radius (round bodies), clamped.
- `feet`: no foot parts → `plain`; feathers + `water` habitat → `webbed`; feathers → `talons`; fur,
  `massKg > 30`, legs and no prey (`preyMax` 0: a big plant-eater) → `hooves`; fur → `paws`; slime/skin + `water` → `webbed`; otherwise `plain`.
- `nose`: feathers + water → `bill`; feathers → `beak`; fur → `pad`; skin/scales/slime → `slits`; shell → `none`.
- `lids`: false when `gait` is `swim` and the habitat is only `water`; otherwise true.
- `brow`: 0.5 for `talons`/`beak` birds, 0.3 otherwise.

Upgrading a v1 recipe = setting `schemaVersion: 2` and inferring the three fields. The lab gallery and the valley's
caches run recipes through `normalizeRecipe` on load, so saved creatures keep working; bodies rebuild once because
`bodyKey` now includes `build` and `face`.

## 3. The builder: finer detail where it shows

`buildBody` today meshes the SDF three times on uniform grids (`LOD_CELLS = [110, 56, 28]`). New pipeline:

1. **Sparse fine sampling.** A coarse grid (cell `c`) finds the cells the surface passes through (|sdf| < cell
   diagonal). Only those blocks are resampled at `c / 4`, and surface nets runs on the fine samples (cells outside the
   band are treated as empty/full by sign). Fine cell target: ~440 cells along the longest dimension, but only near the
   surface.
2. **Importance-weighted simplification.** Quadric edge collapse (Garland–Heckbert) on the fine mesh, with each
   vertex's quadric scaled by an importance weight: high on the face (head, mouth, eye, ear parts and within reach of
   them), feet and joints, low on flanks and back. Collapses never flip a triangle or join different regions'
   boundaries unweighted. It stops at a triangle budget.
3. **LODs from one chain.** LOD0, LOD1 and LOD2 are snapshots of the same simplification at decreasing budgets. LOD0's
   budget is ~1.2× today's LOD0 triangle count for the same animal (computed from the body's surface area so it
   doesn't depend on today's mesher); LOD1 ~¼ of LOD0; LOD2 ~1/16.
4. Normals come from the SDF gradient at each final vertex, as now; skin weights, regions, partT/partS are computed on
   the simplified meshes, as now.

The pipeline stays pure and deterministic (fixed iteration order; ties broken by vertex index) and runs in the builder
worker.

**Fallback if simplification is too slow:** a coarse body mesh plus fine "detail boxes" around the head and feet,
joined with skirts. Only used if the build-time target can't be met.

## 4. The anatomy layer: bodies

New module(s) under `src/builder/anatomy/`. From the skeleton and the hints they produce extra SDF features, which
`bodySdf` blends in. Every amplitude scales with `muscle` and the local part radius, so a rule that doesn't fit a
strange body simply produces nothing.

- **Upper legs** (a `leg` whose parent is a `torso`): a muscle belly (an ellipsoid) in the upper third, pushed outward
  and slightly back (a haunch for hind legs, a shoulder and upper arm for front legs). Front/hind is decided by the
  leg's attach position along the torso chain.
- **Joints between leg segments**: a small knob at the joint (knee, hock, wrist), tight blend; the segment below is
  slimmed slightly (tendon).
- **Torso:** a ribcage swell on the front-most torso part, a belly tuck (smooth subtraction under the rear torso,
  stronger for lean animals). Quadrupeds (4 legs) also get faint shoulder blades and a spine line.
- **Neck:** a throat line underneath and a crest on top.
- **Feet**, by `build.feet`:
  - `paws`: four toe pads at the front of the foot with slight gaps;
  - `hooves`: a split tip with harder edges, marked `hoof` for the material;
  - `talons`: three toes forward and one back, pointed;
  - `webbed`: three splayed toes joined by a thin web;
  - `plain`: unchanged.
- **Sharper blends** where anatomy is sharper (behind the knee, under the jaw): the role blend table gains these cases.

## 5. The anatomy layer: faces

The face is the head part, its descendant `mouth` parts, and its `eye` and `ear` children.

- **Skull and brow:** a cranium swell at the back of the head; a brow ridge above each eye, sized by `face.brow`.
- **Eye sockets:** a soft smooth-subtracted hollow around each eye so the eyeball sits in the head. **Cheeks:** a
  gentle swell below and behind each eye.
- **Muzzle:** the snout (mouth parts) narrows towards its tip, with a shallow crease from the eye towards the nose.
- **Nose**, at the tip of the front-most mouth part (or the head's end if there is none), by `face.nose`:
  - `pad`: a rounded pad, two carved nostrils, a groove down to the lip;
  - `beak`: a hooked, sharp-edged tip;
  - `bill`: a flat, rounded bill;
  - `slits`: two small carved nostrils;
  - `none`: nothing.
- **Mouth:** a thin carved slit along each side of the muzzle, from the tip back to a corner below the eye. Inside it,
  a dark mouth surface with a tongue tone (marked `mouth`), so an opening jaw shows a mouth, not a hole.
- **Jaw bone:** added by the builder (not in the recipe), a child of the head bone, hinged near the mouth corner.
  Vertices below the slit and in front of the hinge are skinned to it (smoothly near the hinge). Recipes without a
  head get no jaw.
- **Ears:** the front face of each `ear` part is hollowed into a cup with a rim; the inside is marked `earInner`.
- **Eyelids:** separate meshes on each eye bone when `face.lids` is true: an upper and a lower partial shell just
  outside the eyeball, in the head region's colour, with a dark rim line. They replace the squash blink.

**Feature attribute:** one new vertex attribute (`feature`, vec4) marks nose, inner ear, lips/mouth and hoof weights.
It takes the last of WebGPU's 8 vertex buffers. The skin material reads it: the nose darker and wet-glossy (low
roughness, clearcoat), the inner ear lighter with a warm tint, lips dark, the mouth dark with a tongue tone, hooves
hard and matte. Fur shells fade out over nose, lips, mouth and inner ear.

Small details (nostrils, the mouth slit) are skipped in LOD2 and wherever they are smaller than ~2 fine cells, so they
can't tear the mesh.

## 6. Moving face parts

Hooked into `src/motion/actions.ts` and `src/motion/secondary.ts`.

- **Lids:** blink by the upper lid closing (and the lower rising a little); half-closed while resting or eating; shut
  while asleep.
- **Jaw:** opens for **call**; small rhythmic chewing while **eating**; small fast lapping while **drinking**; a slow
  yawn now and then when settling to sleep.
- **Ears:** today's twitch stays; they prick upright and forward on **alert/flinch**, flatten back when **fleeing**,
  droop a little when **asleep**, and swivel independently while idle.

The lab gets controls to trigger blink, yawn, call, chew and ear poses on the turntable.

## 7. Native cast, designer, upgrade, testing

- **Native cast:** each of the 8 gets its hints by hand (fox: `muscle` 0.6, `paws`, `pad` nose `#1a1410`, pale inner
  ear; deer: `muscle` 0.8, `hooves`; hawk: `talons`, `beak`, `brow` 0.7; and so on). Proportions are retuned where the
  new shapes show they are off. They stay the quality bar.
- **Designer:** the cached instructions describe `build` and `face` in a few lines with examples. Lenient server
  validation plus `normalizeRecipe` fill anything missing, so a reply without hints still works.
- **Tests:**
  - each anatomy rule fires where it should, skips odd parts, and is deterministic;
  - the sparse sampler matches a dense grid's surface;
  - simplification holds its budget, keeps the face denser than the flank, leaves no holes or flipped triangles;
  - jaw skinning: only lower-jaw vertices follow the jaw bone;
  - v1 → v2 upgrade and hint inference;
  - build-time ceilings for every native and fixture body;
  - eyelid and jaw action poses.
- **Screens:** before shots taken first on `main`'s code, after shots at the end, tiled with `tools/tile.py`.

## Risks

- **The simplifier** is the biggest new piece of code. Mitigation: build it first with tests, measure; the detail-box
  fallback in section 3.
- **Carved features tearing** at low detail: skipped below a size threshold and in LOD2.
- **Frame cost:** budgets keep LOD0 triangles at ~1.2× today's; fur shells multiply LOD0, so the budget is checked
  against the valley's River Bend perf number before merging.
