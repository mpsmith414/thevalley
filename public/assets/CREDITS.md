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
