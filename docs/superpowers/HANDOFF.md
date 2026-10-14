# Handoff: where Creature Ecosystem stands (2026-10-14, 3b fur built and waiting on the owner's OK; next: merge, then 6)

Read this first in a new session, then the specs it points to.

## The project

A semi-realistic 3D living valley watched like a nature documentary, for the owner's family on the TV
(a 6-year-old included). A child's drawing or a few words become a real creature through Claude.

- Vision, decisions and roadmap: `docs/superpowers/specs/2026-10-06-vision-and-roadmap.md`
- Sub-project 1 design and plan: `docs/superpowers/specs/2026-10-06-creature-lab-design.md`, `docs/superpowers/plans/2026-10-06-creature-lab.md`
- Sub-project 2 design and plan: `docs/superpowers/specs/2026-10-07-valley-design.md`, `docs/superpowers/plans/2026-10-07-valley.md`
- Sub-project 3a design and plan: `docs/superpowers/specs/2026-10-09-lifeform-polish-shapes-faces-design.md`,
  `docs/superpowers/plans/2026-10-09-lifeform-polish-shapes-faces.md` (build ledger: `.superpowers/sdd/progress.md`)
- Sub-project 3b design and plan: `docs/superpowers/specs/2026-10-10-lifeform-polish-fur-motion-post-design.md`,
  `docs/superpowers/plans/2026-10-10-lifeform-polish-fur-motion-post.md` (build ledger:
  `.superpowers/sdd/2026-10-10-lifeform-polish-fur-motion-post/progress.md`)
- How it works, how to run it, controls, performance and status: `README.md`

## Where things are

- **Sub-project 1, the Creature Lab, is built** and merged to `main`. The owner tested it live with their own key and
  says it works.
- **Sub-project 2, the Valley, is built** and merged to `main` (21 tasks, about 60 commits; 447 tests (one wall-clock test runs only with `PERF=1`), `npx tsc --noEmit` clean, `npm run build` OK). The valley is on `/` (`index.html`), the lab on
  `/lab.html`.
- **Sub-projects 1 and 2 are on `main`**, pushed to the public GitHub repo `https://github.com/mpsmith414/thevalley`
  (merged with the owner's OK on 2026-10-09). Work new sub-projects on a feature branch and merge only on the owner's OK.
- **Sub-project 3a, Lifeform Polish: shapes and faces, is built and merged to `main`** (owner's OK on 2026-10-10,
  pushed to GitHub). The owner reviewed the before/after sheets (`.shots/compare-faces.png`, `compare-34.png`, `compare-sides.png`,
  each row before | after for the 8 natives then the 6 test bodies; `valley-animals.png`; `after-drawings.png` and the drawings'
  `after-drawing-<n>-*.png`; after the final review also `final-ears-*`, `final-biped-*`). 14 tasks plus 10b (body cache,
  worker pool) and 10c (face tuning), then three final-review fix commits (ears, upright heads, LOD0 cap and small items);
  the final whole-branch review found it ready to merge.
  The three measured "done when" items hold: every body builds in under 3 s (worst: the frog, 2.4 s), River Bend 14.9 ms
  median (15.0 before), tests, `tsc` and `npm run build` pass. What it added: schema v2 hints (`build`, `face`), an
  anatomy layer (muscles, joints, ribcage, feet, a sculpted face), sparse fine meshing with importance-weighted
  simplification (LOD0–2 from one chain), a `feature` vertex attribute (nose, inner ear, lips/mouth, hoof colours), a
  jaw bone, eyelids, face motion (call, chew, lap, yawn, lids, ears), a body cache in IndexedDB and a builder worker
  pool, and the native cast's hints and retune. README "Bodies and faces" has the details and numbers.
- **Sub-project 3b Part 1, the fur (plan Tasks 1–9 plus the fur checkpoint), is built on `feat/lifeform-polish-3b`,
  NOT merged: it waits on the owner's OK.** Tasks 1–6 are already on `main` (fast-forward to `fcfd649`); the branch adds
  Tasks 7–9 (strand lighting and cavity shading, feather mode, the cast's coats and the fur tune) and the checkpoint's
  docs. What the fur is and its numbers: README "Fur and feathers". What to look at (all in `.shots/`, gitignored):
  - `compare3b-fur-face.png`, `compare3b-fur-34.png`, `compare3b-fur-side.png`: each row before (`b3-*`) | after
    (`a3-*`), rows deer, rabbit, fox, wolf, duck, hawk, trout, frog, then the test bodies quadruped, snake, hexapod,
    blob, biped, bird. The face sheet shows the change best: the studs and spikes are gone.
  - `a3-fox-backlit.png` (and `-close`): the fox three-quarter with a 10° sun behind it.
  - `valley3b-fur-animals.png`: deer, fox (two) and duck up close in the valley at noon.
  - `after3b-drawings.png` (drawing | face | three-quarter | side) and `after3b-drawing-<n>-face/34/side.png`: the four
    test drawings through the designer once more, with coats.
  - `fur3b-walk-fox.gif` (close) and `fur3b-walk-deer.gif` (about 10 m): strand edges in motion.
  Checks at the checkpoint: 712 tests pass (1 skipped), `npx tsc --noEmit` clean, `npm run build` OK; River Bend
  15.1 ms median (15.0 before 3b); every body builds in under 3 s (frog 2.6 s).
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

Added by 3b's fur (Tasks 6–9):

12. **The groom rides three's tangent skinning** (`src/render/creature.ts` `lodGeometry`, *probed*: `skinsTangent()` in
    `src/render/probe.ts`): the hair direction and cavity (one vec4) are bound on the geometry as the attribute
    `tangent`, because r186's `skinning` Fn assigns the skinned tangent to `tangentLocal` when the geometry has one. The
    fur shader reads `tangentLocal` (posed) for the slide and the raw attribute (rest) for the lattice. If three stops
    skinning tangents, the fur keeps its rest direction on a bent body.
13. **`PhysicalLightingModel.direct` input shape for the fur** (`src/skin/fur-light.ts` `FurLightingModel`, *probed* like
    item 5's `CrownLightingModel`): reads `{ lightDirection, lightColor, reflectedLight }`; if the shape changes, fur
    falls back to three's plain lighting.
14. **`NodeMaterial.receivedShadowPositionNode`** (`src/skin/fur.ts`, *probed*): the fur looks its received shadows up
    about a fur length out along the normal, read by r186's `ShadowBaseNode.setupShadowPosition`. If three drops it, the
    body's own shadow edge puts out the backlit rim (nothing breaks).
15. **The fur shader uses 16 of WebGPU's 16 inter-stage variables** (not a three internal, a hard limit; no guard or
    probe): any new varying in `fur.ts` fails to compile. Free one first (Task 9 found `bpV = varying(r.bp)` duplicates
    the bodyPos varying). The skin shader uses 10.
16. **r186 TSL re-declares vertex values in the fragment once the fragment runs a `Fn`** (found in Task 8): `.toVar()`
    on a vertex-stage value, or a `select(...)` that reads one, made three emit the vertex var (and its attribute) in the
    fragment too, costing varyings. `fur.ts` uses plain expressions and `mix(...)` there on purpose; keep it that way
    while the shader is at the varying limit.
17. **Alpha to coverage is off on the fur shells** (`fur.ts`, `m.alphaToCoverage = false`; a plain `alphaTest` 0.5):
    with it on (r186, Chrome on D3D12 here) every partly covered pixel came out darker, towards neutral grey, instead of
    a mix of strand and background: dark outlines round strands close up and a salt-and-pepper coat at a few metres.
    Root cause not found in three or Dawn. The renderer stays `alpha: false` (with A2C the page showed through the
    canvas); `renderer.ts`'s comment still names A2C as the reason. Retry A2C on a three upgrade.
18. **`hashCPU` copies three's TSL `hash`** (`src/skin/coat.ts`, no probe): the CPU twin of r186's PCG `hash` (from
    three's `Hash.js`) that the feather tests use. If three changes its hash, the tests still pass but check a feather
    lattice the GPU no longer draws (the picture is still fine: the GPU uses three's own).

## Lifeform Polish 3a: what the owner checked, and known issues

- **The sheets** (`.shots/compare-faces.png`, `compare-34.png`, `compare-sides.png`: each row is before | after; rows
  deer, rabbit, fox, wolf, duck, hawk, trout, frog, then the test bodies quadruped, snake, hexapod, blob, biped, bird;
  `valley-animals.png`: deer, fox and duck up close in the valley at noon; the four drawings' `after-drawing-<n>-face/34/side`).
  The owner OKed them on 2026-10-10 and 3a was merged.
- **Fur looks spiky at close range** (face portraits): unchanged by 3a, it is the fur shells; fixed by 3b's fur
  rework (`compare3b-fur-face.png`).
- **LOD0 is capped at 1.3× the old triangle count** (the frog was 1.5×; the cap also trims the hawk −16 %, bird −9 %,
  duck −3 %). Eyelids are hidden at LOD2, so a distant sleeping animal shows open eyes (barely visible at that range).
- **Build times are 5–15× the old builder** (0.25–2.5 s per body, the frog 2.5 s of a 3 s limit). The body cache and
  worker pool hide it after the first build; a new drawing waits about that long once.
- **Hawk:** folded wings stick out behind it on its upright perch (the rig folds wings to a fixed near-level
  direction), and it flies nose-up 30–40° (the rig never levels a flier). Both are motion (3b). Its hook tip is a thin,
  cell-limited cone; the beak region's border on the face is ragged with fur off.
- **Mouths:** the open mouth's cheeks are a stretched dark membrane (fine to the 0.3 rad the jaw is clamped to, long
  triangles beyond 0.4); the lip band is too narrow at LOD1/2 and on the trout; a small dark tick behind the duck's bill.
- **Upright heads** (the biped and `upright` test bodies) get a level face frame: the mouth runs across the face below
  the eyes. Its painted lip line is wide (reads as a cartoon smile). A head sunk deep in a fat torso with low eyes gets
  no mouth at all (by design: no mouth beats a wrong one).
- **Wolf:** the skull to muzzle profile is still a smooth wedge with little stop.
- **The four test drawings** went through the designer once at the end (Sonnet, 3 look-again passes each, 16 calls,
  no errors): Puffle (fluffball), Zigzag Crowner (six-legged lizard), Puffback Zigzag (snake with wing puffs), Dotty
  Longneck (turtle). The designer filled the new hints itself (muscle, feet, nose, brow, an inner-ear colour for the
  fluffball). Sheet: `.shots/after-drawings.png` (drawing | face | three-quarter | side). The `-face` shot frames the
  head bone, so for a creature whose head is most of its body (Puffle) it is far too close.

## Lifeform Polish 3b fur: known issues

From the build ledger's look notes and the checkpoint's shots and measurements. None is a blocker in the builder's view;
the owner decides on the sheets.

- **Fur costs about 2.2–2.6 ms per animal close up** (16 shells on High; a fox a third of the screen wide, or a lying
  deer, at noon, render only). River Bend has no animal near enough to draw fur, so its number (15.1 ms) says nothing
  about fur. Several furry animals close to the camera at once on the TV could add up; the lever is
  `QUALITY.high.furShells` 16 → 12 in `src/render/quality.ts` (about 0.5 ms back per close animal).
- **Strand edges are a hard cut** (alpha to coverage off: r186 item 17). In the walk clips the coat barely changes frame
  to frame beyond the motion itself (mean change on the torso 1.5 grey levels with fur against 1.3 without for the
  close fox, 0.7 against 0.4 for the deer at ~10 m); no crawl was visible at 1:1. Worth a look live on the TV.
- **Backlit rim is subtle.** With a 10° sun straight behind the fox the camera side stays nearly as bright as when
  front-lit (torso about 15 % darker), so the warm rim on the outline is faint; at the lab's 44° sun it is hard to see.
- **Strands cut at region midlines** (elbows, macro range only); **upright tufts on the quadruped test body's ear rim**
  (read like lynx tufts); **stacked shell slices** show on long coats at 1:1 macro (inherent to shells).
- **Duck flank a little busy** (the scalloped feather rows read slightly knitted at three-quarter range); feather
  regions' marks can be painted over by the per-pixel feather pattern.
- **Rabbit flank** shows soft darker blotches at side range (the clump pattern or the cavity).
- **The deer** reads as smooth hide at every range: right for `sleek`, but flat next to the other coats.
- **The wolf reads pale grey** with the strand lighting: its recipe colour (#6e685e) under this light; b3 looked darker
  mostly because of the old alpha-to-coverage greying.
- **The lab draws 24 shells, the valley 16**, so lab portraits are a little denser than in the valley.
- **Console:** three's "Return statement used in an inline Fn()" warning (from `fur.ts`'s expression-bodied `Fn`s);
  harmless.
- **Designer run (2026-10-14, Sonnet, 16 calls, all 200, about 3.5 min):** the coats came out right with no prompt
  change: Puffle Bun (fluffball) body fur `soft`; Crownbug (six-legged lizard) none; Puffback Wiggler (snake) its
  orange and pink puffs fur `soft`; Dotty Longneck (turtle) none. The snake's three blue dots don't show on its puffs,
  and bright fur colours read paler than the drawing (the skin under them does too: lighting, not fur).

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
- Upright heads: the lip line is wide; sunk upright heads get no mouth (a wider fallback could use the clearance height).
- Geometry is built per animal per LOD (`lodGeometry`): caching it per species would save 1–4 ms per spawn and GPU memory.
- `bodyKey` (persisted in the body cache) is three 32-bit FNV hashes: a stronger hash would be safer long term.
- The edge-length regulariser (REG 1e-3) raises coarse-LOD error (< 1‰); zero-area input faces are never removed (none
  on real bodies); rejected edges are retried only when an endpoint changes.
- `splitNonManifold` is silent on an unresolved crowded edge (never seen); trout normals disagree at 29–31 vertices
  (< 0.05 %); the raw-size cap estimate cannot see thin webs; the "two cells" Detail comment is stale.
- Tests: the trout is not in the real-body sampler test; `toFixed(4)` comparisons; the evaluation-count margin is thin
  (1.82M of 2M).

**Anatomy** (`src/builder/anatomy`)
- The coarse SDF's "never overstates" comment over-claims for blended bodies (1.14 against 1.25 slack); `skeleton.min/max`
  cover bones only (~1 cm short).
- The belly-tuck gate ignores the blend k and leg radius (heuristic); the 0.75-cell clamp on r0 never binds.
- Three-region junction triangles are approximate in the material; the rabbit's ear root gets 0.25 at 1–2 vertices.
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

## 3b fur backlog

From the build ledger's deferred minors for Tasks 6–9 (`progress.md`). None blocks the merge.

**Fur shader** (`src/skin/fur.ts`, `src/render/creature.ts`, `src/render/renderer.ts`)
- `createCreatureObject` has six positional optionals (the lab passes `undefined, undefined, 24`): an options object.
- The `furCoat` layout (`EYE_BASE`, `PER_REGION`) is named inline; `MAX_EYES` is 4 (more eyes just get the coat).
- Clumped strand segments can be clipped by their cell (only the own and next cell are searched; untested beyond that).
- Mixed feather/fur coats rasterise and discard the feather regions on every shell above the first, and pull the fur
  at their border low.
- `bpV = varying(r.bp)` duplicates the bodyPos varying: reading `r.bp` directly frees one of the 16 inter-stage slots.
- The expression-bodied `Fn` at `fur.ts` ~320 (`() => c.assign(...)`) prints three's "Return statement used in an
  inline Fn()" warning: give it braces.
- Marks can be painted over by the per-pixel feather pattern (the mix order at `fur.ts` ~317–321).
- Noisy `as unknown as` casts (`material.ts` ~98–106, `fur.ts` ~317); the `renderer.ts` comment on `alpha: false` still
  names alpha-to-coverage fur, which is now off.

**Strand lighting** (`src/skin/fur-light.ts`, `src/skin/material.ts`)
- `SHADOW_LIFT`'s comment says "a fur length out from the body", but the lift is the length × (1 + t); the
  `receivedShadowPositionNode` probe checks only that the property exists, and `fur.test` only that the node is set.
- `isRelief`'s `reduce` has no initial value; its covering-index mapping and the per-mesh `underfur` flag reaching the
  colour are untested.

**Feathers** (`src/skin/coat.ts`)
- `featherAt` returns an unused `w`; rare holes (0.006 %) sit just off the test's plane offset; the "is deterministic"
  test asserts little; `hashCPU` copies three's hash (r186 item 18): owning the PCG would end that reliance.
- No unit coverage for `across`, `whole` or the per-pixel feather pattern (Task 9's additions to `regionNodes`).

## Roadmap

1. Creature Lab: built
2. The Valley: built and merged
3. **Lifeform Polish:** 3a (shapes and faces) built and merged (2026-10-10);
   **3b (fur, motion, post-processing): in progress** on `feat/lifeform-polish-3b`. Tasks 1–6 of 20 are merged to
   `main` (the owner's OK, 2026-10-12, fast-forward to `fcfd649`); Part 1 (the fur: Tasks 7–9 and the fur checkpoint)
   is built on the branch and waits on the owner's OK. Part 2 (Tasks 10–20: motion, post-processing, the remaining
   sheets) resumes after sub-project 4.
4. The Living Ecosystem
5. Views and Eyes
6. Bring It to Life (phone)
7. Weather and Events
8. The Director

**Build order (agreed with the owner 2026-10-13; also in the vision doc's roadmap):**

1. **Finish 3b's fur**: plan Tasks 7–9 and the fur checkpoint are built (2026-10-14); merge on the owner's OK.
2. **6 Bring It to Life.** Released creatures go through one small, saved creature list that 4 will extend, not
   replace. Phone mic and live camera need HTTPS on the home network (decide how in its brainstorm).
3. **4 The Living Ecosystem.** The simulation reports "moments" as they happen from day one, for the Director.
4. 3b's remaining motion and post-processing (plan Tasks 10–20, same branch or a fresh one from `main`).
5. **5 Views and Eyes** (at least follow and lock-on).
6. **8 The Director.**
7. **7 Weather and Events.**

The owner is most excited about 6 and 8, and wants every skipped part built afterwards. Follow the usual flow:
brainstorm → spec → plan → build autonomously on a feature branch → screenshots → merge only on the owner's OK. In the
3b brainstorm the owner said to go with the recommendations without more questions and expects high quality.

**Next: the owner reviews the fur sheets; merge on OK; then the sub-project 6 (Bring It to Life) brainstorm. 3b Part 2
(Tasks 10–20) resumes after sub-project 4.**

- What to look at: "Where things are" above (the `compare3b-fur-*` sheets, the backlit fox, the valley animals, the
  drawings, the walk GIFs); what is known to be off: "Lifeform Polish 3b fur: known issues".
- Build ledger, briefs, reports and rulings (gitignored, local only):
  `.superpowers/sdd/2026-10-10-lifeform-polish-fur-motion-post/progress.md`. It lists every task with commits, the
  controller's rulings (R1–R12) and the deferred minors; `checkpoint-report.md` there has the checkpoint's measurements
  in full. Key rulings for later work: R6 (the groom bound as `tangent`), R10 (alpha to coverage off on the fur), R11
  (the backlit rim weighted by shell height), R12 (River Bend does not measure fur; measure with an animal close up).
- Fur frame cost decision: `QUALITY.high.furShells` stays 16. If the TV drops frames with animals close, set it to 12
  (`src/render/quality.ts`; about 0.5 ms back per close animal).
- When Part 2 resumes: Task 10 is next (body mechanics; brief to extract from the plan). Rulings R2 (the settle spring
  lives on `rig.mech`) and R4 (the take-off clip) already apply to it. Its sheets, valley tour, README "motion and the
  picture" and the full 3b handoff are Task 20's remaining steps.

## Dev tips that save time

- The preview tool reads `.claude/launch.json` from the session's original folder. Start the session in `CreatureEcosystem2` (the `valley` or `lab` configuration, port 5180), or run `npm run dev` yourself.
- The app window is often hidden, which freezes animation frames, CSS transitions and the screenshot tool. Use the dev hooks instead: in the valley `__valley.step(frames)`, `__valley.shot(name)`, `__valley.screen(name)`, `__valley.tour(prefix)`, `__valley.perf()`, `__valley.timings`; in the lab `__lab.step`, `__lab.shot`, `__lab.screen`, `__lab.portrait(recipe, prefix)` (the standard `-face`, `-34` and `-side` shots used for the 3a sheets; recipes in `__lab.CAST` and `__lab.fixtures`) and `__lab.face(cmd)` (blink, yawn, chew, alert, back). The drawing test set exposes `__drawings.rows` and `runOne(row)`; its recipes are not exposed, so 3a and 3b captured them by intercepting the gallery save of each row's "Open in lab" (patch `IDBObjectStore.prototype.put` to keep `value.recipe` and throw, then call each row's `open.onclick()`). `__lab.clip(recipe, name, prefix, frames, every, warm)` records a motion clip as numbered shots; `python tools/gif.py OUT.gif IN... --fps N --width W` makes a GIF.
- Live frame times (stalls, hitches): `__valley.frames.start()`, then play, then `__valley.frames.stop()` gives the real
  frames' intervals and working ms and lists the slow ones with the valley hour. In a hidden window call
  `__valley.frames.pump()` first: the live loop then runs from a timer that waits for the GPU after each frame (so GPU
  stalls still lengthen the interval); `pump(false)` puts the animation frames back. Shots land in `.shots/`. `resize_window` to 1920×1080 gives a real layout. `python tools/tile.py OUT IN... --cols N` makes contact sheets.
- To time a first visit, delete the IndexedDB database `creature-valley` and reload.
- WebGPU limits: at most 8 vertex buffers and 12 uniform buffers per shader stage. Pack attributes and uniforms accordingly.
- `npx tsx tools/valley-perf.ts 2049` gives valley generation times; `npx tsx tools/perf.ts` gives body build times; `npx tsx tools/make-test-drawings.ts` regenerates the synthetic test drawings.
