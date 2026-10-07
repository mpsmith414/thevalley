# Creature Ecosystem: Creature Lab

A living 3D valley you watch like a nature documentary, where a child's drawing becomes a real
creature. This is **sub-project 1, the Creature Lab**: any creature recipe (hand-written, or made by
Claude from a drawing or words and checked with "look again" passes) becomes a 3D creature with fur,
scales or feathers that walks, runs, grazes, drinks, sleeps, calls, flies or swims on a turntable stage.

- Vision and roadmap: [docs/superpowers/specs/2026-10-06-vision-and-roadmap.md](docs/superpowers/specs/2026-10-06-vision-and-roadmap.md)
- Creature Lab design: [docs/superpowers/specs/2026-10-06-creature-lab-design.md](docs/superpowers/specs/2026-10-06-creature-lab-design.md)
- Build plan: [docs/superpowers/plans/2026-10-06-creature-lab.md](docs/superpowers/plans/2026-10-06-creature-lab.md)

## Run it

```bash
npm install
```

The creature designer needs a Claude API key. Copy `.env.example` to `.env` and put your key in it:

```
ANTHROPIC_API_KEY=sk-ant-...
DESIGNER_MODEL=claude-sonnet-5-5
```

`.env` is ignored by git; the key only lives in the small local server, never in the web page.
Use `DESIGNER_MODEL=claude-opus-5-5` for the stronger (about twice the price) eye.

```bash
npm run dev
```

- The lab: http://localhost:5180/
- The drawing test set: http://localhost:5180/drawings.html

Without a key everything works except making new creatures (the designer says it is resting).

```bash
npm test
```

## Controls

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

## Making a creature

Press **New creature**, drop in (or paste, or pick) a photo of a drawing and/or type a few words,
then **Bring it to life!** You'll see the drawing beside each build as the designer looks again and
fixes things. **Change it** takes words like "make it bigger" or "give it wings". Everything made is
kept in the **Gallery** in this browser, with **Save a backup** / **Load a backup**.

Settings in the Workshop: detail level, fur, skeleton view, quality tier, and the number of
look-again passes (default 3; each pass is one more Claude call).

## How it works

- `src/recipe`: the creature recipe (zod schema), normalising (clamps and repairs any input) and small edits.
- `src/builder`: recipe → skeleton → smooth "clay" distance field → surface-nets mesh (3 levels of detail) → skin weights. It runs in a Web Worker and is deterministic.
- `src/skin`: one shared TSL material (patterns, belly colour, coverings), fur shells and eyes.
- `src/motion`: limbs and gaits, FABRIK IK with planted feet, the rig (walk, fly, swim, lie down), secondary motion (head, tail, ears, wings, fins, breathing, blinking) and actions.
- `src/designer` and `server/`: the Claude designer service (read, look-again, tweak), the browser loop and image preparation.
- `src/lab`: the lab screen (controller-first UI, gallery in IndexedDB, workshop).
- `src/cast`: the native animals, hand-written recipes that set the quality bar.

## Status

Built and checked on the owner's PC (RTX 3060 Ti, WebGPU):

- Body builds (full detail, main thread, `npx tsx tools/perf.ts`): 50–450 ms per native animal. The frog is slowest at 0.45 s; the target is under 3 s.
- Planted feet slide 0 cm while walking, trotting, galloping, changing speed and circling.
- Frame cost at 1920×1080 on the high tier (one walking animal, stage, fur, shadows; simulation + render + GPU finish): wolf 7.3 ms, fox 10.5 ms, rabbit 11 ms, deer 10.3 ms, frog 6.1 ms. 60 fps needs under 16.7 ms.
- Live Claude runs (the drawing test set and the look-again loop against the real API) are waiting for an API key.
