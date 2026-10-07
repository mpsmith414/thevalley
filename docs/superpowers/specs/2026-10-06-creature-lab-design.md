# Sub-project 1: Creature Lab — Design

Date: 2026-10-06 · Status: approved in brainstorming · Parent: `2026-10-06-vision-and-roadmap.md`

## Goal

Prove the riskiest part of the project. Any recipe, whether hand-written or produced by Claude
from a drawing or words, becomes a realistic 3D creature that looks like its source and moves
convincingly on its own. Deliver it as a player-facing lab the family can enjoy straight away.

## 1. The creature recipe

One versioned JSON document, validated against a strict schema (Zod). Out-of-range values are
clamped to sensible limits instead of failing. It has seven parts:

1. **Identity:** `schemaVersion`, `id`, `name`, the source (drawing image id and/or description), and a `seed`.
2. **Skeleton:** a free-form tree of parts. Each part has:
   - a parent;
   - an offset;
   - a thickness profile (it can taper);
   - a rough shape (round, long, flat or pointed);
   - a role tag: `head`, `neck`, `torso`, `leg`, `foot`, `wing`, `tail`, `fin`, `horn`, `antenna`, `ear`, `eye`, `mouth` or `other`.

   Any count and arrangement is allowed. A `mirror` flag declares a left/right pair once.
3. **Skin:** for each body region, a covering (fur with length and fluffiness, scales, feathers, smooth or wrinkled skin, shell, or slime). Plus a palette, patterns (stripes, spots, patches, rings, gradient, countershading, each with colours and scale), and eyes (size, colour, pupil shape).
4. **Movement hints:** preferred gait (walk, hop, slither, waddle, fly, swim, hover), bounciness, sway amounts and stance. Most movement is derived from the skeleton.
5. **Body and life:** size (m), mass, top speed, stamina, lifespan, age at maturity, litter size, and juvenile look (head ratio, fluffiness).
6. **Mind and senses:**
   - diet (plant kinds, prey size range, scavenger, flowers…);
   - temperament (shy↔bold, calm↔jumpy);
   - social style (solitary, pair, herd, pack, flock);
   - activity period (day, night, dawn and dusk);
   - habitat (ground, water, air, trees, burrow);
   - senses (field of view, acuity, night vision, smell, hearing, colour range).
7. **Inheritance:** which traits vary in offspring, and by how much.

Parts 5–7 are unused until later sub-projects, but every creature carries them from day one,
so lab creatures are valley-ready.

## 2. The body builder

A pure, deterministic pipeline (the same recipe gives an identical mesh) that runs in a
Web Worker:

1. **Pose:** expand mirrors, turn the part tree into 3D bones, detect the ground-contact parts (feet, belly or tail tip), and settle the body so it stands balanced over them.
2. **Grow:** each part becomes a tapered signed-distance shape. Parts merge with a smooth union whose blend radius depends on role: soft between neck and torso, tight at leg joints, sharp for horns and claws, flat for ears and fins.
3. **Mesh:** extract the surface at several detail levels (LOD0–LOD2), with smooth normals.
4. **Skin:** weight each vertex to its nearby bones by distance through the body, smoothed at joints.
5. **Per-individual variation:** individuals of a species share the base mesh. Differences such as bone-length scaling and colour shifts are applied at skinning and shading time, with no rebuild per animal.

## 3. Movement (procedural)

- **Legs:** an IK foot-planting system on the real ground surface. Gait phase comes from the leg count: 2 legs alternate; 4 legs walk, trot and gallop; 6 legs use the tripod gait; 8 legs use a wave gait; other counts use a generic wave.
- **Chains** (spine, neck, tail, legless bodies): follow-through and sway. Slither and swim undulation for legless and fish bodies.
- **Wings:** flap, glide and fold, with frequency scaled by size.
- **Life layer:** breathing, blinking, head look-at, and spring-driven secondary motion for ears, tails and antennae.
- **Actions:** idle, walk, run, eat (head down), drink, lie down and sleep, call, flinch and flee.

## 4. Skin system

One shared Three.js node (TSL) material for all creatures, so natives and drawn creatures look
like equals:

- Patterns are evaluated in body space, so they wrap naturally.
- Fur uses shell layers up close, with fewer at distance.
- Scales, feathers, shell and slime come from procedural surface detail and their light response.
- Eyes are separate, bright and lively, because they carry most of a creature's charm.

## 5. The Creature Designer service

A small Node service that holds the Anthropic API key, builds its own prompts and only answers
design requests. The browser drives the loop, because building and rendering happen there.

**Requests** (each one Claude call, with vision and structured JSON output):

1. **`read`**: input is an image and/or text. It returns:
   - the recipe;
   - a feature checklist (an exact list of what was seen: counts, colours, odd details);
   - the drawing's view (side, front or three-quarter);
   - the kid-card text (name, eats, speed, mood, special thing).

   The instructions prioritise faithfulness: never map to a known animal; count limbs, heads and horns exactly; take colours from the drawing; keep odd details; assume hidden sides mirror visible ones. They also keep everything family-friendly.
2. **`lookAgain`**: input is the original image, a render of the build from the same view on a plain background, the recipe and the checklist. It returns either "matches well" or a list of small recipe edits. The loop stops when Claude is satisfied or after N passes (default 3).
3. **`tweak`**: input is the recipe plus words ("make it bigger"). It returns small recipe edits.

**Settings:** the model (`claude-sonnet-5-5` by default, `claude-opus-5-5` optional) and the
number of look-again passes. Access codes and daily caps are deferred to deployment
(sub-project 5). The stable instructions and schema are prompt-cached. Expected cost is about
$0.20–0.35 per creature on Sonnet.

**Image preparation** (browser): downscale, straighten, and boost contrast for photographed
paper.

**Failure handling:**

| Case | Behaviour |
|---|---|
| No creature in the image (blank page, person) | A friendly "I couldn't find a creature in that, try another drawing!" Photos of real pets are fine. |
| Unsafe or unkind request, or a refusal | A friendly decline. The recipe format can't express gore anyway. |
| Invalid or incomplete recipe | Validate, then one automatic repair request, then a polite "let's try again." |
| Service offline or API error | "The creature designer is resting." The lab still works with saved creatures. |

## 6. The lab

- **Stage:** a round patch of real ground with grass, bumps and a slope, under soft natural light. Left stick orbits, right stick zooms. Buttons cycle the creature through walk, run, eat, sleep and call, plus a "wander" mode.
- **New creature:** drop in or upload a photo, type words, or both. Progress steps are shown ("Reading your drawing… → Building the body… → Taking a look… → Fixing the tail… → Ta-da!"), with a side-by-side "your drawing vs. what I built" panel during the look-again passes.
- **Kid cards and a tweak box** under the creature.
- **Gallery:** every creature is saved in the browser (IndexedDB), with export and import of backups.
- **Workshop view** (hidden toggle): skeleton overlay, the raw recipe, LOD and fur toggles, and the look-again history.
- **Input:** controller first, keyboard and mouse fully supported.

## 7. Native cast (the quality bar)

Hand-tuned recipes: **deer, rabbit, red fox, wolf, duck, hawk, trout, frog.** Together they
cover quadruped runners, hoppers, a walking and flying bird, a soaring raptor, a swimmer and an
amphibian.

## 8. Testing

- **Vitest, no screen:**
  - recipe validation and clamping;
  - mirror expansion and ground balance;
  - gait phase assignment for every leg count;
  - applying recipe edits;
  - determinism (the same recipe gives an identical mesh hash);
  - mesh sanity (finite values, a closed surface, vertex budgets per LOD).
- **Designer:** prompt and response handling tested against recorded responses, with no API cost.
- **Drawing test set:** about 10 real drawings (several by the owner's son, from tidy to scribbly), run on demand with a simple scorecard.
- **Browser checks:** screenshots of the cast and the test drawings sent to the owner.

## 9. Done when

1. All 8 native animals look natural and move convincingly on the stage.
2. The owner's son recognises most of his drawings ("that's MY one").
3. A body builds in under ~3 s, a drawing-to-creature run takes under ~1 minute, and the lab runs at 60 fps on the RTX 3060 Ti.

## Out of scope

The valley, behaviours and the simulation, the phone companion, sounds, sense lenses, releasing
creatures into a world, cloud deployment, access codes and caps, creature sharing, and event
recipes.
