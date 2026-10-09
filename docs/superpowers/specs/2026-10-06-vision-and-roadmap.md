# Creature Ecosystem: Vision and Roadmap

Date: 2026-10-06 · Status: approved in brainstorming · Working title: "Creature Ecosystem"

## The idea

A living, semi-realistic 3D valley full of natural animals, plants and weather that you
mostly *watch*, like a nature documentary you can step into. Anyone can push something new
into it (a creature or a weather event) from a drawing, a photo or a few words, and see how
the valley reacts. You can fly anywhere, lock onto any living thing, ride along behind it or
see through its eyes, and take the reins whenever you like.

## Decisions

| Area | Decision |
|---|---|
| Heart | A living terrarium / nature-documentary sandbox. Believable, not scientifically exact. Spectacle and surprise first. |
| Audience | The family watching together on the TV (a 6-year-old included). Documentary tone: hunts happen, but they end in a cut-away or a gentle "return to the earth", never gore. |
| Sharing | Friends open a link and get their own valley in their own browser. Creature swapping between valleys comes later. |
| Platform | Browser. TypeScript, Vite, Vitest and Three.js (WebGPU renderer, WebGL2 fallback). Main target: the owner's gaming PC (RTX 3060 Ti, 8 GB), streamed to a Fire TV Cube with Sunshine/Moonlight. |
| Controls | Controller first. Keyboard and mouse fully supported. |
| Look | "Living diorama" naturalism: realistic proportions, materials, light and motion, with slightly simplified surfaces. Not photo-real. |
| World | One rich valley about 1–2 km across: forest, meadow, a lake fed by a river, rocky hills, maybe a small beach. |
| Time | Persistent. Pause, play and fast-forward. Saves and carries on. A guarded "reset the valley" button. |
| Creatures | Every creature, native or pushed in, is a **recipe**. Bodies come from a free-form builder (no templates, no "closest animal"), rendered realistically but faithful to the drawing's shape, colours and features. |
| Life | Full life cycle: birth, growth, mating, babies, old age, gentle death. Babies inherit their parents' recipe with small variations, so populations drift. No hybrids between species. |
| Lock-on | Ride along by default (the animal lives its own life). "Take the reins" to steer it, and let go to hand back control. |
| Eyes | Sense "lenses" built from each recipe: field of view, sharp sight, night vision, scent trails, colour range, underwater view, fear pulse. |
| Pushing in | A phone photo via QR or pairing code, an on-screen draw pad, voice or typing, or a mix. Then a preview stage with kid-friendly recipe cards and a tweak box. |
| Events | Event recipes, realistic or wildly imaginative, with real consequences (shelter, flight, floods, burnt hillsides). Nature always recovers. |
| Finding moments | A "documentary director" spots interesting moments and offers to fly you there. An auto-documentary camera mode. Optional gentle narration. |

## Architecture

```
  Any computer's browser                          Phone (optional)
  ┌──────────────────────────────────┐          ┌──────────────────┐
  │ The game (static website)         │          │ Companion page   │
  │  ├ Main thread: rendering, input  │          │ photo · draw ·   │
  │  ├ Sim worker: the ecosystem      │          │ voice            │
  │  ├ Builder worker: recipe → body  │          └───────┬──────────┘
  │  └ Saves in the browser + backup  │                  │ pairing code
  └──────────────┬───────────────────┘                  │
                 │  "design this creature"               │
                 ▼                                       ▼
        ┌──────────────────────────────────────────────────┐
        │ Creature Designer service (tiny, holds the key)   │
        │ drawing/words → recipe · access codes + daily cap │
        │ phone relay · runs on the PC now, cloud later     │
        └──────────────────────────────────────────────────┘
```

- **The recipe is the backbone.** It's a versioned data format, and every system reads only recipes. Saves store recipes, not meshes. Version migrations keep old saves working.
- **Bodies are rebuilt from recipes** in a background worker, deterministically: the same recipe always gives the same creature on any machine.
- **The simulation runs in its own worker** on a fixed clock with seeded randomness. That buys smooth fast-forward and lets the rules be tested without a screen.
- **The game is a static site.** Valleys save in the browser (IndexedDB), with export and import for backups.
- **The Creature Designer service** is the only part with a secret (the Claude API key). It builds its own prompts and only answers creature and event design requests. It runs locally during development and deploys to a cheap cloud function for sharing, with access codes and a per-code daily cap.
- **Quality tiers** (low, medium, high) exist from the start, because friends' machines vary.
- **AI model:** Claude Sonnet 5.5 by default, with Claude Opus 5.5 as a setting. Expected cost is roughly $0.20–0.35 per creature on Sonnet, including look-again passes.

## Roadmap

Risk first: the free-form, drawing-faithful body builder is the hardest and least certain
piece, and the whole concept rests on it, so it comes first. Each sub-project gets its own
spec → plan → build cycle and ends with something the family can enjoy.

1. **Creature Lab** (built, branch `feat/creature-lab`): the recipe format, the body builder, procedural movement, the skin system, the Creature Designer with "look again", the turntable lab, and the native cast. Spec: `2026-10-06-creature-lab-design.md`.
2. **The Valley** (built 2026-10-09, branch `feat/valley`, not merged yet): terrain, water, sky, day and night, vegetation, the free-fly camera, controls and quality tiers, plus resident animals and an ambient soundscape. Spec: `2026-10-07-valley-design.md`.
3. **Lifeform Polish (committed, next):** a heavy pass on how creatures look and move, once they can be seen in the valley. After the first Creature Lab review (2026-10-07) the owner's biggest concerns were **shapes** (blobby, tube-like bodies with no muscle, joint or jaw definition) and **faces** (no eyelids, noses, ear insides or expression), so those come first. Then fur (direction, strand lighting, guard hairs), motion (spine flex, weight shift, head bob) and post-processing (ambient occlusion, depth of field, colour grading). Target: the "living museum diorama" ceiling chosen in brainstorming.
4. **The Living Ecosystem:** needs and behaviours, plants, the life cycle and inheritance, populations, time controls, save and reset.
5. **Views and Eyes:** follow, lock-on, sense lenses, taking the reins, and the overview map.
6. **Bring It to Life:** the phone companion (QR or pairing code, photo, draw pad, voice), the lab as the preview step, and releasing creatures into the valley.
7. **Weather and Events:** natural weather, event recipes, consequences and recovery.
8. **The Director:** moment detection, pop-up invitations, the auto-documentary camera and narration.

Later ideas, deliberately out of scope for now: swapping creatures between friends' valleys,
several saved valleys, a "while you were away" recap, a magical hybrid event, a hand-drawn
"storybook" rendering style, and AI-generated 3D models as an experiment.
