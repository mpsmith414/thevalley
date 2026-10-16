/** The release (spec §3.4): a made creature is saved, given a home, and its family walks into the valley; and the menu's Visit, Off exploring and Come back (§3.6). */
import type { Object3D } from 'three/webgpu';
import { familySeeds, type CreatureList } from '../creatures/list';
import type { GalleryItem } from '../lab/gallery';
import type { Family, Residents } from '../residents/residents';
import type { Vec3 } from '../util/vec';
import type { Viewpoint } from '../valley/types';
import type { Valley } from '../valley/valley';
import { arrivalHome, arrivalShot, arrivalView, entryPoints, onwardPoints, type ArrivalShot } from './arrival';
import type { Made } from './workshop';

/**
 * The whole arrival (glide, push-in, follow: about 20-25 s) lasts at most this long (s) from the glide's start, even if
 * nobody comes into the picture; the next turn waits for it (Ruling R17).
 */
export const HOLD_CAP = 35;
/** The arrival framing's distance back (m, `arrivalView`); an animal this high (m) is flying, framed from this far back. */
const ARRIVAL_BACK = 12, FLYING = 3, FLIER_BACK = 35;
/** A family of three (constraints). */
const FAMILY = 3;

export type ReleaseDeps = {
  list: CreatureList;
  residents: Pick<Residents, 'addSpecies' | 'removeSpecies' | 'familyOf'>;
  valley: Valley;
  /** Where the camera is and which way it faces (level). */
  camera(): { eye: Vec3; forward: { x: number; z: number } };
  /** Glide the camera to a framing (Visit); resolves once it is there (or the player took over). */
  glideTo(v: Viewpoint): Promise<void>;
  /** Family `id`'s arrival begins: the camera glides to the shot's wide framing; resolves once there (or the player took over). */
  arriveAt(id: string, shot: ArrivalShot): Promise<void>;
  /**
   * The family is in: the camera pushes in to the close framing and then follows its lead walking on (the player's stick
   * ends it); `title` shows, with the chime, once one of them is in the picture.
   */
  hold(id: string, title: string): void;
  /** Family `id`'s arrival is off (its body would not build or compile): the camera and the next turn go free at once. */
  cancel(id: string): void;
  /** Compile a family's bodies (detached from the valley) before they are shown. */
  compile(root: Object3D): Promise<void>;
  /** Make a family's shadow pipelines (`compileAsync` cannot), after every live add, however the camera's hold goes. */
  warm(): void;
  /** Wall-clock ms (saved as the creature's dates). */
  now(): number;
  newId(): string;
};

/** The made creature as a list item, kept only (no valley record yet). */
function madeItem(made: Made, id: string, now: number): GalleryItem {
  return {
    id, recipe: made.recipe, cards: made.cards, drawing: made.input.image, words: made.input.words, thumb: made.thumb,
    history: made.history.map(({ render: _render, ...rest }) => rest), createdAt: now, native: false, maker: made.maker,
  };
}

/**
 * The camera glides to the family's wide framing (a clear view of open ground) while its bodies compile, and the family
 * walks in from out of view, then on together into the valley.
 */
async function arrive(family: Family, deps: ReleaseDeps): Promise<void> {
  const home = family.valley.home;
  const shot = arrivalShot(deps.valley, home, deps.camera().eye, family.recipe.life.sizeM);
  const entry = entryPoints(deps.valley, home, shot.wide, FAMILY, family.recipe.life.sizeM);
  const onward = onwardPoints(deps.valley, home, shot.close, FAMILY) ?? undefined;
  const glided = deps.arriveAt(family.id, shot);
  // compiled during the glide, but in the valley only once the camera is there: it must not watch them appear from afar
  try {
    await deps.residents.addSpecies(family, { entry, onward, compile: async (root) => {
      await deps.compile(root);
      await glided;
    } });
  } catch (e) {
    deps.cancel(family.id); // Review Focus 5: a failed family never holds the camera or the line
    throw e;
  }
  deps.warm();
}

/** The family is in: the camera pushes in and follows it, and its title shows (with the chime) once it is seen. */
function welcome(family: Family, deps: ReleaseDeps, back = false) {
  const name = family.cards?.name || 'A new friend';
  deps.hold(family.id, back ? `${name} is back!` : `${name} has come to the valley!`);
}

/** Save the made creature (released), find its home, glide there, bring the family in. Returns the saved item. */
export async function releaseMade(made: Made, deps: ReleaseDeps): Promise<GalleryItem> {
  const now = deps.now();
  const kept = madeItem(made, deps.newId(), now);
  const item: GalleryItem = { ...kept, valley: { status: 'released', seeds: familySeeds(made.recipe, now), releasedAt: now } };
  await deps.list.save(item);
  let family: Family;
  try {
    const { eye, forward } = deps.camera();
    const home = arrivalHome(deps.valley, made.recipe, item.id, eye, forward);
    await deps.list.setHome(item.id, home);
    family = { ...item, valley: { ...item.valley!, home } };
    await arrive(family, deps);
  } catch (e) {
    // the body would not build or compile: the creature is kept (the lab has it) and the caller says "let's try again"
    console.error('release: the family could not come into the valley; the creature is kept', e);
    await deps.list.save(kept);
    return kept;
  }
  welcome(family, deps);
  return family;
}

/** Save the made creature as kept (lab only, no valley record). */
export async function keepMade(made: Made, deps: Pick<ReleaseDeps, 'list' | 'now' | 'newId'>): Promise<GalleryItem> {
  const item = madeItem(made, deps.newId(), deps.now());
  await deps.list.save(item);
  return item;
}

/** Glide to the family (false if none of it is in the valley: never released, gone exploring or walking out). */
export function visit(id: string, deps: Pick<ReleaseDeps, 'residents' | 'camera' | 'glideTo'>): boolean {
  const members = deps.residents.familyOf(id).filter((a) => !a.errand?.out);
  if (!members.length) return false;
  const n = members.length;
  const c = { x: members.reduce((s, a) => s + a.rig.position.x, 0) / n, z: members.reduce((s, a) => s + a.rig.position.z, 0) / n };
  // they wander tens of metres apart, and a picture with all three is one of dots: frame the one nearest the middle
  // as the arrival does (from the camera's side, 12 m back), the others in the picture when they are near
  const near = (a: (typeof members)[number]) => Math.hypot(a.rig.position.x - c.x, a.rig.position.z - c.z);
  const one = members.reduce((a, b) => (near(b) < near(a) ? b : a));
  void deps.glideTo(visitView(one.rig.position, one.rig.altitude, one.home, deps.camera().eye));
  return true;
}

/**
 * Visit's framing of one animal at `p`, `altitude` m above the ground: the arrival's framing (12 m back, 4 m up, from the
 * camera's side); a flier up in the air (soaring at 28–45 m) from FLIER_BACK m back and level with it, so its circles
 * stay in the picture.
 */
export function visitView(p: { x: number; z: number }, altitude: number, home: Family['valley']['home'], eye: { x: number; z: number }): Viewpoint {
  const view = arrivalView({ ...home, center: { x: p.x, z: p.z } }, eye);
  if (altitude < FLYING) return view;
  const dx = (view.pos.x - p.x) / ARRIVAL_BACK, dz = (view.pos.z - p.z) / ARRIVAL_BACK;
  return { name: 'visit', pos: { x: p.x + dx * FLIER_BACK, z: p.z + dz * FLIER_BACK, h: altitude + 2 }, look: { x: p.x, z: p.z, h: altitude } };
}

/** Off exploring: marked so in the list (it stays there), and the family walks out of view and is removed. */
export async function sendExploring(id: string, deps: Pick<ReleaseDeps, 'list' | 'residents'>): Promise<void> {
  await deps.list.explore(id);
  await deps.residents.removeSpecies(id);
}

/** Come back: released again, it arrives at its saved home with the entry walk. If it cannot, it stays exploring (and this rejects). */
export async function comeBack(id: string, deps: ReleaseDeps): Promise<void> {
  const item = await deps.list.release(id, undefined, deps.now());
  let family: Family;
  try {
    let home = item.valley!.home;
    if (!home) {
      const { eye, forward } = deps.camera();
      home = arrivalHome(deps.valley, item.recipe, id, eye, forward);
      await deps.list.setHome(id, home);
    }
    family = { ...item, valley: { ...item.valley!, home } };
    await arrive(family, deps);
  } catch (e) {
    await deps.list.explore(id);
    throw e;
  }
  welcome(family, deps, true);
}

/** Released lab creatures without a home get one in front of `eye` (Ruling P3) and are saved. */
export async function placeHomeless(items: GalleryItem[], deps: Pick<ReleaseDeps, 'list' | 'valley' | 'camera'>): Promise<GalleryItem[]> {
  const { eye, forward } = deps.camera();
  const out: GalleryItem[] = [];
  for (const item of items) {
    if (item.valley?.status !== 'released' || item.valley.home) {
      out.push(item);
      continue;
    }
    try {
      const home = arrivalHome(deps.valley, item.recipe, item.id, eye, forward);
      await deps.list.setHome(item.id, home);
      out.push({ ...item, valley: { ...item.valley, home } });
    } catch (e) {
      console.error(`release: no home for ${item.id} this time (it stays out of the valley until the next load)`, e);
      out.push(item); // the others still come
    }
  }
  return out;
}
