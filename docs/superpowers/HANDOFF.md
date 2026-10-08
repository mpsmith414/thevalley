# Handoff: where Creature Ecosystem stands (2026-10-07)

Read this first in a new session, then the specs it points to.

## The project

A semi-realistic 3D living valley watched like a nature documentary, for the owner's family on the TV
(a 6-year-old included). A child's drawing or a few words become a real creature through Claude.

- Vision, decisions and roadmap: `docs/superpowers/specs/2026-10-06-vision-and-roadmap.md`
- Sub-project 1 design and plan: `docs/superpowers/specs/2026-10-06-creature-lab-design.md`, `docs/superpowers/plans/2026-10-06-creature-lab.md`
- How it works, how to run it, controls and status: `README.md`

## Where things are

- **Sub-project 1, the Creature Lab, is built** on branch `feat/creature-lab` (113 tests, `npx tsc --noEmit` clean, `npm run build` OK).
  The owner tested it live with their own key and says it works. **It is not merged to `main` yet**: ask the owner before merging.
  There is no git remote yet.
- `.env` (gitignored) holds the owner's key. They use a **multi-workspace key**, so `ANTHROPIC_WORKSPACE_ID` is also set and sent as the `anthropic-workspace-id` header.
- The designer asks Claude for **plain JSON** against the schema (written into the cached instructions). The recipe schema is too big for constrained structured outputs ("compiled grammar is too large"). The server validates leniently, normalises (it infers missing part roles from ids, among other repairs) and retries once.
- Owner's verdict on quality: a first pass. **Shapes and faces bother them most.** They want the Valley first, then a **committed heavy Lifeform Polish** pass (now roadmap item 3).

## Roadmap (updated)

1. Creature Lab: built
2. **The Valley: next, brainstorming in progress**
3. Lifeform Polish (committed): shapes and faces first, then fur, motion and post-processing
4. The Living Ecosystem
5. Views and Eyes
6. Bring It to Life (phone)
7. Weather and Events
8. The Director

## The Valley brainstorm so far

Already decided in the vision: one rich valley about 1–2 km across (forest, meadow, a lake fed by a
river, rocky hills, maybe a small beach); browser and WebGPU on the owner's RTX 3060 Ti, streamed to a
Fire TV Cube with Moonlight; controller first; quality tiers; "living diorama" naturalism.

**Open question 1** (asked, not yet answered): what kind of place should it feel like?

- A. a northern temperate valley: pine and birch, wildflower meadow, clear lake, mossy granite. Recommended, since all eight native animals fit.
- B. a lush green countryside valley
- C. a mountain valley
- D. something exotic (tropical or savanna), which would need new native animals

Likely next questions, one at a time:

1. Vegetation: code-generated (procedural) trees and plants versus CC0 models.
2. Hand-crafted versus seeded, generated terrain.
3. Day and night speed, and whether seasons come now or later.
4. Whether the native animals wander the valley in this sub-project (using the lab's `ActionController`) or it stays empty until the Ecosystem.
5. Which camera modes come now: free-fly and an overview map, with the rest in Views and Eyes.
6. Whether the lab stays as a separate page or becomes a tent or studio inside the valley.

Follow the usual flow: brainstorm (one question at a time, multiple choice, recommendation first) →
spec in `docs/superpowers/specs/` → plan in `docs/superpowers/plans/` → build autonomously on a feature
branch → screenshots → merge only on the owner's OK.

## Dev tips that save time

- The preview tool reads `.claude/launch.json` from the session's original folder. Start the session in `CreatureEcosystem2` (the `lab` configuration, port 5180), or run `npm run dev` yourself.
- The app window is often hidden, which freezes animation frames, CSS transitions and the screenshot tool. In the lab (dev only) use `__lab.step(frames)`, `__lab.shot(name)` (canvas to `.shots/name.png`) and `__lab.screen(name)` (stage plus UI). `resize_window` to 1920×1080 gives a real layout. `python tools/tile.py OUT IN...` makes contact sheets.
- WebGPU limits: at most 8 vertex buffers and 12 uniform buffers per shader stage. Pack attributes and uniforms accordingly.
- `npx tsx tools/perf.ts` gives body build times. `npx tsx tools/make-test-drawings.ts` regenerates the synthetic test drawings.
