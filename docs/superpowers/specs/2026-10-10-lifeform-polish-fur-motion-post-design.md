# Sub-project 3b: Lifeform Polish — Fur, Motion, Post-processing — Design

Date: 2026-10-10 · Status: approved in brainstorming (the owner chose the scope, then: "go with your recommendations and
follow through on plan and implementation, I am expecting high quality") · Parent: `2026-10-06-vision-and-roadmap.md`,
after `2026-10-09-lifeform-polish-shapes-faces-design.md` (3a) · Branch: `feat/lifeform-polish-3b`

## Goal

The creatures 3a sculpted get a coat that reads as hair and feathers, a body that moves like an animal (spine, hips,
weight, head) and a picture that sits them in the valley (grade, glow, contact shading), all inside River Bend's frame
budget on the TV.

Decisions from brainstorming:

| Question | Decision |
|---|---|
| Priority | Fur and motion first; post-processing light (grade, bloom, creature contact shading); no DoF, no SSAO. |
| How close fur must hold | Whole-animal views (valley, the lab's three-quarter and side). Shells done well; no fins (sub-project 5 may add them, the shell work must not block that). |
| Feathers | Yes: a feather mode on the same shells. No separate flight-feather cards. |
| Coat control | A `coat` word per region, inferred when missing; the designer learns it; natives hand-tuned. |
| Motion | Gait body mechanics; starts, stops and turns; fliers and swimmers (with the hawk fixes). Idle mannerisms are sub-project 4. |
| Post | Time-of-day grade (also fixing the known look issues), gentle bloom, creature contact shading without a screen pass. |
| Approach | Evolve what's there: shell shader rewrite with a groom attribute; procedural motion layers; three's `RenderPipeline`. |

## 1. Scope and "done when"

**In scope:** groom (hair direction) and cavity shading baked by the builder; the `coat` hint (schema v3); a new fur
shell shader with strand lighting, guard hairs, clumping and a feather mode; motion layers for legged bodies, starts,
stops, turns, fliers and swimmers; a post-processing pipeline for the valley and the lab; a time-of-day grade; bloom;
contact shadows under creatures; the listed look fixes; the designer prompt; the native cast's coats; tooling for
motion filmstrips.

**Out of scope:** fur fins or hair cards; flight-feather cards; idle mannerisms (shake, scratch, stretch, lie down
properly); moods; DoF; screen-space AO; motion blur; TAA.

**Done when:**

1. The owner OKs the sheets (§10): fur before | after for the 8 natives and 6 test bodies (face, three-quarter, side);
   motion filmstrips and animated GIFs; the valley contact sheet (8 viewpoints × dawn, noon, golden hour, night)
   before | after.
2. Every native and fixture body still builds (all LODs, `npx tsx tools/perf.ts`) in **under 3 s** (the frog is the
   tight one: 2.5 s today).
3. River Bend (`__valley.perf()`, High) is **no more than 1.0 ms slower** than `main` measured in the same session,
   with everything on (post-processing, new fur, contact shadows).
4. All tests pass, `npx tsc --noEmit` is clean, `npm run build` works.

## 2. Groom and cavity: what the builder adds

Two per-vertex values, computed in the builder (pure, deterministic, in the worker) for every LOD:

- **Groom**: a unit tangent, the way the hair lies at rest.
- **Cavity**: 0..1, how open the surface is (1 = open, lower in armpits, groins, under the belly, behind the ears, in
  the eye sockets and mouth corners).

**Groom rule.** Each vertex has a dominant bone (`boneOf`). The flow direction comes from the bone's role:

| Role | Hair flows |
|---|---|
| torso | towards the tail (from the torso chain's head end to its tail end) |
| neck | from the head towards the body |
| head, mouth | from the nose back over the skull (opposite the head/mouth bone direction) |
| leg, foot, tail, ear, antenna, wing, fin | from the bone's root to its tip |
| eye | none (zero groom; no fur there) |

Then: blend the flow of the vertex's skin-weight bones (weighted), add a small downward bias on steep sides (0.25 ×
world down; hair falls a little on flanks), project onto the tangent plane (remove the normal component), and run 4
Laplacian smoothing passes over the mesh's vertex adjacency, re-projecting and normalising after each pass, so groom
turns smoothly across bone borders (no parting lines at the shoulders and hips). Where the projection degenerates
(flow parallel to the normal, e.g. a tail tip) the vertex takes its smoothed neighbours' groom.

**Cavity rule.** SDF ambient occlusion along the normal at rest: for k = 1..5, step `d_k = k · h` with `h` = 0.35 ×
the vertex's part radius (`r` at that point along the bone), clamped to [1 mm, 3 cm];
`occ = Σ w_k · max(0, d_k − sdf(p + n·d_k)) / d_k` with `w_k = 0.5^k`, normalised so a flat open surface gives 0;
`cavity = clamp(1 − 1.2 · occ, 0.25, 1)`. It is computed with the coarse SDF on the LOD0 vertices; LOD1 and LOD2
vertices take the value of the LOD0 vertex with the same simplifier `source` index (a vertex alive at a coarser snapshot was alive at LOD0), so the cost is one
pass. Budget: under 0.15 s on the frog. If the frog goes over 3 s, the cavity pass drops to 3 steps.

**Packing.** WebGPU allows 8 vertex buffers and all are used. `restNormal` is a copy of `normal`. It becomes `groom`
(vec4: groom xyz, cavity w), and the skin material reads its rest normal from `attribute('normal')` (the geometry's own
buffer, which skinning never rewrites). If that read proves to be skinned in three r186, the fallback is to drop
`partInfo.w` (the belly flag) into `bodyPos.w` as a second packed value. The plan's first task proves which one works.

`BodyData`/`LodMesh` gain `groom: Float32Array` (4 per vertex). The body cache's database version goes up (cached
bodies lack the new data and rebuild once).

## 3. The `coat` hint (schema v3)

`SCHEMA_VERSION` becomes 3. Each region gains:

```ts
coat: 'sleek' | 'soft' | 'shaggy' | 'woolly' | 'bristly' | 'smooth' | 'downy' | null;
// fur: sleek (deer, otter), soft (fox, rabbit), shaggy (bison mane, long-haired), woolly (sheep, crimped and dense),
//      bristly (boar, hedgehog-ish: stiff, sparse, thick)
// feathers: smooth (sleek contour feathers), downy (fluffy chicks, owls' fluff)
// null for other coverings
```

**Inference** (`normalizeRecipe`, for v2 recipes and missing values): fur → `woolly` when fluff ≥ 0.75 and length
< 0.05 m; `shaggy` when length ≥ 0.05 m or fluff ≥ 0.75; `sleek` when length < 0.008 m and fluff < 0.3; else `soft`.
Feathers → `downy` when fluff ≥ 0.5, else `smooth`. Other coverings → `null`. A fur word on a feather region (or the
reverse) is repaired to the inferred one; any value on a non-hair covering becomes `null`.

Upgrading v2 → v3 sets the version and infers `coat`. `bodyKey` does not include `coat` (it changes no geometry), so a
coat edit does not rebuild the body. The designer's cached instructions teach the words with one line of guidance each.

**Coat parameters.** Each coat maps to shader settings, packed per region beside the existing region uniforms:

| Coat | Lean | Density | Strand radius | Guard hairs | Clump | Crimp | Sheen | Droop |
|---|---|---|---|---|---|---|---|---|
| sleek | 0.85 | high | thin | few, short | 0 | 0 | high | low |
| soft | 0.55 | high | medium | some | 0.25 | 0 | medium | low |
| shaggy | 0.45 | medium | medium | many, long | 0.55 | 0.15 | medium | high |
| woolly | 0.15 | very high | thick | none | 0.35 | 0.8 | low | low |
| bristly | 0.25 | low | thick, stiff | many | 0 | 0 | low | none |
| smooth (feathers) | n/a | feather lattice | n/a | n/a | n/a | n/a | medium | n/a |
| downy (feathers) | 0.3 | high | thin | none | 0.4 | 0.3 | low | low |

Lean = how far a strand lies over along the groom (0 stands up, 1 lies flat). The table's words become numbers in one
`COATS` table in `src/skin/coat.ts`, tuned by eye during the build. `fluff` still adds wander on top.

## 4. Fur shells, rewritten (`src/skin/fur.ts`)

The shells stay (one shared material per species, `shellT` per object). What changes:

- **Strands lean along the groom.** Shell offset = `normal · len · t · (1 − lean·t)` + `groom · len · lean · t^1.5`
  (+ droop, + fluff wander as now). Low shells are near the skin; outer shells slide along the groom, so each strand
  reads as a hair lying over, not a spike.
- **Strand size scales with the animal.** Strand cell size = clamp(0.12 × fur length, 0.4 mm, 2.5 mm) instead of a
  fixed 3.1 mm, and the coat's radius factor. A deer (12 mm fur) gets ~1.4 mm cells, a fox's tail ~2.5 mm. Each strand
  tapers (radius × (1 − 0.7t)) but never to a cone tip: the outer shells use a hash threshold so strands end at
  different heights (length variation 0.6–1.0), which kills the "every spike the same height" look.
- **Guard hairs**: a second, sparser lattice (cell × 2.5) of longer, thicker strands (length × 1.25) that are the only
  thing drawn above t = 0.75 for coats that have them; they catch the light (higher sheen) and break the outline.
- **Clumping**: strands within a clump cell (Worley, cell × 6) bend towards the clump centre as t rises (× clump).
- **Crimp**: a low-amplitude wave along t (woolly, a little on shaggy).
- **Edges**: `alphaToCoverage` with the 4× MSAA target replaces the hard `alphaTest` cut, so strand edges are smooth
  and the coat stops sparkling. (The alpha test stays as a fallback where MSAA is off.)
- **Strand lighting**: a custom lighting model (`FurLightingModel`, like `impostor.ts`'s `CrownLightingModel`):
  Kajiya-Kay with two shifted specular lobes along the strand tangent T (groom after lean): a primary one shifted
  towards the root (light-coloured) and a secondary one towards the tip (tinted by the hair colour, broader); a wrapped
  diffuse term (fur scatters, so the terminator is soft); and backlight scatter: when the light is behind the strand,
  the outer shells glow a warm rim (`(1 − t)` weighted, × sheen). Ambient is multiplied by the cavity and by the
  existing root darkening.
- **Skin under the fur** gets the hair colour and the cavity term too, so gaps between strands look like dense
  underfur, not bare skin.
- **Shell counts**: High 16 (was 12), Medium 8, Low none. The lab uses 24 for its stage. The perf budget (§1) decides
  the final High count; 12 stays if 16 doesn't fit.

**Feather mode** (regions with feathers; `coat` smooth/downy): `smooth` draws feathers, not strands. The lowest 4
shells only: a 3D jittered lattice (cell = clamp(0.5 × length, 6 mm, 25 mm)); each fragment checks its own and the 7
neighbours upstream along the groom and takes the frontmost covering feather (the one whose root is furthest
downstream: feathers overlap like roof tiles). A feather is an ellipse elongated along the groom (2:1) with a darker
shaft line, soft barb streaks across the vane, a slightly lighter edge, and a tip that lifts on the outer shells (relief
at the overlaps). `downy` uses the strand path with the downy row of the table. Feathers get the same lighting model
with low lean and a narrower, stronger specular (contour feathers are glossier).

## 5. Motion: body mechanics in the gait (`src/motion/body.ts`)

A new `BodyMotion` layer, run by the rig after it has placed the root and before secondary motion. It owns the torso
bones of legged bodies and the root's fine pose. It is a set of small, pure functions plus a small state object, each
tested on its own.

**Which bodies.** Legged bodies (≥ 2 legs) use these layers. Legless bodies keep today's slither and swim (§7). The
torso chain stops being the snake "spine" for legged bodies: today a three-bone torso (the deer: hips → belly → chest)
gets the snake wave, which this replaces.

- **Spine flex.** The torso chain bends: laterally into turns (total bend ∝ turn rate × body length, capped at
  0.35 rad, spread along the chain); vertically with the gait in bounding gaits (gallop, hop): flexion when the hind
  feet reach forward, extension at push-off, amplitude ∝ `bounce`; a little in trot. Single-bone torsos get the
  lateral bend through the neck and tail only.
- **Pelvis and shoulder roll.** The hips drop on the side whose hind leg is swinging and roll back at its landing
  (2–4°, × (1 − speed share in gallop)); the shoulders counter-roll on the front legs' phase. Pelvis yaw swings
  slightly with the stride (the hip reaches forward with its leg). With a single torso bone the root carries the hips'
  roll and the front half follows at half weight.
- **Weight shift.** At walking speeds the body slides sideways over the stance legs (the root offset towards the side
  with more feet down, ∝ hip width × (1 − speed/trot speed)); bipeds shift strongly (most of a hip width) and
  quadrupeds lightly.
- **Bob, re-phased.** The vertical bob follows the actual stance legs (lowest at mid-stance of the dominant pair,
  highest at push-off) instead of a fixed `cos(4πphase)`. A gallop adds a body pitch rock (nose down at the front
  landing, up at take-off).
- **Head stabilisation.** The neck counter-rotates the body's pitch, roll and bob so the head stays steady in the world
  (70 % at walk, 85 % at gallop), then adds its own nod: quadrupeds nod down as a front foot plants (strong for long
  necks: deer). **Bird head bob**: two-legged feathered walkers (the duck on land) hold the head still in the world
  during the stance and thrust it forward at each step (hold-and-thrust), damped for ducks (amplitude × 0.4), full for
  small ground birds.
- **Tail and ear follow-through.** Tails and ears get the body's acceleration as an input (a spring lagging the root's
  vertical and sideways acceleration), so they swing after bounds and stops.

## 6. Motion: starts, stops and turns

In `CreatureRig.locomotion` and `BodyMotion`:

- **Anticipation.** When wanted speed rises from near zero, the body first dips and leans forward (pitch −4° to −6°,
  height −3 % of leg length) for ~0.15–0.25 s (scaled by size: small animals snap quicker) before the speed ramps up.
- **Acceleration lean.** Body pitch follows forward acceleration (lean forward speeding up, back braking), and roll
  follows the sideways acceleration (speed × turn rate) a little into the turn (quadrupeds lightly; bipeds more).
- **Settle.** When the creature stops, a damped spring on body pitch and height overshoots (forward, then back) and
  settles within ~0.6 s.
- **Squaring up.** After stopping, any planted foot more than 25 % of a stride from its home takes one proper step to
  it, one leg at a time in gait order (replacing the slow invisible slide). Standing for a long time (8–20 s, seeded),
  one leg re-plants with a small step and the weight shifts a little.
- **Turns lead with the head.** The head looks into the turn first (a look target ahead along the new heading, set by
  the rig while turning > 0.4 rad), the spine bends (§5), the tail counters. Turning on the spot keeps its stepping.

## 7. Motion: fliers and swimmers

- **Wings fold along the back.** The fold direction is built from the torso's current back direction, not a fixed
  vector: along the back towards the tail, lifted to lie on the back's surface, a little outward at the shoulder and
  inward at the tip (the tips may cross over the tail). On the hawk's upright perch the folded wings follow the body's
  slope and stop sticking out behind.
- **Level flight.** In flight the root's pitch removes the rest-pose torso tilt (the hawk's torso is built pitched up
  ~27°), so the body axis is level when cruising, plus the climb pitch (as now). Perched and walking, the rest posture
  stays.
- **Bank and steer.** Fliers bank in proportion to speed × turn rate (coordinated turn, capped at 0.7 rad); the tail
  fans and twists with turn and climb; flapping is stronger and faster when climbing or slow, and gliding when level
  and fast.
- **Take-off and landing.** Take-off: a crouch (0.2 s), a jump from the legs and two big downstrokes. Landing: below
  one body length of height on the final approach the body pitches up (flare, up to 40°), the wings spread wide and beat
  in short braking strokes, and the legs reach forward and down; on touchdown the body settles (§6) and the wings fold.
- **Fish.** Carangiform swimming: the wave's amplitude grows towards the tail (∝ (i/n)², small at the head), its
  wavelength ~1 body length, its frequency ∝ speed / body length (plus a slow idle). The head counter-yaws a little. A
  turn is a C-bend. Pectoral fins scull slowly when hovering and fold back when fast. Dorsal and tail fins follow the
  wave.
- **Floaters** (the duck on water): the paddling alternates per leg under the body (as now, phase-correct), and the
  body bobs and yaws slightly with the water (a small seeded wobble).
- **Snakes and other legless bodies**: the existing slither stays, with the same (i/n)-growing amplitude as the fish.

## 8. Post-processing (`src/render/post.ts`)

The valley and the lab render through three's `RenderPipeline` (r186; `PostProcessing` is its deprecated name):

```
pass(scene, camera, { samples: 4 })  →  bloom (HDR)  →  tone mapping + exposure (renderer's settings)
  →  grade (display-referred)  →  output colour space
```

- **Anti-aliasing**: the scene pass keeps 4× MSAA (the canvas's `antialias` no longer applies), which also enables the
  fur's alpha-to-coverage.
- **Bloom**: three's `BloomNode` on the HDR colour, high threshold (only the sun disc, the sky's brightest glow, water
  glints, bright snow), strength ~0.15, radius ~0.4. High: on. Medium: on, at half resolution. Low: off.
- **Grade**, a small custom TSL node, per pixel: white balance (warmth and tint), lift / gamma / gain as colours,
  contrast about a pivot, saturation (with a vibrance limit so already-saturated colours move less), and a soft
  vignette (0.15). Its parameters are a **grade table** alongside the lighting table (`src/world/lighting.ts`), keyed
  by the sun's elevation and interpolated the same way, so dawn, noon, golden hour and night each have their own look.
  `LightState` gains `grade`. `sky.ts` eases it like the exposure.
- **The lab** gets a fixed neutral "studio" grade (warmth 0, very light contrast, vignette 0.1) and keeps AgX tone
  mapping; the valley keeps Neutral.
- **Everything that rendered with `renderer.render(scene, camera)`** for the main view (the valley's loop, the lab's
  loop, `snapshot.ts`, the dev hooks `shot`, `screen`, `tour`, `perf`) goes through `post.render()`. Impostor bakes,
  the lake mirror and the shadow warm-up keep rendering directly. `compileTogether` also compiles the pipeline's own
  passes.
- **Workarounds**: the lake mirror's `_isPreCompiling` and shadow-hold patches are rechecked under the pipeline (the
  mirror renders inside the scene pass). Any new reliance on three internals is listed in HANDOFF's r186 list with a
  probe.
- **Cost** (target, High, 1080p): scene pass resolve plus grade under 0.4 ms; bloom under 0.5 ms.

**Look fixes** (each checked on the before/after sheet):

- *Night too dark and blue*: the night grade lifts the shadows a little towards neutral grey-blue and pulls saturation
  down (night vision is grey), and the night rows' exposure is retuned with it.
- *Golden-hour haze goes khaki facing away from the sun*: fixed at its source: the haze colour away from the sun mixes
  towards the sky's horizon colour, not the warm fog colour (`sky.ts`).
- *Lupines too vivid*: their card colours are desaturated (the flower card tint), not graded.
- *A slight blue cast in shade*: the hemisphere ground colour and the grade's lift balance it.
- *The fox bright at dusk*: rechecked after the grade and fur lighting; tuned in the fox's colours only if still bright.

## 9. Contact shading for creatures (`src/render/contact.ts`)

- **Cavity on the creature**: the skin and the fur multiply their ambient light (`aoNode`) by the cavity (§2), and
  the fur's root darkening stacks with it. Armpits, groins, the belly line and behind the ears darken in shade, at night
  and in the lab alike.
- **Ground contact shadow**: one `InstancedMesh` (one draw for all creatures) of soft dark ellipses on the ground under
  each creature: sized from its skeleton footprint (× 1.15), placed at the ground under the root, tilted to the ground's
  normal (three height samples), drawn multiply-darkening with depth test, no depth write and a polygon offset. Opacity
  0.35 (tuned), fading out with height above the ground (gone at one body length: flying, a jump), and off for
  creatures in water. The lab's stage shows it too. Creatures beyond LOD1 range skip it.

## 10. Tooling and sheets

- **Before shots first**, on `main`, as 3a did: `__lab.portrait(recipe, 'before3b-<name>')` for the 8 natives and 6
  fixtures, and `__valley.tour('before3b')` at the four times.
- **Motion clips**: `__lab.clip(recipe, clipName, prefix, frames = 16, every = 4)` drives a scripted clip with fixed
  steps and saves each frame (`walk`, `trot`, `gallop`, `start-stop`, `turn`, `perch`, `takeoff`, `fly`, `land`,
  `swim`, `float`, `hop`); `tools/tile.py` makes filmstrips; a new `tools/gif.py` makes animated GIFs from the same
  frames (Pillow). Clips are deterministic (seeded, fixed dt), so before and after strips compare frame by frame.
- **Sheets**: `compare3b-fur-{face,34,side}.png` (before | after rows), `motion-<clip>.png` and `.gif` per animal, and
  `valley3b-sheet.png` (before | after per time of day).

## 11. Testing

Unit tests (vitest, as now) for the pure parts:

- Groom: on the deer, flank grooms point tail-wards (mean dot with −z > 0.7), leg grooms point down (dot with −y >
  0.7), the head's point back from the nose, every groom is tangent (|g·n| < 0.05) and unit, and neighbouring grooms
  agree (mean angle between neighbours < 15°). Deterministic across runs.
- Cavity: in [0.25, 1]; open back > 0.9; armpit and groin vertices (between the upper leg and the torso) average below
  the back by ≥ 0.15; one pass on LOD0 only (LOD1/2 inherit).
- Coat: inference table cases; v2 → v3 upgrade; repairs (fur word on feathers); `bodyKey` unchanged by coat.
- Motion: pelvis roll is antisymmetric across the stride and in the stated range; spine bend has the turn's sign and is
  capped; weight shift moves towards the stance side; head stabilisation cuts the head's world pitch variance by ≥ 50 %
  against the root's over a walk cycle (rig integration test on the deer); the hawk's folded wing tip lies within 25° of
  the back direction both level and perched; level flight keeps the hawk's body axis within ±8° of horizontal while
  cruising; landing pitches up before touchdown; the fish wave's amplitude grows head to tail; anticipation delays speed
  rise and dips the body; the settle spring settles within 0.8 s; squaring-up steps happen only past the threshold.
  Legless bodies keep the slither.
- Post: grade table interpolation (continuity across rows, night row values), the grade node's identity settings
  return the input; the contact shadow's placement, size and fade.
- Browser checks (dev hooks): the pipeline renders in both pages, MSAA and bloom on, no console errors, the perf numbers
  of §1.

## 12. Order of work

Fur first (the groom and cavity bake, schema v3, the shader, feathers, the cast's coats), then motion (body mechanics,
starts, stops and turns, fliers and swimmers), then post-processing (pipeline, grade, bloom, contact, look fixes), then
the designer prompt, the sheets and the final perf check. Each part ends with its own screenshots so problems show early.
