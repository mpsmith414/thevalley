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
- Where things stand: [docs/superpowers/HANDOFF.md](docs/superpowers/HANDOFF.md)

## Run it

```bash
npm install
npm run dev
```

- The valley: http://localhost:5180/
- The lab: http://localhost:5180/lab.html
- The drawing test set: http://localhost:5180/drawings.html

It needs a browser with WebGPU (Chrome or Edge); WebGL 2 is the fallback. `npm test` runs the tests and
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
- `src/builder`: recipe → skeleton → smooth "clay" distance field → surface-nets mesh (3 levels of detail) → skin
  weights. It runs in a Web Worker and is deterministic.
- `src/skin`: one shared TSL material (patterns, belly colour, coverings), fur shells and eyes.
- `src/motion`: limbs and gaits, FABRIK IK with planted feet, the rig (walk, fly, swim, lie down), secondary motion
  (head, tail, ears, wings, fins, breathing, blinking) and actions.
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
| 1 Lake Shore | 13.2 | 14.2 | 140 | 5.0 M |
| 2 Meadow | 10.0 | 10.9 | 86 | 1.7 M |
| 3 Ridge Top | 13.0 | 14.0 | 96 | 4.3 M |
| 4 River Bend | 16.1 | 17.0 | 136 | 8.9 M |
| 5 Forest Floor | 13.9 | 14.3 | 97 | 7.8 M |
| 6 Beach | 11.9 | 12.9 | 132 | 5.8 M |
| 7 Rocky Knoll | 9.9 | 10.4 | 77 | 2.4 M |
| 8 Valley Overview | 7.0 | 7.7 | 40 | 1.7 M |

Draw calls and triangles include the shadow cascades and the lake's mirror. At River Bend the CPU part is 3.4 ms, so
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
look-again passes (default 3; each pass is one more Claude call).

### Status

Built and checked on the owner's PC (RTX 3060 Ti, WebGPU):

- Body builds (full detail, main thread, `npx tsx tools/perf.ts`): 50–450 ms per native animal. The frog is slowest at 0.45 s; the target is under 3 s.
- Planted feet slide 0 cm while walking, trotting, galloping, changing speed and circling.
- Frame cost at 1920×1080 on the high tier (one walking animal, stage, fur, shadows; simulation + render + GPU finish): wolf 7.3 ms, fox 10.5 ms, rabbit 11 ms, deer 10.3 ms, frog 6.1 ms. 60 fps needs under 16.7 ms.
- The owner has run the designer live with their own key.
