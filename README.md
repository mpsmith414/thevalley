# Creature Ecosystem

A living 3D valley you watch like a nature documentary, where a child's drawing becomes a real creature.

- **The Valley:** a northern valley with a lake, a river, forest, meadows and rocky ridges, a day and night cycle,
  resident animals, wind and an ambient soundscape. Fly through it with a controller or keyboard and mouse, or glide
  between viewpoints.
- **Animals with lives:** the animals follow their needs. Herds graze and drink together with one on watch, foxes and
  wolves stalk and sometimes chase, the hawk dives, and prey freezes, hides or flees. Most hunts fail, and the rare
  catch is gentle. Ducks raft up at dusk, frogs call in the evening, and new animals wander in from the valley's edge.
- **The Creature Lab:** a drawing, a few words, or both become a 3D creature with fur, scales or feathers that walks,
  runs, grazes, drinks, sleeps, calls, flies or swims. Claude designs it and looks again at each build to fix it.
- **Bring it to life:** phones on the home Wi-Fi join from a QR code on the TV. Draw, snap a photo of a paper drawing or
  describe a creature, watch it being made on the TV, tweak it, then release it: a family of three walks into the valley
  and stays.

Built with TypeScript, [three.js](https://threejs.org/) (WebGPU), Vite and a small [Hono](https://hono.dev/) server.

## Motion and the picture

- **Bodies that move like bodies:** a walking animal's weight shifts from leg to leg, its spine and hips work, its head
  stays steadier than its shoulders and its tail and ears follow through. Birds bob their heads, fliers fold their legs
  and wings, bank into turns and flare to land, and fish and snakes swim with a wave that grows towards the tail.
- **Starts, stops and turns:** animals crouch a little before they set off, settle as they stop, square up their feet
  when they stand and lead a turn with their heads.
- **The picture:** the valley and the lab are drawn through a small post pipeline (multisampled scene, a soft bloom
  on the sun and its glints, tone mapping and a colour grade). The grade follows the time of day: warm and golden at the
  low sun, cool and quiet at night. Animals stand on soft contact shadows.
- **Tools for checking it:** in the lab, `__lab.clip(...)` records a gait as a strip of frames, `tools/tile.py` makes a
  contact sheet from them and `tools/gif.py` makes a looping GIF (or a before-and-after pair).
- **Numbers** (an RTX 3060 Ti at 1920×1080, High): the busiest viewpoint costs about 20 ms a frame measured one frame at
  a time (the live loop overlaps the CPU and GPU, so it does better); bloom adds about 0.5 ms and contact shadows nothing
  measurable. The animal rig costs about 0.05 ms an update, 2.4 times less than before, and every body still builds in
  under 3 seconds.

## Views and eyes

- **Ride along with any animal:** look at an animal and its ring and name show; press A to follow it. Three views:
  **Follow** (behind it, orbit and zoom), **Close** (riding along just over its shoulder) and **Eyes** (what it sees).
  The previous and next animal are a button away, and fast valley time never loses it.
- **Through its eyes:** each animal sees in its own way, from its recipe. Prey with eyes on the sides of their heads see
  wider, the hawk narrow and sharp, deer, foxes and wolves in muted two-colour sight, birds and fish in richer colour.
  At night the deer, fox and wolf see a brighter, grainier picture and the hawk sees less. A trout's eyes look up at the
  bright, rippling surface through green water. Released creatures get their own look from their recipe.
- **Special senses:** X switches through the animal's own senses. **Smell** shows the paths other animals walked in the
  last two valley hours as glowing wisps (its prey gold, its dangers red), **Hearing** sends ripples out from whatever is
  running or calling, the hawk's **Sharp eyes** pick out moving prey (and zoom in, in Eyes), and **Fear** pulses the
  screen's edge with a heartbeat that quickens as the danger nears, with a soft red ring round the danger.
- **Take the reins:** steer the animal yourself. It grazes, drinks or calls on A, flies if it can, and everyone else
  reacts to it for real: rabbits bolt from a steered fox, and a steered hunter hunts by the valley's own rules and odds.
  A steered rabbit always gets away. The valley runs at normal speed while you steer, and 20 seconds without a touch
  hands the animal back to its own life.
- **The map:** Tab (View on the controller) lifts the camera high over the whole valley, with a marker for every animal
  (a star for each released creature) and the places named. Choose an animal and the camera dives down to follow it, or
  choose a place to fly there.
- **Numbers** (the same PC, High): free flight costs about the same as before; the Eyes lenses measured at most 0.2 ms
  and Smell and Hearing at most 0.3 ms, the map draws in 6 ms against the busiest viewpoint's 21 ms, and no switch
  (view, sense, the map) took a frame over 50 ms.

## Requirements

- Node.js 22.9 or newer
- A browser with WebGPU (Chrome or Edge) for the valley; the lab also runs on WebGL 2
- A Claude API key to make new creatures (everything else works without one)

## Setup

```bash
npm install
cp .env.example .env   # then put your key in .env
```

```
ANTHROPIC_API_KEY=sk-ant-...
DESIGNER_MODEL=claude-sonnet-5-5
```

The key stays in the local server and is never sent to the web page. `.env` is ignored by git.

## Run it

```bash
npm run dev
```

- The valley: http://localhost:5180/
- The lab: http://localhost:5180/lab.html

To play on the TV with phones joining, build and serve everything on one port (5180, on your local network):

```bash
npm run home
```

Open the valley on the PC (streamed to the TV with something like Sunshine and Moonlight, if the PC isn't plugged into
it), then choose **Add a creature** in the menu. Phones on the same Wi-Fi scan the QR code. If a phone can't connect,
allow inbound TCP port 5180 on private networks in your firewall; if the address on the card is wrong, set
`PHONE_HOST` in `.env`.

There is no HTTPS, so the phone page doesn't use the camera or microphone directly: **Photo** opens the phone's camera
app, and the keyboard's microphone key works for talking.

`npm test` runs the tests; `npm run build` makes the static site in `dist/`.

## Controls

### The Valley

| | Controller | Keyboard and mouse |
|---|---|---|
| Move | Left stick | W A S D |
| Look | Right stick | Mouse (click the view first) |
| Up / down | RT / LT | E / Q |
| Fast | RB (hold) | Shift (hold) |
| Walk height on / off | Y | G |
| Previous / next viewpoint | D-pad left / right | Arrow left / right, or 1–8 |
| Menu | Start | Esc |
| In the menu: move, choose, back | D-pad, A, B | Arrow keys, Enter, Backspace |
| Sound off / on | (menu) | M |
| Time a step slower / faster | D-pad down / up | [ / ], or arrow down / up |
| Fly to the animal in the caption and follow it | X | F |
| Follow the animal you are looking at (its ring and name show) | A | Enter / Space, or click |
| The map (open / close) | View | Tab |
| On the map: move the cursor, zoom, choose | Left stick, RT / LT, A | Mouse or W A S D, wheel or E / Q, click or Enter |
| Following: change view (Follow, Close, Eyes) | Y | V |
| Following: sense on / next / off | X | X |
| Following: previous / next animal | LB / RB | , / . |
| Following: orbit, or look round | Right stick | Mouse |
| Following (Follow view): nearer / farther | LT / RT | Q / E |
| Following: take the reins | A | Enter / R |
| Following: let go | B, or move | Backspace, or W A S D |
| With the reins: go, run | Left stick, RB (hold) | W A S D, Shift (hold) |
| With the reins: eat, drink or call | A | Enter / Space |
| With the reins: fly up / down (fliers) | RT / LT | E / Q |
| With the reins: hand them back | B | Backspace / R |

The menu has the time of day and its speed (Paused, Slow, Normal, Fast and Fastest, where a whole day takes 90
seconds), quality, volume, captions on or off, **Add a creature**, **Creatures** (visit, send off exploring or bring
back each released creature), a daily limit on new creatures and the **Valley** page (start the valley again, back it
up to a file, restore a backup).

The valley remembers itself: the animals, the hour and the speed are saved in the browser, so it carries on where it left
off. A quiet caption at the bottom names the good moments (a stalk, a chase, a raft of ducks); press **Fly there** to
glide to the animal and follow it, until you let go. Esc opens the menu in every mode (on the map it closes the map).

### The Creature Lab

| | Controller | Keyboard and mouse |
|---|---|---|
| Look around | Left stick | Drag, or W A S D |
| Zoom | Right stick | Mouse wheel |
| Move between buttons, press | D-pad, A | Arrow keys, Enter |
| Close a panel | B | Esc |
| Walk / Run | X / Y | X / Y |
| Previous / next creature | LB / RB | [ / ] |
| New creature | Start | N |

Press **New creature**, add a photo of a drawing and/or a few words, then **Bring it to life!** **Change it** takes
words like "make it bigger". Creatures are kept in the lab's gallery in the browser, and **Release into the valley**
sends one to the valley.
