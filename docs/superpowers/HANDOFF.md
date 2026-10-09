# Handoff: where Creature Ecosystem stands (2026-10-09)

Read this first in a new session, then the specs it points to.

## The project

A semi-realistic 3D living valley watched like a nature documentary, for the owner's family on the TV
(a 6-year-old included). A child's drawing or a few words become a real creature through Claude.

- Vision, decisions and roadmap: `docs/superpowers/specs/2026-10-06-vision-and-roadmap.md`
- Sub-project 1 design and plan: `docs/superpowers/specs/2026-10-06-creature-lab-design.md`, `docs/superpowers/plans/2026-10-06-creature-lab.md`
- Sub-project 2 design and plan: `docs/superpowers/specs/2026-10-07-valley-design.md`, `docs/superpowers/plans/2026-10-07-valley.md`
- How it works, how to run it, controls, performance and status: `README.md`

## Where things are

- **Sub-project 1, the Creature Lab, is built** on branch `feat/creature-lab`. The owner tested it live with their own
  key and says it works.
- **Sub-project 2, the Valley, is built** on branch `feat/valley`, branched from `feat/creature-lab` (21 tasks, about
  50 commits; 443 tests, `npx tsc --noEmit` clean, `npm run build` OK). The valley is on `/` (`index.html`), the lab on
  `/lab.html`.
- **Nothing is merged to `main`**, and there is no git remote, so nothing is pushed. Ask the owner before merging
  (`feat/valley` contains `feat/creature-lab`, so merging it brings both).
- `.env` (gitignored) holds the owner's key. They use a **multi-workspace key**, so `ANTHROPIC_WORKSPACE_ID` is also set and sent as the `anthropic-workspace-id` header.
- The designer asks Claude for **plain JSON** against the schema (written into the cached instructions). The recipe schema is too big for constrained structured outputs ("compiled grammar is too large"). The server validates leniently, normalises (it infers missing part roles from ids, among other repairs) and retries once.
- Owner's verdict on the lab: a first pass. **Shapes and faces bother them most.** That is the next sub-project.

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
- River Bend is the heaviest view (16.1 ms serial proxy, 13 ms live estimate). If the TV shows drops there, the near
  and mid tree bands (each ~4.4 ms of camera pass there) are the levers.
- Visual: night is very dark and blue; the forest floor is dark at dawn and golden hour; far meadows and rock faces read
  as flat colour from high up; the river reads as a straight canal near River Bend, with a pale rim along its banks;
  lupines are vivid; golden-hour haze goes khaki facing away from the sun; the fox is bright at dusk; birch crowns thin.
- Rendering: mid trees cast no shadow in the nearest cascade (a low-sun pop is possible); reeds, ducks and near-shore
  trees are not in the lake's mirror; a slight blue cast in shade.
- three.js r186 is pinned by several workarounds; recheck each on an upgrade: the skinning-name patch
  (`src/render/skinning-patch.ts`), the CSM `normalWorld` band fix in `sky.ts`, the mirror's shadow hold and
  precompile skip in `lake.ts`, and `compileTogether`'s reliance on `compileAsync` gathering synchronously
  (`src/render/compile.ts`).
- Smaller code items (untested paths, magic numbers, duplicated helpers) are listed per task in
  `.superpowers/sdd/progress.md` under "Minor".

## Roadmap

1. Creature Lab: built
2. The Valley: built (on `feat/valley`, not merged)
3. **Lifeform Polish (committed): next.** Shapes and faces first, then fur, motion and post-processing. The creatures
   can now be seen in the valley, which is what this pass was waiting for.
4. The Living Ecosystem
5. Views and Eyes
6. Bring It to Life (phone)
7. Weather and Events
8. The Director

Follow the usual flow: brainstorm → spec → plan → build autonomously on a feature branch → screenshots → merge only
on the owner's OK.

## Dev tips that save time

- The preview tool reads `.claude/launch.json` from the session's original folder. Start the session in `CreatureEcosystem2` (the `valley` or `lab` configuration, port 5180), or run `npm run dev` yourself.
- The app window is often hidden, which freezes animation frames, CSS transitions and the screenshot tool. Use the dev hooks instead: in the valley `__valley.step(frames)`, `__valley.shot(name)`, `__valley.screen(name)`, `__valley.tour(prefix)`, `__valley.perf()`, `__valley.timings`; in the lab `__lab.step`, `__lab.shot`, `__lab.screen`. Shots land in `.shots/`. `resize_window` to 1920×1080 gives a real layout. `python tools/tile.py OUT IN... --cols N` makes contact sheets.
- To time a first visit, delete the IndexedDB database `creature-valley` and reload.
- WebGPU limits: at most 8 vertex buffers and 12 uniform buffers per shader stage. Pack attributes and uniforms accordingly.
- `npx tsx tools/valley-perf.ts 2049` gives valley generation times; `npx tsx tools/perf.ts` gives body build times; `npx tsx tools/make-test-drawings.ts` regenerates the synthetic test drawings.
