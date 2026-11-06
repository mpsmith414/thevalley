import { LOW, MEDIUM } from '../sim/types';
import type { Moment, MomentKind, Pt } from '../sim/types';
import type { AgentView, DirectorWorld, HuntBeat, Story, StoryTag } from './types';

/** The sweep of the animals' live state runs at most this often, in real seconds. */
const SWEEP_EVERY_S = 2;
/** A story that is no longer live is dropped once it is this old, in real seconds. */
const KEEP_S = 120;
/** A catch or an escape is still worth showing for this many real seconds. */
const ENDING_S = 20;
/** An event with no activity of its own to watch stays live this many real seconds from its moment. */
const EVENT_S = 30;
/** A flier is soaring (worth a calm scene) above this height, in metres. */
const SOARING_ABOVE = 10;
/** Interest of the check-ins (a low moment about the same animals may raise it), of a soaring flier, and of scenery. */
const CHECKIN = LOW, SOARING = 0.25, SCENERY = 0.1;

/** The moments that are stages of one hunt, and the stage each is. */
const BEATS: Partial<Record<MomentKind, HuntBeat>> = { stalk: 'creep', chase: 'chase', dive: 'dive', catch: 'catch', escape: 'escape' };
/** What a hunter is doing while each running stage is still going. */
const HUNTING: Partial<Record<HuntBeat, readonly string[]>> = { creep: ['stalk'], chase: ['chase'], dive: ['dive'] };
/** What the animals of an event are doing while it goes on, for the kinds that have an activity to watch. */
const ACTIVITY: Partial<Record<MomentKind, string>> = { drink: 'drink', chorus: 'call' };

/** Bookkeeping the story itself does not show: when its hunt stage began, and until when an ordinary event stays live. */
type Track = { beatAt: number; until: number };

/**
 * Everything going on that can be filmed. Moments offered by the simulation become event stories (medium interest and
 * up); the sweep of the animals' live state makes the check-ins; the viewpoints make the scenery. Ids are stable, so the
 * same hunt, herd or vista is the same story from one update to the next.
 */
export class StoryBook {
  private stories = new Map<string, Story>();
  private tracks = new Map<string, Track>();
  /** The interest of the latest low moment per lead animal: it feeds the check-in about the same animals. */
  private hints = new Map<string, number>();
  private view: Story[] | null = [];
  private swept = -Infinity;

  /**
   * Takes a moment as it happens: a medium or high one makes (or carries on) an event story, which is returned; a lower
   * one is only noted (null).
   */
  offer(m: Moment, now: number): Story | null {
    if (m.interest < MEDIUM) {
      this.hints.set(m.follow, Math.max(m.interest, this.hints.get(m.follow) ?? 0));
      return null;
    }
    const beat = BEATS[m.kind];
    // an escape is about the prey (`follow` is the prey): it ends the hunt that was after it
    const hunt = m.kind === 'escape' ? this.huntAfter(m.follow) : undefined;
    const id = hunt?.id ?? `${beat && m.kind !== 'escape' ? 'hunt' : m.kind}:${m.follow}`;
    let s = this.stories.get(id);
    if (!s) {
      s = { id, kind: 'event', tag: m.kind, subject: m.follow, actors: [...m.actors], species: [...m.species], at: { ...m.at },
        interest: m.interest, born: now, live: true, released: false, hunt: null };
      this.stories.set(id, s);
      this.tracks.set(id, { beatAt: now, until: now + EVENT_S });
      this.view = null;
    }
    const t = this.tracks.get(id)!;
    s.live = true;
    s.interest = Math.max(s.interest, m.interest);
    t.until = now + EVENT_S;
    if (!beat) return s;
    s.tag = m.kind;
    t.beatAt = now;
    if (hunt) return (s.hunt!.beat = beat), s;
    if (m.kind === 'escape') return s; // nothing was hunting it that we know of: a plain event
    s.actors = [...m.actors];
    // a hunt moment's actors are the hunters and then the prey
    s.hunt = { hunter: m.follow, prey: m.actors.length > 1 ? m.actors[m.actors.length - 1] : s.hunt?.prey ?? null, beat };
    return s;
  }

  /** The hunt story that is after `prey`, a live one first. */
  private huntAfter(prey: string): Story | undefined {
    let found: Story | undefined;
    for (const s of this.stories.values()) if (s.hunt?.prey === prey && (!found || s.live)) found = s;
    return found;
  }

  /** Brings every story up to date with the animals: who is still at it, where, and (every so often) the check-ins. */
  update(w: DirectorWorld): void {
    for (const s of this.stories.values()) if (s.kind === 'event') this.follow(s, w);
    if (w.now - this.swept >= SWEEP_EVERY_S) {
      this.swept = w.now;
      this.sweep(w);
    }
    this.scenery(w);
    for (const s of [...this.stories.values()]) {
      if (s.live || w.now - s.born <= KEEP_S) continue;
      this.stories.delete(s.id);
      this.tracks.delete(s.id);
      this.view = null;
    }
  }

  /** The stories, live or not, oldest first. */
  list(): readonly Story[] {
    return (this.view ??= [...this.stories.values()]);
  }

  /** The story with this id, if it is still kept. */
  get(id: string): Story | undefined {
    return this.stories.get(id);
  }

  /** An event: who is still there, where, and whether what they were doing goes on. */
  private follow(s: Story, w: DirectorWorld): void {
    const t = this.tracks.get(s.id)!, h = s.hunt, hunter = h && w.agent(h.hunter);
    const here = s.actors.map((id) => w.agent(id)).filter((a): a is AgentView => !!a);
    s.released = here.some((a) => a.released);
    if (h) {
      if (!hunter) return void (s.live = false);
      if (hunter.focus) h.prey = hunter.focus;
      if (h.beat === 'creep' && hunter.doing === 'chase') {
        h.beat = 'chase';
        s.tag = 'chase';
        t.beatAt = w.now;
      }
      s.at = { x: hunter.pos.x, z: hunter.pos.z };
      const doing = HUNTING[h.beat];
      s.live = doing ? doing.includes(hunter.doing) : w.now - t.beatAt < ENDING_S;
      return;
    }
    if (!here.length) return void (s.live = false);
    s.at = centre(here);
    const activity = ACTIVITY[s.tag as MomentKind];
    s.live = activity ? here.some((a) => a.doing === activity) : w.now < t.until;
  }

  /** The check-ins: the most photogenic thing each group (or lone animal) is doing right now. */
  private sweep(w: DirectorWorld): void {
    const clusters = new Map<string, AgentView[]>();
    for (const a of w.agents()) {
      const key = a.group ?? a.id, c = clusters.get(key);
      if (c) c.push(a);
      else clusters.set(key, [a]);
    }
    const seen = new Set<string>();
    for (const [key, members] of clusters) {
      const tag = checkIn(members);
      if (!tag) continue;
      const id = `${tag}:${key}`, actors = members.map((a) => a.id);
      const fresh = { actors, species: [...new Set(members.map((a) => a.species))], at: centre(members), live: true,
        released: members.some((a) => a.released),
        interest: Math.max(tag === 'soaring' ? SOARING : CHECKIN, ...actors.map((a) => this.hints.get(a) ?? 0)) };
      const s = this.stories.get(id);
      if (s) Object.assign(s, fresh);
      else {
        this.stories.set(id, { id, kind: 'checkin', tag, subject: actors[0], born: w.now, hunt: null, ...fresh });
        this.view = null;
      }
      seen.add(id);
    }
    for (const s of this.stories.values()) if (s.kind === 'checkin' && !seen.has(s.id)) s.live = false;
  }

  /** One scenery story per viewpoint, always there. */
  private scenery(w: DirectorWorld): void {
    for (const v of w.viewpoints) {
      const id = `vista:${v.name}`;
      if (this.stories.has(id)) continue;
      this.stories.set(id, { id, kind: 'scenery', tag: 'vista', subject: null, actors: [], species: [], at: { x: v.pos.x, z: v.pos.z },
        interest: SCENERY, born: w.now, live: true, released: false, hunt: null, viewpoint: v });
      this.view = null;
    }
  }
}

/** What calm thing a group is doing that is worth a scene, if any: soaring, sleeping, on the water, or a herd grazing. */
function checkIn(members: readonly AgentView[]): StoryTag | null {
  const half = members.length / 2, count = (f: (a: AgentView) => boolean) => members.filter(f).length;
  if (members.some((a) => a.flying && a.altitude > SOARING_ABOVE)) return 'soaring';
  if (count((a) => a.doing === 'sleep') >= half) return 'sleeping';
  if (count((a) => a.swimmer && a.wet && !a.flying) >= half) return 'water';
  if (members.length > 1 && count((a) => a.doing === 'graze') >= half) return 'herd';
  return null;
}

/** The middle of some animals. */
function centre(as: readonly AgentView[]): Pt {
  let x = 0, z = 0;
  for (const a of as) (x += a.pos.x), (z += a.pos.z);
  return { x: x / as.length, z: z / as.length };
}
