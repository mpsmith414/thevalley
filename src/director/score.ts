import { HIGH, MEDIUM } from '../sim/types';
import type { Pt } from '../sim/types';
import type { Vec3 } from '../util/vec';
import type { Story, StoryTag } from './types';

/** A story from the released creatures scores this much more than an otherwise equal one: a gentle nudge. */
export const RELEASED_NUDGE = 1.25;
/** An invitation is never offered for something closer to the camera than this, in metres (it is already in view). */
export const INVITE_NEAR_M = 80;
/** The stories worth filming at night: the chorus, the raft, the hunts, sleeping families and the vistas. */
export const NIGHT_TAGS: StoryTag[] = ['chorus', 'raft', 'stalk', 'chase', 'dive', 'catch', 'escape', 'sleeping', 'vista'];

/** A story fades toward `1 - FRESH_FADE` of its interest as it ages, with this time constant in real seconds. */
const FRESH_S = 90, FRESH_FADE = 0.5;
/** Progress: a story still going on, a hunt's lead-in (the creep) on top of that, and one that is over. */
const LIVE = 1.5, LEAD_IN = 1.3, OVER = 0.6;
/** What each repeat of the last scene's species, kind of scene and place does to a score. */
const SAME_SPECIES = 0.6, SAME_TAG = 0.7, SAME_PLACE = 0.8;
/** The distance term divides a score by `1 + metres / FAR_M`: gentle, so a far great story still beats a near dull one. */
const FAR_M = 400;
/** The size of a coarse place, in metres. */
const PLACE_M = 200;

/** What the Director remembers when scoring: the clock, the camera, whether it is night, and the last few scenes. */
export type ScoreCtx = { now: number; camera: Vec3; night: boolean; recent: { species: string[]; tags: StoryTag[]; places: string[] } };

/** A coarse place key (a 200 m square of the valley), so scoring and the planner name places the same way. */
export const placeOf = (at: Pt): string => `${Math.floor(at.x / PLACE_M)},${Math.floor(at.z / PLACE_M)}`;

const metres = (at: Pt, camera: Vec3) => Math.hypot(at.x - camera.x, at.z - camera.z);

/** How far along a story is: a live one beats a finished one, and a hunt's creep is the best lead-in there is. */
function progress(s: Story): number {
  if (!s.live) return OVER;
  return s.hunt?.beat === 'creep' ? LEAD_IN * LIVE : LIVE;
}

/**
 * How much the Director wants to film a story now: interest, freshness, progress and variety, divided by a gentle
 * distance term and nudged last for released creatures. At night anything that is not night-worthy scores 0.
 */
export function scoreStory(s: Story, c: ScoreCtx): number {
  if (c.night && !NIGHT_TAGS.includes(s.tag)) return 0;
  const fresh = 1 - FRESH_FADE + FRESH_FADE * Math.exp(-Math.max(0, c.now - s.born) / FRESH_S);
  let variety = 1;
  if (s.species.some(sp => c.recent.species.includes(sp))) variety *= SAME_SPECIES;
  if (c.recent.tags.includes(s.tag)) variety *= SAME_TAG;
  if (c.recent.places.includes(placeOf(s.at))) variety *= SAME_PLACE;
  const near = 1 + metres(s.at, c.camera) / FAR_M;
  return (s.interest * fresh * progress(s) * variety / near) * (s.released ? RELEASED_NUDGE : 1);
}

const best = (stories: readonly Story[], c: ScoreCtx): Story | null => {
  let top: Story | null = null, topScore = -Infinity;
  for (const s of stories) { const v = scoreStory(s, c); if (v > topScore) { top = s; topScore = v; } }
  return top;
};

/**
 * What to film next: the best live story. When none is worth it (nothing live, or all are asleep at night) it is a
 * vista, then anything at all; only an empty list gives nothing.
 */
export function pickScene(stories: readonly Story[], c: ScoreCtx): Story | null {
  const live = stories.filter(s => s.live && scoreStory(s, c) > 0);
  const day = { ...c, night: false };
  return best(live, c) ?? best(stories.filter(s => s.tag === 'vista'), day) ?? best(stories, day);
}

/**
 * What to offer a viewer to jump to: a live medium-or-better event, not one already offered, and not close to the camera
 * (it is in view already). Highs come first, then the best score.
 */
export function pickInvite(stories: readonly Story[], c: ScoreCtx & { offered: ReadonlySet<string> }): Story | null {
  const ok = stories.filter(s => s.kind === 'event' && s.live && s.interest >= MEDIUM && !c.offered.has(s.id) && metres(s.at, c.camera) >= INVITE_NEAR_M);
  return best(ok.filter(s => s.interest >= HIGH), c) ?? best(ok, c);
}
