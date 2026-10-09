# Asset credits

Every file under `public/assets/` is listed here. All are **CC0** (public domain); credit is given as thanks, not obligation.
Files were downloaded on 2026-10-08, then resized and re-encoded with `tools/resize.py` (2k at JPEG quality 82, 1k at 85; roughness as one grey channel). The planar ground diffuse maps (meadow, forest, moss, sand, mud) were also evened out with `--flatten`, which removes their large light and dark blotches so the repeat does not show from a distance; ambientCG sets were taken from their 2K-JPG zips (Color, NormalGL, Roughness).

## Ground textures (`textures/ground/`)

Each set is `<name>_{diff,nor_gl,rough}_{2k,1k}.jpg` (diffuse, OpenGL-style normal, roughness).

| Name | Used for | Source asset | URL | Licence | Date |
| --- | --- | --- | --- | --- | --- |
| `meadow` | meadow ground | ambientCG, Grass 004 (`Grass004`) | https://ambientcg.com/view?id=Grass004 | CC0 | 2026-10-08 |
| `forest` | forest floor (moss, needles, litter) | Poly Haven, Forest Leaves 02 (`forest_leaves_02`) | https://polyhaven.com/a/forest_leaves_02 | CC0 | 2026-10-08 |
| `granite` | rock and cliffs (pale lichen-flecked stone) | ambientCG, Rock 046 S (`Rock046S`) | https://ambientcg.com/view?id=Rock046S | CC0 | 2026-10-08 |
| `moss` | moss on rock tops and damp forest | ambientCG, Moss 002 (`Moss002`) | https://ambientcg.com/view?id=Moss002 | CC0 | 2026-10-08 |
| `sand` | lake beach | Poly Haven, Coast Sand 01 (`coast_sand_01`) | https://polyhaven.com/a/coast_sand_01 | CC0 | 2026-10-08 |
| `mud` | wet shore | Poly Haven, Brown Mud 02 (`brown_mud_02`) | https://polyhaven.com/a/brown_mud_02 | CC0 | 2026-10-08 |

## Bark textures (`textures/bark/`)

| Name | Used for | Source asset | URL | Licence | Date |
| --- | --- | --- | --- | --- | --- |
| `pine` | pine trunks | Poly Haven, Pine Bark (`pine_bark`) | https://polyhaven.com/a/pine_bark | CC0 | 2026-10-08 |
| `spruce` | spruce and generic trunks | Poly Haven, Bark Brown 02 (`bark_brown_02`) | https://polyhaven.com/a/bark_brown_02 | CC0 | 2026-10-08 |

Birch bark, and all leaf, needle and fern cards, are painted in code (`src/plants/cards.ts`).

## Ambient sound (`audio/`)

Every recording is by Joseph Sardin on BigSoundBank (La Sonothèque), released under **CC0 1.0** ("CC0 (public domain): Free and
royalty-free" on each sound's page; licence: https://bigsoundbank.com/licenses.html). Each was taken from the site's MP3 (320 kbps),
then cut to a seamless loop (the last 3–4 s crossfaded over the start), mixed to mono, high-passed at 40 Hz, levelled to about
-20 dBFS RMS (peaks kept under -1 dBFS) and encoded as OGG Vorbis (quality 3, 44.1 kHz). Any file missing at runtime is
synthesised instead (`src/audio/soundscape.ts`).

| File | Used for | Source sound (seconds used) | URL | Author | Licence | Date |
| --- | --- | --- | --- | --- | --- | --- |
| `wind.ogg` | wind | Wind, #0595 (22–70 s) | https://bigsoundbank.com/wind-s0595.html | Joseph Sardin | CC0 | 2026-10-09 |
| `birds.ogg` | daytime birdsong | Forest #4, #2749 (101–150 s) | https://bigsoundbank.com/forest-4-s2749.html | Joseph Sardin | CC0 | 2026-10-09 |
| `night.ogg` | night crickets | Campaign at Night #4, #1880 (101–149 s) | https://bigsoundbank.com/campaign-at-night-4-s1880.html | Joseph Sardin | CC0 | 2026-10-09 |
| `owl.ogg` | the owl's call at night | Tawny Owl #1, #1763 (0–7.5 s) | https://bigsoundbank.com/tawny-owl-1-s1763.html | Joseph Sardin | CC0 | 2026-10-09 |
| `lake.ogg` | water lapping at the lake | Pontoon, marina, #1444 (28–63 s; also low-passed at 7 kHz) | https://bigsoundbank.com/pontoon-marina-s1444.html | Joseph Sardin | CC0 | 2026-10-09 |
| `river.ogg` | the river | Small Stream #4, #1354 (55–103 s) | https://bigsoundbank.com/small-stream-4-s1354.html | Joseph Sardin | CC0 | 2026-10-09 |
| `forest.ogg` | leaves rustling in the forest | Wind in the Trees, #0904 (62–110 s) | https://bigsoundbank.com/forest-wind-in-the-trees-s0904.html | Joseph Sardin | CC0 | 2026-10-09 |
