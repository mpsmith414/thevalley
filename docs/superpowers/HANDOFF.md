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
2. **The Valley: spec approved, plan next**
3. Lifeform Polish (committed): shapes and faces first, then fur, motion and post-processing
4. The Living Ecosystem
5. Views and Eyes
6. Bring It to Life (phone)
7. Weather and Events
8. The Director

## The Valley

Brainstorm finished and approved on 2026-10-07. Spec: `docs/superpowers/specs/2026-10-07-valley-design.md`
(a northern temperate valley; code-built plants with CC0 textures; layout file plus seeded erosion; a
24-minute day, no seasons yet; about 16 resident natives; free-fly plus viewpoints; valley on `index.html`,
lab on `lab.html`; 1080p60 on High; an ambient soundscape). Next: the implementation plan in
`docs/superpowers/plans/`, then build on a feature branch.

Follow the usual flow: spec → plan → build autonomously on a feature branch → screenshots → merge only
on the owner's OK.

## Dev tips that save time

- The preview tool reads `.claude/launch.json` from the session's original folder. Start the session in `CreatureEcosystem2` (the `lab` configuration, port 5180), or run `npm run dev` yourself.
- The app window is often hidden, which freezes animation frames, CSS transitions and the screenshot tool. In the lab (dev only) use `__lab.step(frames)`, `__lab.shot(name)` (canvas to `.shots/name.png`) and `__lab.screen(name)` (stage plus UI). `resize_window` to 1920×1080 gives a real layout. `python tools/tile.py OUT IN...` makes contact sheets.
- WebGPU limits: at most 8 vertex buffers and 12 uniform buffers per shader stage. Pack attributes and uniforms accordingly.
- `npx tsx tools/perf.ts` gives body build times. `npx tsx tools/make-test-drawings.ts` regenerates the synthetic test drawings.
