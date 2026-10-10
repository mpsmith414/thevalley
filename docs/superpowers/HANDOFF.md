# Handoff: where Creature Ecosystem stands (2026-10-10)

Read this first in a new session, then the specs it points to.

## The project

A semi-realistic 3D living valley watched like a nature documentary, for the owner's family on the TV
(a 6-year-old included). A child's drawing or a few words become a real creature through Claude.

- Vision, decisions and roadmap: `docs/superpowers/specs/2026-10-06-vision-and-roadmap.md`
- Sub-project 1 design and plan: `docs/superpowers/specs/2026-10-06-creature-lab-design.md`, `docs/superpowers/plans/2026-10-06-creature-lab.md`
- Sub-project 2 design and plan: `docs/superpowers/specs/2026-10-07-valley-design.md`, `docs/superpowers/plans/2026-10-07-valley.md`
- Sub-project 3a design and plan: `docs/superpowers/specs/2026-10-09-lifeform-polish-shapes-faces-design.md`,
  `docs/superpowers/plans/2026-10-09-lifeform-polish-shapes-faces.md` (build ledger: `.superpowers/sdd/progress.md`)
- How it works, how to run it, controls, performance and status: `README.md`

## Where things are

- **Sub-project 1, the Creature Lab, is built** and merged to `main`. The owner tested it live with their own key and
  says it works.
- **Sub-project 2, the Valley, is built** and merged to `main` (21 tasks, about 60 commits; 447 tests (one wall-clock test runs only with `PERF=1`), `npx tsc --noEmit` clean, `npm run build` OK). The valley is on `/` (`index.html`), the lab on
  `/lab.html`.
- **Sub-projects 1 and 2 are on `main`**, pushed to the public GitHub repo `https://github.com/mpsmith414/thevalley`
  (merged with the owner's OK on 2026-10-09). Work new sub-projects on a feature branch and merge only on the owner's OK.
- **Sub-project 3a, Lifeform Polish: shapes and faces, is built on `feat/lifeform-polish` and NOT merged.** It waits
  for the owner's OK on the before/after sheets (`.shots/compare-faces.png`, `compare-34.png`, `compare-sides.png`,
  each row before | after for the 8 natives then the 6 test bodies; `valley-animals.png`; `after-drawings.png` and the drawings'
  `after-drawing-<n>-*.png`). 14 tasks plus 10b (body cache, worker pool) and 10c (face tuning), 31 commits with this one.
  The three measured "done when" items hold: every body builds in under 3 s (worst: the frog, 2.5 s), River Bend 14.9 ms
  median (15.0 before), tests, `tsc` and `npm run build` pass. What it added: schema v2 hints (`build`, `face`), an
  anatomy layer (muscles, joints, ribcage, feet, a sculpted face), sparse fine meshing with importance-weighted
  simplification (LOD0–2 from one chain), a `feature` vertex attribute (nose, inner ear, lips/mouth, hoof colours), a
  jaw bone, eyelids, face motion (call, chew, lap, yawn, lids, ears), a body cache in IndexedDB and a builder worker
  pool, and the native cast's hints and retune. README "Bodies and faces" has the details and numbers.
- `.env` (gitignored) holds the owner's key. They use a **multi-workspace key**, so `ANTHROPIC_WORKSPACE_ID` is also set and sent as the `anthropic-workspace-id` header.
- The designer asks Claude for **plain JSON** against the schema (written into the cached instructions). The recipe schema is too big for constrained structured outputs ("compiled grammar is too large"). The server validates leniently, normalises (it infers missing part roles from ids, among other repairs) and retries once.
- Owner's verdict on the lab: a first pass. **Shapes and faces bother them most.** That was sub-project 3a (above).
- Owner's verdict on the valley (2026-10-09, played it live): **"looks pretty awesome so far"**, ready to move on to
  Lifeform Polish. The open checks below (TV frame rate, night darkness, River Bend, audio clips) were not raised as
  blockers.

## The Valley: what the owner should check by eye and ear

The build was checked through screenshots in a hidden browser pane, so some things could not be:

1. **The contact sheet** (`.shots/valley-sheet.png`: eight viewpoints × dawn, noon, golden hour, night; bigger halves in
   `valley-sheet-day.png` and `valley-sheet-evening.png`). The spec's first "done when" is the owner's OK on it.
2. **Live frame rate on the TV** (the hidden pane stops animation frames). The serial frame-cost proxy is 7–16 ms per
   viewpoint (README table). On the PC: open the valley, let Auto measure, then the menu should still say Auto (High);
   on the dev server `__valley.resolution` in the console shows the fps and the resolution scale.
3. **The controller**: the start screen's "press any button" on a real pad (some browsers do not count a pad button as
   the press that allows sound; the screen then asks for a click), flying, viewpoints and the menu, streamed over Moonlight.
4. **Two sound clips**: the lake (a harbour pontoon recording, lapping) and the forest (raised +25 dB): do they sound right?
5. **Startup**: the console prints `valley: ready … s` each visit. Measured: first visit 11 s, later visits 9 s
   (production build). The spec wants later visits in "a couple of seconds": see the known issues.

## The Valley: known issues (condensed from the build ledger)

- **Later visits take ~9 s, not a couple of seconds.** Generation is cached, but the GPU pipelines (0.05–2.3 s each on
  D3D12, compiled mostly one after another by Chrome) are not, at least in the measuring browser. The opening view's
  pipelines take ~5.5 s; the rest compile behind the start screen. Options if it matters: check whether the owner's
  Chrome keeps a shader cache; smaller shaders (the 4-cascade shadow code is in every lit material, 45–85 KB of WGSL
  each); one terrain shader for every clipmap level (levels 0 and 1 compile separately, ~1 s each); or taking the
  start screen's press during loading.
- River Bend is the heaviest view (14.9–16.1 ms serial proxy depending on the run, about 13 ms live estimate). If the TV shows drops there, the near
  and mid tree bands (each ~4.4 ms of camera pass there) are the levers.
- Visual: night is very dark and blue; the forest floor is dark at dawn and golden hour; far meadows and rock faces read
  as flat colour from high up; the river reads as a straight canal near River Bend, with a pale rim along its banks;
  lupines are vivid; golden-hour haze goes khaki facing away from the sun; the fox is bright at dusk; birch crowns thin.
- Rendering: mid trees cast no shadow in the nearest cascade (a low-sun pop is possible); reeds, ducks and near-shore
  trees are not in the lake's mirror; a slight blue cast in shade.
- Smaller code items (untested paths, magic numbers, duplicated helpers) are in the Backlog below.

## three r186 workarounds: recheck every one on a three upgrade

three is pinned exactly (`"three": "0.186.1"`, `"@types/three": "0.186.0"`). Those marked *probed* warn once in the dev
console (`src/render/probe.ts`, or the patch's own warning) when three's internals have moved.

1. **Skinning buffer name** (`src/render/skinning-patch.ts`, *probed*): `ReferenceNode.setNodeType` names the bone buffer
   so every creature of a kind shares one pipeline.
2. **`renderer._isPreCompiling`** (`src/world/lake.ts`, *probed*): the mirror skips its render inside `compileAsync`.
3. **Mirror shadow hold** (`lake.ts` `keepShadows`, *probed*): wraps the reflector's `updateBefore` and scans
   `scene.children` for the key light and the cascades' stand-in lights to hold their shadow maps during the mirror pass.
4. **Mirror colour space** (`lake.ts` `shareMirrorPipelines`): wraps `getRenderTarget` to tag the mirror's targets linear
   so the mirror shares the main view's pipelines.
5. **`PhysicalLightingModel.direct` input shape** (`src/plants/impostor.ts` `CrownLightingModel`, *probed*): scales
   `input.lightColor`; if it is missing the crowns fall back to plain lighting instead of failing.
6. **`copyTextureToTexture` makes mips** (`impostor.ts` bake, *probed*): the last copy into each atlas generates its
   mips because the atlas has `generateMipmaps` set.
7. **Shadow pass reads `colorNode.a`**: the `setupDiffuseColor`/`setupPosition` overrides in `src/plants/material.ts`,
   `src/world/ground.ts` and `impostor.ts` rely on the shadow pass taking its alpha from the material's colour node.
8. **`compileAsync` gathers before its first `await`** (`src/render/compile.ts` `compileTogether`): callers undo
   temporary visibility as soon as it returns.
9. **CSM `normalWorld`** (`src/world/sky.ts`): `normalWorld` is used before the cascade branches, which would otherwise
   declare it inside one of them.
10. **`castShadow` is in every lit material's cache key** (`LightsNode.customCacheKey`): flipping it recompiles every lit
    pipeline (a 2–4 s stall at dusk), so `sky.ts` leaves it on and holds the shadow maps with `shadow.autoUpdate`
    (in no cache key) while the key light is out. Related: `compileAsync` skips shadow passes, so the animals' shadow
    pipelines are made by one warm-up render (`Residents.warmShadows`), and the sky's lights are on every layer so a
    creatures-only camera is lit like the main view and shares its pipelines.
11. **Flat integer varying for the creature's region** (`src/skin/material.ts` `regionNodes`, added in 3a): the seam fix
    reads `varying(int(...))` and relies on three's WGSL emitting integer varyings with `@interpolate(flat)` and on
    WebGPU's flat value coming from the triangle's first corner (the provoking vertex). If three changes either, region
    borders show a stripe of other regions' colours again (the fox's tail base is the test case: `t9-fox-side-lod2`).
    The eyelids (`src/skin/eyes.ts`) use only public API (a `DoubleSide` material, a per-object `onObjectUpdate`
    tint) and share the skinning patch (item 1) with the body.

## Lifeform Polish 3a: what the owner should check, and known issues

- **The sheets** (`.shots/compare-faces.png`, `compare-34.png`, `compare-sides.png`: each row is before | after; rows
  deer, rabbit, fox, wolf, duck, hawk, trout, frog, then the test bodies quadruped, snake, hexapod, blob, biped, bird;
  `valley-animals.png`: deer, fox and duck up close in the valley at noon; the four drawings' `after-drawing-<n>-face/34/side`).
  The spec's first "done when" is the owner's OK on them; merge only then.
- **Fur looks spiky at close range** (face portraits): unchanged by 3a, it is the fur shells; 3b's fur rework.
- **The frog's LOD0 is 1.5× the old triangle count**, not ~1.2× (100k triangles; the anatomy adds surface and the
  budget follows surface area). It costs nothing measurable at River Bend; the other bodies are 1.20–1.30×.
- **Build times are 5–15× the old builder** (0.25–2.5 s per body, the frog 2.5 s of a 3 s limit). The body cache and
  worker pool hide it after the first build; a new drawing waits about that long once.
- **Hawk:** folded wings stick out behind it on its upright perch (the rig folds wings to a fixed near-level
  direction), and it flies nose-up 30–40° (the rig never levels a flier). Both are motion (3b). Its hook tip is a thin,
  cell-limited cone; the beak region's border on the face is ragged with fur off.
- **Mouths:** the open mouth's cheeks are a stretched dark membrane (fine to the 0.3 rad the jaw is clamped to, long
  triangles beyond 0.4); the lip band is too narrow at LOD1/2 and on the trout; a small dark tick behind the duck's bill.
- **Upright heads** (the biped test body) get their mouth slit running up the face (the slit follows the head bone).
  Native animals are fine; a drawn upright creature could look odd.
- **Wolf:** the skull to muzzle profile is still a smooth wedge with little stop.
- **The four test drawings** went through the designer once at the end (Sonnet, 3 look-again passes each, 16 calls,
  no errors): Puffle (fluffball), Zigzag Crowner (six-legged lizard), Puffback Zigzag (snake with wing puffs), Dotty
  Longneck (turtle). The designer filled the new hints itself (muscle, feet, nose, brow, an inner-ear colour for the
  fluffball). Sheet: `.shots/after-drawings.png` (drawing | face | three-quarter | side). The `-face` shot frames the
  head bone, so for a creature whose head is most of its body (Puffle) it is far too close.

## Backlog

Kept on purpose from the build and the final review: small, none blocks the merge. Grouped by area.

**Generator** (`src/valley/generate`, `src/valley/geom.ts`)
- fbm/ridged are normalised by total amplitude and ridged hard-codes gain and lacunarity; shared noise instances correlate
  the floor roll and crest height; magic numbers in profile, rim and warp; despike is one Jacobi pass; the `max(1, Σe)`
  pin has a C1 kink; the closed Catmull-Rom in `layout.ts` is hand-rolled.
- `catmullRom`'s last gap is uneven; `nearestOnPolyline` walks empty rings on far queries; `catmullRomAt([])` returns `{}`.
- Erosion: the "roughly conserves" comments are stale (net land loss about −0.24 m; sediment left at `MAX_STEPS` is
  dropped); its strength depends on the grid, and tests at 257/513 say nothing about 2049.
- `smoothstep`/`clamp` duplicated (carve, shape, `render/terrain.ts`, `motion/secondary.ts`); `nearest` is a
  grid²-sized Int32Array (17 MB) that could be map-sized; only the first beach area is used; `textures.ts` imports
  `RIVER_SLOW`/`RIVER_FAST` from `carve.ts`; the determinism hash leaves out flow and kind.
- Valley queries misbehave on NaN input (`isWater(NaN)` is true); `trunksNear` pads by an undocumented < 4 m trunk
  radius; `biomeAt` recomputes its index five times; the beach is not damped by rock.
- Tests: no check that the river map's level equals the sampled surface or that flow follows the river; the flank test
  cannot tell uniform lowering; the lake-centre test hard-codes 16; the golden hash covers grid 257 only.

**Plants and impostors** (`src/plants`, `src/world/tiles.ts`)
- LOD1 can have no cards for plants with fewer than 4; rock seam/pole UVs; rock "detail 3" is 1280 triangles; fern has no
  budget parameter; boulder trunk 0.9 and stump 0.3 are guesses; `cardBottom` duplicates `card()` geometry.
- Scatter: overlaps across tile seams (accepted in the plan); the spacing test is O(11n²); trunk radius, log geometry and
  lean are not asserted; `b: undefined as never` and a dead `site.wet`.
- Impostors: mid bark fades whole while impostors dither; the bake's ms is CPU submit time; `CROWN_SHADE` and the bake
  ages are magic numbers; `impostor.ts` mixes bake, pack and material; hidden impostors cost about 1 ms (per-tile culling).
- Ground cover: `createGroundCover` is ~330 lines; slop ignores jitter; reeds are not in the mirror; lupines are vivid.
- `tiles.ts` and `material.ts` are big; the wind `rep` is rebuilt per update; float32 time uniforms grow without bound;
  the golden gust table was generated by the code it checks.

**Rendering and world** (`src/world`, `src/render`)
- The lake mirror's pipelines are not precompiled (the mirror skips `compileAsync`): the first time the camera comes
  within 400 m of the lake, the mid trees compile for the mirror's target (about 290 ms measured, once).
- One warm-up stall of about 1.2 s right after the animals' shaders are built (their shadow pipelines); it is behind the
  start screen when that is up. Some animals still show one 30–90 ms hitch on a first visit with no pipeline made
  (likely streaming).
- Terrain: hard select for detail normals against a smooth albedo blend; `frame()` evaluated twice per pixel; ground
  photos start downloading before the renderer; the CPU copy is freed after upload (no re-upload after device loss); the
  fallback path is untested; `+0` in `snapOrigin` is unexplained.
- Sky: the moon peaks at 18.6° (often behind ridges); the CSM fallback guards only the constructor; sun and moon vectors
  allocate per frame; azimuth and `jumpTo` edge tests are missing; latitude radians computed in two places.
- Water: the 3 px mirror nudge depends on the backend's orientation; `SKY_CAP` clips softly; whitewater starts on a hard
  line; bank teeth on the steep spring; sun-disc glint blobs; the mirror never draws near-shore trees, reeds or ducks.
- Shadows and light: mid trees cast no shadow in the nearest cascade (low-sun pop risk); a blue cast in shade;
  golden-hour haze goes khaki facing away from the sun; the overview is slightly soft; the fox is bright at dusk.
- No `dispose` for terrain, backdrop, lake, river or sky.

**Camera and input** (`src/camera`, `src/shared/input.ts`)
- Mouse accumulation and pointer lock are untested; look is pre-scaled by dt in `intentFrom`; `__valley.view` jumps
  without a glide; the glide ignores the walk toggle and vertical input; the camera can stick outside the border margin;
  trunks pop when descending past 30 m; the typing guard covers only input and textarea; `Stage.waterLevel` is unused.

**Residents** (`src/residents`)
- Per-individual geometry buffers (could be shared per species); partial spawn failure is untested; the quarter band's
  step differs from `PATH_STEP`; ducks are not in the mirror.
- `stageHabitat`: no test pins land against the legacy `randomLand`; fallback and bank edge cases untested; the valley
  clamp keeps y where the stage used 0; `nearestBank` has no edge or slope check; shore spots get a biome roll.

**App, menu and sound** (`src/app`, `src/audio`, `src/valley/cache.ts`)
- A slow resume (> 400 ms) shows the start screen's nudge until the next press; `start.ts`'s owl/null path is untested;
  mute is keyboard-only until the menu; the ridge is not windier (the formula uses height above ground); `menuControl`
  is untested; pacing exposes `feed`; `menu.open` naming; `ValleyClient.dispose` leaves pending requests unresolved.
- The cache: the save failure path and a round trip with tiles and meshes are untested; the pipeline test generates at
  module top level; the loading bar can step back within a frame; the resize listener is added before startup can fail.
- The lab's console shows two 500s on load (the API health check is 200).
- From the final review:
  - "lake distance" is computed two ways (`main.ts` nearest outline vertex; `audio/place.ts` raster search);
  - navigation links hard-code `/` and `/lab.html` instead of `BASE_URL` (`loading.ts`, `menu-control.ts`,
    `lab/ui/shell.ts`, `drawingset/main.ts`);
  - the builder worker is never terminated;
  - `ValleyClient` has no timeout;
  - `start.ts` and partial animal-spawn failure are untested.

## 3a backlog (Lifeform Polish: shapes and faces)

From the build ledger's minors and follow-ups (`.superpowers/sdd/progress.md`). None blocks the merge.

**For 3b (fur, motion, post-processing)**
- Fur at close range looks spiky (face portraits); fur thins over the wider lip band (fur length is `1 − feature.z`).
- Hawk: fold the wings along the back's slope (`secondary.ts` `flapWings` folds to a fixed `(±0.22, 0.05, −1)`), so they
  stop sticking out behind on the upright perch; level fliers in flight (the hawk flies 30–40° nose-up).
- Spine flex and weight shift (out of 3a's scope); alert ears linger 2–5 s after a glance at the camera.

**Meshing and simplification** (`src/builder/sparse.ts`, `simplify.ts`, `mesher.ts`, `build.ts`)
- Building only LOD2 costs a full build; frog build time headroom is ~0.5 s of the 3 s limit (2.5 s).
- The frog's LOD0 is 1.5× the old triangle count (the budget follows surface area, which the anatomy grows).
- The edge-length regulariser (REG 1e-3) raises coarse-LOD error (< 1‰); zero-area input faces are never removed (none
  on real bodies); rejected edges are retried only when an endpoint changes.
- `splitNonManifold` is silent on an unresolved crowded edge (never seen); trout normals disagree at 29–31 vertices
  (< 0.05 %); the raw-size cap estimate cannot see thin webs; the "two cells" Detail comment is stale.
- Tests: the trout is not in the real-body sampler test; `toFixed(4)` comparisons; the evaluation-count margin is thin
  (1.82M of 2M).

**Anatomy** (`src/builder/anatomy`)
- A backward-leaning upright bone gets a ventral "up" (no current body has one; drawn recipes could): flip so
  `up.z ≤ 0` for the neck and torso rules.
- The coarse SDF's "never overstates" comment over-claims for blended bodies (1.14 against 1.25 slack); `skeleton.min/max`
  cover bones only (~1 cm short).
- The belly-tuck gate ignores the blend k and leg radius (heuristic); the 0.75-cell clamp on r0 never binds.
- `Feature.cuts` is applied to every op in `marksAt` (the doc says marks only); three-region junction triangles are
  approximate in the material; the rabbit's ear root gets 0.25 at 1–2 vertices.
- Upright heads (the biped test body) get a mouth slit running up the face; the wolf's skull to muzzle has little stop;
  the hawk's hook tip is a thin cell-limited cone and its beak border is ragged.

**Jaw and mouth** (`src/builder/build.ts`, `weights.ts`, `anatomy/face.ts`)
- The all-or-none slot branch in skinning never fires and is untested (a latent jump).
- Open mouths: the cheeks are a stretched membrane (long triangles past 0.4 rad; the jaw is clamped to 0.3); corners
  stretch slightly on the deer; the rabbit's ear root folds (5 → 14) at 0.4 rad; four sub-pixel sliver flips.
- The biped test body has one fold (0.14 of the median) at 0.3 rad inside the lip line; no open-pose fold test; the
  wolf's rest-pose sliver test is fragile (one sliver flipped it during the retune).
- The lip band is too narrow at LOD1/2 and on the trout; a small dark tick behind the duck's bill (start the lip line
  about one band ahead of the hinge for beaks and bills); the frog has no production-cell slit-depth assertion.

**Eyes and lids** (`src/skin/eyes.ts`, `src/render/creature.ts`)
- `eyePlaces` and the belly fade run per animal per LOD (1–4 ms at spawn); the fade edge 1.6 is not pinned by a test;
  the fade radii are tied to `face.ts`'s socket constants by a comment only.

**Face motion** (`src/motion/secondary.ts`, `actions.ts`)
- A hold's release stomps intents (lab only today; the boundary is a comment); `earTwitch`/`springStep` allocate per frame;
  the chew lid ease is untested.

**Body cache and worker pool** (`src/builder/cache.ts`, `pool.ts`)
- A failed `used` write throws away a good cache hit (`cache.ts:60`); no v1 → v2 database upgrade test; one stray
  worker error retires that worker for good; a gallery of more than 32 creatures churns the cache.

**Recipe, hints, lab** (`src/recipe/hints.ts`, `src/lab`)
- Hints tests miss the hop penalty, shell, slits and slime-webbed branches; no test that the gallery passes a
  `RecipeError` through; `headCovering` assumes non-empty arrays.
- `portrait`: the camera restore is not in try/finally, it leaves the loop paused, and `-34`/`-side` aim at
  root y + rest height; `tools/perf.ts` does not flag bodies over 3 s.

## Roadmap

1. Creature Lab: built
2. The Valley: built and merged
3. **Lifeform Polish:** 3a (shapes and faces) built on `feat/lifeform-polish`, waiting for the owner's OK to merge;
   **3b (fur, motion, post-processing): next**, a brainstorm of its own on top of the new bodies.
4. The Living Ecosystem
5. Views and Eyes
6. Bring It to Life (phone)
7. Weather and Events
8. The Director

Follow the usual flow: brainstorm → spec → plan → build autonomously on a feature branch → screenshots → merge only
on the owner's OK.

**Next: Lifeform Polish 3b brainstorm (fur, motion, post-processing).** First get the owner's OK on the 3a sheets and
merge `feat/lifeform-polish` into `main` (then push). Then start a new chat with: "Read docs/superpowers/HANDOFF.md,
then start the Lifeform Polish 3b brainstorm (fur, motion, post-processing)." Begin on a new branch from `main` (for
example `feat/lifeform-polish-3b`). Starting points: the "For 3b" group in the 3a backlog (spiky close-up fur, the
hawk's wing fold and flight pitch, spine flex and weight shift), the fur shells in `src/skin/fur.ts`, the rig and
secondary motion in `src/motion`, and the valley's render path for post-processing (`src/render`, `src/world`), with
River Bend (`__valley.perf()`, 14.9 ms median now) as the frame budget to hold. Use `__lab.portrait(recipe, prefix)`
for before shots on `main` first, as 3a did.

## Dev tips that save time

- The preview tool reads `.claude/launch.json` from the session's original folder. Start the session in `CreatureEcosystem2` (the `valley` or `lab` configuration, port 5180), or run `npm run dev` yourself.
- The app window is often hidden, which freezes animation frames, CSS transitions and the screenshot tool. Use the dev hooks instead: in the valley `__valley.step(frames)`, `__valley.shot(name)`, `__valley.screen(name)`, `__valley.tour(prefix)`, `__valley.perf()`, `__valley.timings`; in the lab `__lab.step`, `__lab.shot`, `__lab.screen`, `__lab.portrait(recipe, prefix)` (the standard `-face`, `-34` and `-side` shots used for the 3a sheets; recipes in `__lab.CAST` and `__lab.fixtures`) and `__lab.face(cmd)` (blink, yawn, chew, alert, back). The drawing test set exposes `__drawings.rows` and `runOne(row)`; its recipes are not exposed, so 3a captured them by intercepting the gallery save of each row's "Open in lab".
- Live frame times (stalls, hitches): `__valley.frames.start()`, then play, then `__valley.frames.stop()` gives the real
  frames' intervals and working ms and lists the slow ones with the valley hour. In a hidden window call
  `__valley.frames.pump()` first: the live loop then runs from a timer that waits for the GPU after each frame (so GPU
  stalls still lengthen the interval); `pump(false)` puts the animation frames back. Shots land in `.shots/`. `resize_window` to 1920×1080 gives a real layout. `python tools/tile.py OUT IN... --cols N` makes contact sheets.
- To time a first visit, delete the IndexedDB database `creature-valley` and reload.
- WebGPU limits: at most 8 vertex buffers and 12 uniform buffers per shader stage. Pack attributes and uniforms accordingly.
- `npx tsx tools/valley-perf.ts 2049` gives valley generation times; `npx tsx tools/perf.ts` gives body build times; `npx tsx tools/make-test-drawings.ts` regenerates the synthetic test drawings.
