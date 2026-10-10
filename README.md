# Creature Ecosystem

A living 3D valley you watch like a nature documentary, where a child's drawing becomes a real
creature. Two parts are built so far:

- **The Valley** (`/`, sub-project 2): a northern valley about 1.6 km across, with a lake fed by a river, forest,
  meadows and rocky ridges, a 24-minute day and night, resident animals, wind and an ambient soundscape. You fly
  through it with a controller (or keyboard and mouse), or glide between eight viewpoints.
- **The Creature Lab** (`/lab.html`, sub-project 1): any creature recipe (hand-written, or made by Claude from a
  drawing or words and checked with "look again" passes) becomes a 3D creature with fur, scales or feathers that
  walks, runs, grazes, drinks, sleeps, calls, flies or swims on a turntable stage.

Specs and plans:

- Vision and roadmap: [docs/superpowers/specs/2026-10-06-vision-and-roadmap.md](docs/superpowers/specs/2026-10-06-vision-and-roadmap.md)
- The Valley: [design](docs/superpowers/specs/2026-10-07-valley-design.md), [plan](docs/superpowers/plans/2026-10-07-valley.md)
- The Creature Lab: [design](docs/superpowers/specs/2026-10-06-creature-lab-design.md), [plan](docs/superpowers/plans/2026-10-06-creature-lab.md)
- Lifeform Polish 3a, shapes and faces: [design](docs/superpowers/specs/2026-10-09-lifeform-polish-shapes-faces-design.md), [plan](docs/superpowers/plans/2026-10-09-lifeform-polish-shapes-faces.md)
- Where things stand: [docs/superpowers/HANDOFF.md](docs/superpowers/HANDOFF.md)

## Run it

```bash
npm install
npm run dev
```

- The valley: http://localhost:5180/
- The lab: http://localhost:5180/lab.html
- The drawing test set: http://localhost:5180/drawings.html

The valley needs a browser with WebGPU (Chrome or Edge): it is built and checked on WebGPU only, and its WebGL 2 path
is untested. The lab also runs on WebGL 2 (three falls back by itself). `npm test` runs the tests and
`npm run build` makes the static site in `dist/`.

The creature designer (lab only) needs a Claude API key. Copy `.env.example` to `.env` and put your key in it:

```
ANTHROPIC_API_KEY=sk-ant-...
DESIGNER_MODEL=claude-sonnet-5-5
```

`.env` is ignored by git; the key only lives in the small local server, never in the web page.
The key is the long secret starting with `sk-ant-api` (not the `apikey_…` ID the Console lists). If your key
works across several workspaces, also set `ANTHROPIC_WORKSPACE_ID=wrkspc_…` (Console → Settings → Workspaces);
a key created for a single workspace doesn't need it.
Use `DESIGNER_MODEL=claude-opus-5-5` for the stronger (about twice the price) eye.
Without a key everything works except making new creatures (the designer says it is resting).

## The Valley

The first visit makes the valley (about 4 s of generation in a background worker) and keeps it in the browser
(IndexedDB, about 80 MB), so later visits skip that step. The loading screen shows the stages; then "Press any
button or click to start" wakes the sound.

### Controls

| | Controller | Keyboard and mouse |
|---|---|---|
| Move | Left stick | W A S D |
| Look | Right stick | Mouse (click the view first to capture it) |
| Up / down | RT / LT | E / Q |
| Fast | RB (hold) | Shift (hold) |
| Walk height on / off | Y | G |
| Previous / next viewpoint | D-pad left / right | Arrow left / right, or 1–8 |
| Menu (time of day, clock speed, quality, volume, Creature Lab, controls) | Start | Esc (or N) |
| In the menu: move, choose, back | D-pad, A, B | Arrow keys, Enter or Space, Backspace |
| Sound off / on | (menu) | M |

Moving the sticks or W A S D during a glide takes over from it. The viewpoints are Lake Shore, Meadow, Ridge Top,
River Bend, Forest Floor, Beach, Rocky Knoll and Valley Overview (where it opens).

### On the TV

The valley runs on the gaming PC and is streamed to the TV: [Sunshine](https://app.lizardbyte.dev/Sunshine/) on
the PC and Moonlight on the Fire TV Cube, with the controller connected to the Fire TV (Moonlight sends it to the PC).
Start `npm run dev` on the PC, then open the valley full screen. Browsers only play sound after a press, so the
valley opens with a start screen; to skip it (for a desktop shortcut you start from Moonlight), start Chrome with
autoplay allowed and in kiosk mode:

```
chrome.exe --autoplay-policy=no-user-gesture-required --kiosk http://localhost:5180/
```

Quality is **Auto** by default: the first visit starts on High, measures the frame rate for a few seconds once you
are in, and keeps its pick for next time (it says "Next time: Medium quality" if High was too much). Dynamic
resolution (down to 70 % on High) holds the frame rate in between. You can pick High, Medium or Low in the menu.

### How it works

- `src/valley`: the hand-written layout (ridges, lake, river, areas, viewpoints, animal homes) and the seeded generator
  (base shape, erosion, water carving, biomes, plant scatter) that runs in a worker and is cached in IndexedDB.
- `src/plants`: code-built trees, shrubs, ferns, rocks and logs at three levels of detail, painted leaf cards, the
  shared plant materials and wind, the far forest's baked impostors, and the GPU-placed grass, flowers, reeds and lilies.
- `src/world`: the terrain (clipmap levels with photo ground textures blended by biome), the backdrop mountains, the
  sky, sun, moon and stars, lighting and haze by the hour, cascaded shadows, the lake (planar mirror) and river, the
  64 m vegetation tiles, quality tiers and dynamic resolution.
- `src/camera`: the free-fly camera (stays out of the ground, water, trees and world edge; walk height) and the
  viewpoint glides.
- `src/residents`: the 18 resident animals (deer, rabbits, foxes, wolves, a hawk, ducks, trout and frogs, built from the
  lab's recipes) placed in their habitats, wandering with feet on the real ground, fish in the water and ducks on it,
  with update bands and levels of detail by distance.
- `src/audio`: the soundscape (CC0 recordings with synthesised fallbacks) mixed by place, hour and wind.
- `src/app`: the valley page: startup, loading and start screens, the live loop and pacing (Auto quality, dynamic
  resolution), the pause menu, and the dev hooks (`window.__valley`, dev server only).
- `src/render`: the WebGPU renderer, quality tiers, the creature renderer and stage, startup pipeline compiling and the
  skinning patch.
- `src/recipe`: the creature recipe (zod schema), normalising (clamps and repairs any input) and small edits.
- `src/builder`: recipe → skeleton (plus a jaw bone) → smooth "clay" distance field with an anatomy layer (muscles,
  joints, ribcage, feet, a sculpted face) → fine surface-nets mesh near the surface → importance-weighted simplification
  (3 levels of detail from one chain) → skin weights. It runs in a pool of up to 4 Web Workers and is deterministic, so
  built bodies are cached in IndexedDB (`creature-bodies`, the 32 most recently used) under the recipe's body key plus a
  hash of the builder's source (a changed builder never reads old bodies). See "Bodies and faces" under the lab.
- `src/skin`: one shared TSL material (patterns, belly colour, coverings, face colours: nose, inner ear, lips, mouth,
  hooves), fur shells, eyes and eyelids.
- `src/motion`: limbs and gaits, FABRIK IK with planted feet, the rig (walk, fly, swim, lie down), secondary motion
  (head, tail, ears, wings, fins, breathing, blinking, jaw and lids) and actions.
- `src/cast`: the native animals, hand-written recipes that set the quality bar.
- `src/designer` and `server/`: the Claude designer service (read, look-again, tweak), the browser loop and image
  preparation.
- `src/lab`, `src/drawingset`: the lab screen (controller-first UI, gallery in IndexedDB, workshop) and the drawing
  test set page.
- `src/shared`, `src/util`: input (gamepad, keys, mouse), settings, focus rings and element building; seeded random
  numbers, hashing and vectors.

### Performance

Measured on the owner's PC (RTX 3060 Ti, i7-9700F, Chrome's WebGPU on D3D12) at 1920×1080 on High, noon. Frame cost is
`__valley.perf()`: 180 frames per viewpoint, each timed from its start to the GPU finishing it, one at a time (so the
CPU's ~3.5 ms and the GPU never overlap, as they do in the live loop: a little pessimistic). 60 fps needs under 16.7 ms.

| Viewpoint | Median ms | 90th pct ms | Draw calls | Triangles |
|---|---:|---:|---:|---:|
| 1 Lake Shore | 12.5 | 13.9 | 152 | 5.0 M |
| 2 Meadow | 10.0 | 10.4 | 118 | 1.7 M |
| 3 Ridge Top | 12.0 | 12.8 | 96 | 4.3 M |
| 4 River Bend | 14.9 | 15.8 | 136 | 8.9 M |
| 5 Forest Floor | 12.9 | 13.5 | 105 | 7.8 M |
| 6 Beach | 10.9 | 11.8 | 140 | 5.8 M |
| 7 Rocky Knoll | 9.3 | 10.2 | 97 | 2.4 M |
| 8 Valley Overview | 6.3 | 7.2 | 40 | 1.7 M |

Measured 2026-10-10 with the Lifeform Polish 3a creatures (finer bodies, eyelids). The same run on the code just
before 3a gave River Bend 15.0 / 16.1 ms, so the new bodies cost nothing measurable there (the extra draw calls at
Meadow, Lake Shore and Rocky Knoll are most likely the eyelids, separate meshes, of the animals in view). An earlier run at the end of the Valley build
gave River Bend 16.1 ms: runs vary by about 1 ms. Draw calls and triangles include the shadow cascades and the lake's mirror. At River Bend the CPU part is 3.4 ms, so
the live loop's frame is about 13 ms. The live frame rate itself still wants checking on the TV (the measuring window
was hidden, which stops animation frames): open the menu after a first visit and see whether Quality → Auto kept High.

Startup, in seconds after the page opens (the Valley ready behind the start screen; then the remaining plant materials
and the animals compile in the background while the start screen is up):

| | Ready | Everything compiled |
|---|---:|---:|
| First visit, production build | 11.1 | 15.5 |
| Later visit, production build | 8.9 | 14.0 |
| First visit, dev server (before the Task 21 pass) | 13.6 (17.3) | 18.7 (24.7) |
| Later visit, dev server (before) | 9.1 (13.0) | 14.2 (20.6) |

Where a later visit's 9 s go: reading the valley from IndexedDB 0.5 s, decoding the ground photos 1.5 s, plant
textures, materials and tiles 0.7 s, the impostor bake 0.5 s, then compiling the GPU pipelines the opening view needs
and drawing its first frame, 5.5 s. Each pipeline takes 0.05 to 2.3 s to compile on D3D12 (the lake's is the slowest),
and the measuring browser kept no shader cache between visits; Chrome may keep one, which would make later visits
faster. The console prints `valley: ready … s` on every visit.

Valley generation at the default grid (`npx tsx tools/valley-perf.ts 2049`, Node on the same PC):

| Stage | ms |
|---|---:|
| Shape | 1,576 |
| Erode | 306 |
| Carve water | 351 |
| Biomes | 705 |
| Scatter plants | 433 |
| Build plant models | 322 |
| **Total** | **3,695** |

That is 237,045 plants (168,050 blueberry bushes, 33,209 pines, 9,980 boulders, 9,119 spruces, 7,331 ferns, 5,945
birches and fewer alders, willows, junipers, logs and stumps) and 79.2 MiB of data.

### Dev hooks

On the dev server, `window.__valley` drives the valley from the console (it works while the window is hidden):
`view(n)`, `time(h)`, `step(frames)`, `shot(name)` and `screen(name)` (saved to `.shots/`), `tour(prefix)` (every
viewpoint at dawn, noon, golden hour and night: 32 shots), `perf()`, `timings`, `resolution` (scale and fps),
`fps()`, `residents`, `lookAt(i)` and `audio()`. `python tools/tile.py OUT IN... --cols 4` makes a contact sheet.

## The Creature Lab

### Controls

| | Controller | Keyboard and mouse |
|---|---|---|
| Look around | Left stick | Drag, or W A S D |
| Zoom | Right stick | Mouse wheel, or Q / E |
| Move between buttons | D-pad | Arrow keys |
| Press a button | A | Enter or Space |
| Close a panel | B | Esc |
| Walk / Run | X / Y | X / Y |
| Previous / next creature | LB / RB | [ / ] (or 1–8 for the native animals) |
| New creature | Start | N |
| Workshop (grown-up drawer) | Select / Back | ` (backtick) |

### Making a creature

Press **New creature**, drop in (or paste, or pick) a photo of a drawing and/or type a few words,
then **Bring it to life!** You'll see the drawing beside each build as the designer looks again and
fixes things. **Change it** takes words like "make it bigger" or "give it wings". Everything made is
kept in the **Gallery** in this browser, with **Save a backup** / **Load a backup**.

Settings in the Workshop: detail level, fur, skeleton view, quality tier, and the number of
look-again passes (default 3; each pass is one more Claude call). Its **Face** row plays the face on the turntable:
Blink, Yawn, Chew, Alert (ears pricked forward) and Ears back; the actions (call, eat, drink, sleep) move the jaw, lids
and ears too.

### Bodies and faces

Every creature (native or drawn) gets the same automatic anatomy from its part roles, tuned by a few recipe hints
(schema v2: `build.muscle` 0–1 and `build.feet`; `face.nose`, `face.noseColor`, `face.lids`, `face.earInner`,
`face.brow`). The designer fills them in; anything missing is inferred from the covering, gait and habitat, and v1
recipes upgrade on load.

- **Body** (`src/builder/anatomy`): muscle bellies on the upper legs (haunches and shoulders), knobs at the knees,
  hocks and wrists with slimmer tendons below, a ribcage swell and belly tuck, shoulder blades and a spine line on
  four-legged animals, a throat line and crest on the neck. Feet by `build.feet`: paws (four toe pads), hooves (a split
  tip, coloured as hoof), talons (three forward, one back) or webbed (three toes and a web).
- **Face:** a cranium swell, brow ridges, eye sockets, cheeks, a muzzle that narrows to its tip, and a nose by
  `face.nose`: a pad with nostrils and a groove, a hooked beak, a flat bill, or two slits. A mouth slit runs from the
  tip to a corner (far back for meat-eaters, short for plant-eaters), closed at rest by a jaw bone that opens up to
  0.3 rad, with a dark mouth inside. Ears are cupped, with a lighter inner ear. Eyes sit in their sockets under upper
  and lower lids that blink, half-close and shut in sleep.
- **Meshing:** a coarse pass finds the surface; only the blocks it crosses are sampled finely (330 cells along the
  longest side, coarser for bulky bodies so the raw mesh stays under ~110,000 vertices). The fine mesh is simplified
  by quadric edge collapse, weighted so the face, feet and joints keep their detail and the flanks give it up. LOD0,
  LOD1 and LOD2 are snapshots of that one chain: LOD0 about 1.2× the triangles the old 110-cell grid gave, LOD1 a
  quarter of LOD0, LOD2 a sixteenth.
- **Cache:** a body is built once per browser (a few workers in parallel) and read back from IndexedDB after that.
  The valley's animals are ready about 3.5 s after the page opens on a later visit (bodies read in under 1 s); the
  first visit builds them in about 9 s behind the loading screen.

Body builds, all three levels of detail, main thread (`npx tsx tools/perf.ts`, Node on the owner's PC; the target is
under 3 s each). "Before" is the old uniform-grid builder.

| Body | Build (ms) | Before (ms) | LOD0 / LOD1 / LOD2 triangles | Before LOD0 |
|---|---:|---:|---|---:|
| Deer | 1,651 | 248 | 36,726 / 9,182 / 2,294 | 29,568 |
| Rabbit | 1,886 | 440 | 63,702 / 15,926 / 3,980 | 51,688 |
| Red Fox | 1,185 | 137 | 23,788 / 5,946 / 1,486 | 19,124 |
| Wolf | 1,466 | 157 | 32,770 / 8,192 / 2,048 | 26,000 |
| Duck | 1,452 | 190 | 28,214 / 7,054 / 1,762 | 22,368 |
| Hawk | 690 | 80 | 12,286 / 3,072 / 768 | 9,840 |
| Trout | 702 | 66 | 13,540 / 3,384 / 846 | 10,588 |
| Frog | 2,524 | 583 | 100,238 / 25,060 / 6,264 | 65,788 |
| quadruped (test) | 1,337 | 118 | 31,274 / 7,818 / 1,954 | 23,992 |
| snake (test) | 248 | 15 | 7,606 / 1,902 / 474 | 6,284 |
| hexapod (test) | 1,395 | 205 | 52,922 / 13,230 / 3,308 | 43,036 |
| blob (test) | 986 | 163 | 119,490 / 29,872 / 7,468 | 99,404 |
| biped (test) | 946 | 46 | 23,270 / 5,818 / 1,454 | 18,248 |
| bird (test) | 1,009 | 126 | 18,800 / 4,700 / 1,174 | 14,704 |

The tool also prints where each build's time goes (sampling, meshing, weighting, simplifying, normals, skinning).

### Status

Built and checked on the owner's PC (RTX 3060 Ti, WebGPU):

- Body builds (all three levels of detail, main thread, `npx tsx tools/perf.ts`): 0.25–2.5 s per body since Lifeform
  Polish 3a (table above). The frog is slowest at 2.5 s; the target is under 3 s. Built bodies are cached, so a body
  is built once per browser.
- Planted feet slide 0 cm while walking, trotting, galloping, changing speed and circling.
- Frame cost at 1920×1080 on the high tier (one walking animal, stage, fur, shadows; simulation + render + GPU finish): wolf 7.3 ms, fox 10.5 ms, rabbit 11 ms, deer 10.3 ms, frog 6.1 ms. 60 fps needs under 16.7 ms.
- The owner has run the designer live with their own key.
