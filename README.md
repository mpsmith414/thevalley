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
| Fly to the animal in the caption | X | F |

The menu has the time of day and its speed (Paused, Slow, Normal, Fast and Fastest, where a whole day takes 90
seconds), quality, volume, captions on or off, **Add a creature**, **Creatures** (visit, send off exploring or bring
back each released creature), a daily limit on new creatures and the **Valley** page (start the valley again, back it
up to a file, restore a backup).

The valley remembers itself: the animals, the hour and the speed are saved in the browser, so it carries on where it left
off. A quiet caption at the bottom names the good moments (a stalk, a chase, a raft of ducks); press **Fly there** to
glide to the animal and follow it.

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
