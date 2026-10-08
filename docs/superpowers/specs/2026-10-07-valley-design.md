# Sub-project 2: The Valley — Design

Date: 2026-10-07 · Status: approved in brainstorming · Parent: `2026-10-06-vision-and-roadmap.md`

## Goal

Build the place the creatures will live: one northern temperate valley (pine and birch, a
wildflower meadow, a clear lake fed by a river, mossy granite hills, a small beach) that you can
fly around on the TV with a controller, through a full day and night, with an ambient soundscape
and a small cast of resident animals wandering in it. It must look like a "living diorama", run at
1080p and 60 fps on the RTX 3060 Ti, and be built so the Ecosystem, Weather and Views sub-projects
can grow out of it.

## Decisions from brainstorming

| Question | Decision |
|---|---|
| Kind of place | A northern temperate valley. All eight native animals fit. |
| Vegetation | Trees and plants built in code from seeded plant recipes, with CC0 photo textures (bark, needles, leaves). |
| Terrain | A hand-written layout file for the big features; seeded noise and erosion for the detail. |
| Time | A running day and night now (24 real minutes per day by default). High summer only; seasons come later. |
| Animals | About 16 resident natives wander in home ranges, as placeholders until the Ecosystem. |
| Cameras | Free-fly plus 6–8 scenic viewpoints. The map, follow and lock-on stay in Views and Eyes. |
| Lab | The valley becomes the front door (`index.html`); the lab moves to `lab.html`. |
| Performance | 1080p at a steady 60 fps on High, with dynamic resolution. |
| Sound | A simple ambient soundscape mixed by camera position and time of day. |
| Approach | The world is generated in a worker at startup, cached in the browser, and drawn in tiles. |

## 1. Land and water

**Size.** The walkable valley is about **1.6 km square**. Beyond it, a ring of distant mountains is
drawn as a low-detail backdrop that fades into haze, so the world never ends at a wall. The camera
cannot leave the valley.

**The layout file** (`src/valley/layout.ts`) is plain, hand-written data:

- ridge lines with heights, and the shape of the valley floor;
- the lake's outline and depth;
- the river's course, as a curve from a spring in the hills down to the lake, with a width that grows along it;
- soft-edged areas for meadow, forest, rock and beach;
- the scenic viewpoints (position, look target, name);
- the resident animals' home ranges (section 4);
- the world seed.

**Generation** runs in a worker and is fully deterministic for a given layout and seed:

1. Base shape from the ridges and the valley bowl.
2. Seeded noise on top: smooth fractal noise for the rolling hills, ridged noise for the granite.
3. Droplet erosion (a fixed number of seeded droplets), giving gullies and scree fans.
4. The river channel and the lake basin are carved **after** erosion, so the river always runs downhill into the lake.
5. Derived maps: slope, moisture (distance to water), and **biome weights** (forest, meadow, rock, shore, beach).

The result is a **2048 × 2048** height grid (about 0.8 m per sample), plus the derived maps at the
same or half resolution. A detail-noise term in the shader adds fine relief close to the camera.

**Ground look.** CC0 textures for meadow grass, forest floor (needles and moss), granite, sand and
mud, blended by biome weight. Steep slopes are projected from the side (triplanar) so rock never
stretches. A large-scale colour variation texture hides tiling. The terrain is a single heightfield
mesh with distance-based level of detail (finer near the camera).

**The lake.** Clear and shallow near the shore (pebbles visible), darker with depth, gentle wave
normals, sky and shore reflections (real reflections on High, sky-only reflections lower down),
and a soft line where water meets land.

**The river.** A mesh that follows the course curve. Its ripple normals flow downstream, and it
turns white and rough where the course is steep.

**The `Valley` query object.** One interface answers questions about the world for every other
system (the renderer, animals' feet, actions, the camera and the tests):

- `heightAt(x, z)`, `normalAt(x, z)`
- `isWater(x, z)`, `waterLevelAt(x, z)`, `waterDepthAt(x, z)`
- `biomeAt(x, z)` (the biome weights)
- `flowAt(x, z)` (river flow direction and speed; zero elsewhere)

The lab's `Ground` type (`src/motion/rig.ts`) becomes a subset of this. The lab stage keeps
working by answering the same questions about itself.

## 2. Vegetation

**The plant cast.**

- **Trees:** Scots pine, Norway spruce and silver birch, plus alder and willow along the water.
- **Understory:** juniper, blueberry bushes and ferns.
- **Ground cover:** meadow grass, wildflowers (lupine, ox-eye daisy, fireweed, harebell), moss patches, reeds and cattails in the shallows, lily pads on the lake.
- **Props, made the same way:** mossy granite boulders, fallen logs and stumps.

**Plant recipes.** Each species is a small data recipe (`src/plants/species.ts`): trunk height and
taper, branching rule, branch angles, how strongly branches curve up or droop, needle or leaf type,
leaf-card size and density, and bark texture. Each plant placed in the world has its species plus a
**seed, an age (0–1) and a health value (0–1)**. Age and health are unused by behaviour now, but are
in the format so growth, grazing and burning can be added later.

A generator turns a recipe and seed into geometry. For speed, the valley builds a handful of
variants per species and age band (about 6 per band), then draws thousands of instances of them
with a random turn, lean, scale and tint.

**Three levels of detail per plant**, all made from the same generated model:

- **Near:** full branches with photo-textured leaf and needle cards (alpha-tested).
- **Mid:** fewer branches, with leaves merged into clumps.
- **Far:** impostors (pictures of the tree from many angles in one texture atlas), rendered by the app at startup from the near model, so they always match.

**Grass** is drawn as dense, GPU-instanced blades near the camera (about 60 m on High, less on lower
tiers), fading into the ground texture beyond.

**Wind.** One shared wind field (a direction, a base strength and travelling gusts) drives every
plant in the vertex shader. Gusts visibly roll across the meadow, birches flutter more than pines,
and reeds bend.

**Scattering** is seeded per tile (64 m tiles) and follows rules:

- each species has a minimum spacing (Poisson-disk placement);
- each species has biome, slope and moisture preferences;
- birches gather at forest edges;
- alders and willows line the river and lake;
- reeds and cattails grow only in shallow water, lily pads only on calm lake water;
- wildflowers grow in drifts;
- nothing grows in deep water or on bare rock faces.

Each tile also stores its **trunk list** (position and radius) for the camera and the animals.

**Rough counts on High:** about 60,000 trees and 200,000 shrubs, rocks and logs, plus grass within
range. Medium and Low thin these out.

**Textures** come from CC0 sources (Poly Haven, ambientCG). Every asset's source and licence is
listed in `public/assets/CREDITS.md`. If no suitable CC0 leaf texture exists for a species, one is
painted in code instead.

## 3. Sky, light, time and sound

**Sky.**

- A physically based atmospheric sky: blue at noon, orange and pink at dawn and dusk.
- The sun follows a mid-latitude midsummer path: long golden hours and a short but real night.
- At night: a moon with phases, stars and a faint Milky Way.
- A slow, drifting cloud layer. Real weather belongs to sub-project 7.

**Light.**

- The sun (or the moon at night) is the one shadow-casting light, using cascaded shadow maps: sharp near the camera, coarse far away.
- Ambient light follows the sky's colour.
- Distance haze (aerial perspective), warmer towards the sun.
- A low mist over the lake and river around dawn.
- Nights are dark and blue but always readable on a TV, never pitch black.
- One tone-mapping and exposure setup covers day and night.
- Heavy post-processing (ambient occlusion, light shafts, colour grading) stays in Lifeform Polish.

**The clock** (`ValleyClock`) holds the time of day:

- default speed 24 real minutes per valley day (one valley hour per real minute), adjustable;
- pause;
- jump to dawn, noon, golden hour or night;
- a new valley starts in early morning.

It runs on the main thread for now. The Ecosystem moves it into the simulation worker.

**Settings** (quality tier, volume, clock speed) are remembered in `localStorage`. No world state is
saved in this sub-project.

**Sound** uses the Web Audio API and five looping CC0 recordings, mixed by camera position and time
of day:

- **Wind:** louder with height and with the wind field's gusts.
- **Day and night:** birdsong by day crossfades to crickets and an occasional owl at night, following the sun's height.
- **Lake:** lapping water, by distance to the shore.
- **River:** by distance to the course curve, louder at the steep stretches.
- **Forest:** rustling, by the forest biome weight around the camera.

There's one volume slider and a mute. The mix itself is a pure function of camera position, time of
day and wind, so it can be tested. Browsers block audio until a user gesture, and a controller
press may not count as one. So the README gets a Chrome launch shortcut for the TV setup that allows
autoplay, and the valley shows a "press any button" start screen as a backup.

## 4. Animals, camera, controls and pages

**Resident animals.** About 16 natives, each with a home range (centre, radius, preferred biome) in
the layout file:

- 3 deer at the meadow and forest edge
- 3 rabbits in the meadow
- 2 foxes and 2 wolves in the forest
- 1 hawk circling over the meadow
- 2 ducks on the lake
- 3 trout in the lake and river
- 2 frogs at the shore

Their bodies come from the existing builder worker. The lab's `Place` type
(`src/motion/actions.ts`) becomes a **`Habitat`** interface: the ground queries, plus
"a random spot in my home range that suits me", "a random spot in the water" and "the nearest bank"
(for drinking). The lab stage implements `Habitat` too, so `ActionController` works in both places.

- Animals choose open spots and steer around nearby trunks, using the tiles' trunk lists.
- Animals near the camera update every frame. Farther ones update at a lower rate. Ones out of view are paused and hidden.
- They have no needs and nothing is saved. They are placeholders; the Ecosystem replaces them.

**Free-fly camera.**

- **Controller:** left stick moves, right stick looks, triggers go down and up, a bumper toggles fast mode.
- **Keyboard and mouse:** WASD, mouse look (pointer lock), Q and E for down and up, Shift for fast.
- Movement eases in and out.
- The camera stays above the ground and the water surface and slides around tree trunks.
- **Walk height:** Y (controller) or G (keyboard) toggles a mode that hugs the ground at about eye level.
- **Viewpoints:** the D-pad or keys 1–8 glide the camera along a smooth arc (about 3 s) to one of 6–8 scenic spots from the layout file (lake shore, meadow, ridge top, river bend, forest floor, beach and so on).

**On screen.** Normally nothing: just the valley. Start or Esc opens a large, controller-navigable
pause menu:

- Resume
- Time of day (jump)
- Clock speed
- Quality: Auto, High, Medium, Low
- Volume
- Creature Lab
- Controls

A small label shows briefly when the time jumps or the camera reaches a viewpoint (the time of day,
or the place name).

**Loading.** The first visit shows a progress screen while the valley is generated ("shaping the
hills… growing the forest…"). The target is under 15 s on the owner's PC. Results are cached in
IndexedDB, keyed by a hash of the layout, the seed and a generator version number, so later visits
open in a couple of seconds. Changing the generator version invalidates the cache.

**Pages.**

- `index.html` becomes the valley; the lab moves to `lab.html`; `drawings.html` stays.
- The pause menu's "Creature Lab" opens the lab, and the lab gets a "Back to the valley" button.
- The renderer setup, quality tiers and controller input move from `src/lab/` and `src/render/` into shared modules used by both pages.

**Quality tiers.** `QualitySettings` (`src/render/quality.ts`) gains: view distance, tree and shrub
density, grass radius and density, shadow cascade count and size, water reflection mode, and
impostor resolution. Auto mode picks a tier from measured frame rate (the existing `autoQuality`),
and a dynamic resolution scaler then lowers the render resolution briefly in heavy views to hold
60 fps.

| Tier | Target | Notes |
|---|---|---|
| High | 1080p, 60 fps | Full densities, real lake reflections, 4 shadow cascades |
| Medium | 1080p, 60 fps | Thinner forest and grass, sky-only reflections, 3 cascades |
| Low | 720p, 30 fps | Sparse grass, shorter view distance, 2 cascades, smaller textures |

## 5. Code layout

New modules, each small and with one job:

- `src/valley/`: `layout.ts` (data); `generate/` (noise, base shape, erosion, carving, biomes); `valley.ts` (the `Valley` query object); `worker.ts` and `client.ts`; `cache.ts` (IndexedDB).
- `src/plants/`: `species.ts` (plant recipes); `generator.ts` (recipe to near, mid and far geometry); `scatter.ts`; `impostor.ts`; `grass.ts`; `wind.ts`.
- `src/world/`: the terrain mesh; `lake.ts`; `river.ts`; `sky.ts`; `lighting.ts`; `clock.ts`; `tiles.ts` (per-tile drawing and level of detail).
- `src/camera/`: `freefly.ts`; `viewpoints.ts`.
- `src/audio/soundscape.ts`
- `src/residents/`: `habitat.ts`; `residents.ts`.
- `src/app/`: the valley's entry point and pause menu.
- Shared modules for the renderer, quality tiers and input, moved out of the lab.

## 6. Testing

**Vitest, no screen:**

- **Generation:** the same layout and seed give an identical world (hash check); the river falls steadily from spring to lake; the lake basin holds water; biome weights are sensible (no forest on cliffs, beach at the shore).
- **Scatter:** no trees in water or on bare rock, reeds only in shallow water, minimum spacing respected, deterministic per tile.
- **Plant generator:** deterministic, finite geometry, polygon counts within budget at every level of detail.
- **Clock:** sun and moon positions over a day, pause and jumps.
- **Habitat:** chosen spots lie in the home range and suit the animal (water for trout, land for deer); the existing `ActionController` tests still pass with the lab stage's `Habitat`.
- **Camera:** collision keeps it above ground and water and outside trunks.
- **Soundscape:** layer gains as a function of camera position, time and wind.
- **Cache:** the key changes when the layout, seed or generator version changes.

**Browser checks:**

- Dev-only hooks: `__valley.view(n)` (go to viewpoint n), `__valley.time(t)` (set the time of day), `__valley.step(frames)` and `__valley.shot(name)` (canvas to `.shots/name.png`), as in the lab.
- A contact sheet of every viewpoint at dawn, noon, golden hour and night, sent to the owner.
- An fps reading at every viewpoint on High, to confirm 60 fps.
- `tools/valley-perf.ts` times each generation step.

## 7. Risks and fallbacks

- **WebGPU limits** (8 vertex buffers, 12 uniform buffers per stage): pack per-instance plant data and wind data tightly.
- **Generation time:** erosion is the slow step. Fewer droplets on lower tiers, and results are cached anyway.
- **8 GB of VRAM:** keep textures within about 1.5 GB on High, with smaller textures on lower tiers.
- **three.js WebGPU maturity:** if cascaded shadows or planar reflections misbehave, fall back to a single shadow map and sky-only reflections.

## 8. Done when

1. The valley reads as a believable northern valley from every viewpoint, at dawn, noon, golden hour and night.
2. It runs at 60 fps at 1080p on High on the RTX 3060 Ti, streamed to the TV with a controller.
3. The resident animals wander naturally in their habitats, with feet on the real ground and fish in the water.
4. The first load takes under 15 s and later loads a couple of seconds.
5. The lab still works on `lab.html`, and all existing tests pass.

## Out of scope

Seasons, weather and events, saving the world, animal needs and life cycles, the overview map,
follow and lock-on, sense lenses, releasing lab creatures into the valley, heavy post-processing,
an underwater camera, and spatial point sounds tied to animals.
