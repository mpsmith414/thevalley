/**
 * Invitations, in free flight: the best moments elsewhere in the valley offered as a card in the bottom-left corner (a
 * still picture of the moment from the peek, its line, and "X Go there"). `InviteQueue` decides whose card is up when;
 * `InviteCards` puts it on the screen. It readies the spot with the second eye first (banding only, as the documentary's
 * far cuts do), takes the peek's still only once that is ready, and only then shows the card, so the picture of an
 * unseen herd never costs a long frame (Ruling R12).
 */
import type { PeekRect } from '../render/peek';
import { HIGH, MEDIUM, type Pt } from '../sim/types';
import type { Vec3 } from '../util/vec';
import type { Pose } from '../views/types';
import { INVITE_NEAR_M } from './score';
import { CAMERA_FOV, framingDistance, lookAt } from './shots';
import type { Story } from './types';
import { AIM, findVantage, type VantageWorld } from './vantage';

/** At most one card every 40 s (real s, start to start), each shown up to 12 s; a story waits at most 30 s for its turn. */
export const INVITE_GAP_S = 40, INVITE_SHOW_S = 12, INVITE_STALE_S = 30;
/** The card and its picture fade in and out over this long (s): valley.css's `.invite` transition. */
export const CARD_FADE_S = 0.6;
/** At most this many stories wait their turn. */
const QUEUED = 3;
/** A story whose card has been up is not offered again for this long (real s): a hunt is one card, not one a stage. */
const SHOWN_KEEP_S = 600;
/**
 * How much of the still's height its subject fills, and the nearest and farthest (m) the peek's camera stands from it:
 * nearer than the fill would ask for a small animal, the still narrows its field of view instead (`stillFov`).
 */
const PEEK_FILL = 0.3, PEEK_NEAR_M = 8, PEEK_FAR_M = 60;
/** The narrowest field of view (degrees) a still is taken with: a frog from 10 m. */
const STILL_MIN_FOV = 3;
/** The card readies the spot's drawing (animals one frame, plants the next) this far (s) into its warm (Ruling R14). */
const PRIME_AT_S = 0.75;
/** How big (m) a spot with no animal in it is framed as. */
const SPOT_M = 4;
/** The peek's camera keeps at least this far (m) above the ground or water when it is carried along with its animal. */
const CLEAR_M = 1.5;
/** A spot bigger than this (m) is still aimed at as if it were this big: a hunt's spread is framed, but looked at near the ground. */
const AIM_SIZE_M = 2;
/** A hunter and its prey are framed together only while within this many of the hunter's lengths of each other (each then fills 0.1 or more). */
const PAIR_LENGTHS = 3;

/** Worth a card: going on, of medium interest or more, and not a catch (a catch is never on screen). */
const fit = (s: Story) => s.live && s.interest >= MEDIUM && s.tag !== 'catch';

/**
 * Which story's card is up when: one at a time for `show` seconds, at least `gap` seconds from one's start to the next's,
 * high ones first, at most three waiting (the oldest of the least interesting dropped), each waiting at most `stale`
 * seconds. Never one the camera already sees (within 80 m), a catch, or one no longer going on; a card ends early when
 * any of those becomes true. Times are real seconds.
 */
export class InviteQueue {
  private waiting: { s: Story; at: number }[] = [];
  private shown: { s: Story; since: number; forced: boolean } | null = null;
  private lastStart = -Infinity;
  /** The stories whose cards have been up, and when. */
  private done = new Map<string, number>();
  private readonly gap: number;
  private readonly show: number;
  private readonly stale: number;

  constructor(o: { gap?: number; show?: number; stale?: number } = {}) {
    this.gap = o.gap ?? INVITE_GAP_S;
    this.show = o.show ?? INVITE_SHOW_S;
    this.stale = o.stale ?? INVITE_STALE_S;
  }

  /** A story to invite to, as its moment happens: a high one goes ahead of the rest; one already waiting is freshened in its place. */
  offer(s: Story, now: number): void {
    if (!fit(s) || this.shown?.s.id === s.id || this.done.has(s.id)) return;
    const was = this.waiting.findIndex((w) => w.s.id === s.id);
    if (was >= 0) return void (this.waiting[was].at = now);
    const item = { s, at: now };
    if (s.interest >= HIGH) {
      const first = this.waiting.findIndex((w) => w.s.interest < HIGH); // after the high ones already waiting
      this.waiting.splice(first < 0 ? this.waiting.length : first, 0, item);
    } else this.waiting.push(item);
    if (this.waiting.length > QUEUED) {
      const least = Math.min(...this.waiting.map((w) => w.s.interest));
      this.waiting.splice(this.waiting.findIndex((w) => w.s.interest === least), 1);
    }
  }

  /**
   * The story whose card is up now (null: none). `seen(at)`: the camera already sees that point. While `blocked` the card
   * up is ended for good and nothing new starts.
   */
  update(now: number, blocked: boolean, seen: (at: Pt) => boolean): Story | null {
    for (const [id, t] of this.done) if (now - t > SHOWN_KEEP_S) this.done.delete(id);
    this.waiting = this.waiting.filter((w) => now - w.at <= this.stale && fit(w.s) && !seen(w.s.at));
    const c = this.shown;
    if (c && (blocked || now - c.since >= this.show || !fit(c.s) || (!c.forced && seen(c.s.at)))) this.shown = null;
    if (!blocked && !this.shown && this.waiting.length && now - this.lastStart >= this.gap) this.start(this.waiting.shift()!.s, now, false);
    return this.shown?.s ?? null;
  }

  /** A card for `s` now, whatever the gap and wherever the camera is (the dev hook). */
  showNow(s: Story, now: number): void {
    this.waiting = this.waiting.filter((w) => w.s.id !== s.id);
    this.start(s, now, true);
  }

  /** The card up is over early (Go there was pressed, or the documentary began). */
  end(): void {
    this.shown = null;
  }

  /** The story whose card is up. */
  get showing(): Story | null {
    return this.shown?.s ?? null;
  }

  private start(s: Story, now: number, forced: boolean): void {
    this.shown = { s, since: now, forced };
    this.lastStart = now;
    this.done.set(s.id, now);
  }
}

/** An animal as the card frames it: where it is and how big (m). */
export type Framed = { pos: Vec3; size: number };

/**
 * Where a story is to be seen now and how big a spot to frame: its animal, or the middle of a hunter and its prey (big
 * enough to show both) while they are within three of the hunter's lengths of each other (else the hunter), or the
 * story's point on the ground when its animal has gone.
 */
export function storySpot(s: Story, animal: (id: string) => Framed | null, ground: (x: number, z: number) => number): Framed {
  const a = s.subject !== null ? animal(s.subject) : null;
  if (!a) return { pos: { x: s.at.x, y: ground(s.at.x, s.at.z), z: s.at.z }, size: SPOT_M };
  const b = s.hunt?.prey ? animal(s.hunt.prey) : null;
  const apart = b ? Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) : Infinity;
  if (!b || apart > PAIR_LENGTHS * a.size) return { pos: { ...a.pos }, size: a.size };
  const pos = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2, z: (a.pos.z + b.pos.z) / 2 };
  return { pos, size: Math.max(a.size, b.size, apart) };
}

/**
 * A good place for the peek (or a pre-warm) to look at `subject` from: a vantage as far off as lets it fill 0.3 of the
 * picture's height with the valley camera's lens (8–60 m), a little above it, the sun behind the camera when it can be;
 * looking at it near the ground however big the spot (AIM_SIZE_M).
 */
export function peekVantage(subject: Framed, world: VantageWorld, o: { sun?: Vec3; rng: () => number }): Pose {
  const d = Math.min(PEEK_FAR_M, Math.max(PEEK_NEAR_M, framingDistance(subject.size, PEEK_FILL, CAMERA_FOV)));
  const aimed = { pos: subject.pos, size: Math.min(subject.size, AIM_SIZE_M) }, aimUp = aimed.size * AIM;
  return findVantage(aimed, world, { dist: [d * 0.9, d * 1.2], up: [aimUp + d * 0.15, aimUp + d * 0.35], sun: o.sun, rng: o.rng });
}

/** Where a still of `spot` looks: near the ground however big the spot (AIM_SIZE_M). */
const aimOf = (spot: Framed): Vec3 => ({ x: spot.pos.x, y: spot.pos.y + Math.min(spot.size, AIM_SIZE_M) * AIM, z: spot.pos.z });

/**
 * The field of view (degrees, vertical) a still from `pose` is taken with, so `spot` fills 0.3 of its height however far
 * the vantage had to stand: a long lens for a small animal, never wider than the valley camera's (nor narrower than 3°).
 */
export function stillFov(pose: Pose, spot: Framed): number {
  const a = aimOf(spot), d = Math.hypot(a.x - pose.pos.x, a.y - pose.pos.y, a.z - pose.pos.z);
  const fov = (2 * Math.atan(spot.size / (2 * PEEK_FILL * Math.max(d, 1e-3))) * 180) / Math.PI;
  return Math.min(CAMERA_FOV, Math.max(STILL_MIN_FOV, fov));
}

/** The warmed pose `p` carried along with its subject, which moved from `from` to `to` meanwhile: still looking at it, above the ground. */
function carried(p: Pose, from: Vec3, to: Vec3, size: number, ground: (x: number, z: number) => number): Pose {
  const x = p.pos.x + to.x - from.x, z = p.pos.z + to.z - from.z;
  const y = Math.max(p.pos.y + to.y - from.y, ground(x, z) + CLEAR_M);
  return lookAt({ x, y, z }, aimOf({ pos: to, size }));
}

/**
 * A spot being readied by the second eye: `pose` is where the eye is; `ready` once it has had time; `done` lets it go.
 * `prime(part)` draws what the eye sees once, unseen (0: the animals, 1: the plants), so the still's frame meets them
 * already uploaded (Ruling R14).
 */
export type Warm = { ready(): boolean; done(): void; readonly pose: Pose; prime?(part: 0 | 1): void };

/** What the cards work with. */
export type InviteDeps = {
  queue: InviteQueue;
  /** The peek: open on a pose, closed, faded (0–1, with the card), and whether its picture (the still) has been drawn. */
  peek: { open(pose: Pose, fov: number): void; close(): void; fade(a: number): void; readonly drawn: boolean };
  /** Ready the spot round `at`, framed for something `size` m across, with the second eye (see `createDirector`'s `prewarm`). */
  prewarm(at: Vec3, size: number): Warm;
  /** An animal where it is now (null: gone). */
  animal(id: string): Framed | null;
  /** The height of the ground or water. */
  ground(x: number, z: number): number;
  camera(): Vec3;
  card: { show(s: Story | null, line: string, hint: string, rect: PeekRect): void };
  /** Where the peek's picture is on the screen now. */
  rect(): PeekRect;
  /** The card's words for a story (its latest moment's line). */
  line(s: Story): string;
  /** "X Go there" or "F Go there". */
  hint(): string;
  /** The documentary is running (it never is while a card holds the second eye: the cards are free flight's). */
  documentary(): boolean;
};

/**
 * The invitation cards on the screen, one frame at a time. A story the queue puts up is warmed first (the second eye on
 * its spot), then the peek opens there and takes its still (the warm holds the spot until it is taken), then the card
 * shows, fading in with its picture. Midway through the warm the spot is drawn once, unseen (the animals one frame, the
 * plants the next), so the still's frame has less to upload (Ruling R14). The card goes when the queue says, or at once on `close`; its picture fades out after it,
 * then the peek closes. If the queue drops the story before the card shows (stale, seen, the player moved on), nothing
 * is shown.
 */
export class InviteCards {
  private cur: { s: Story; stage: 'warming' | 'picture' | 'shown'; warm: Warm | null; from: Vec3; size: number; since: number; primed: 0 | 1 | 2 } | null = null;
  /** The peek is open (its picture up, or fading out), and how much of the picture shows. */
  private open = false;
  private strength = 0;

  constructor(private readonly d: InviteDeps) {}

  /** The story whose card is on the screen (null: none, or not yet). Go there goes to it. */
  get story(): Story | null {
    return this.cur?.stage === 'shown' ? this.cur.s : null;
  }

  /** One frame of `dt` real seconds at `now`: while `blocked` (not free flight, something else on the screen, switched off) no card. */
  frame(now: number, dt: number, blocked: boolean): void {
    const { d } = this, cam = d.camera();
    const s = d.queue.update(now, blocked, (at) => Math.hypot(at.x - cam.x, at.z - cam.z) < INVITE_NEAR_M);
    if (s !== (this.cur?.s ?? null)) {
      this.drop();
      if (s) this.begin(s, now);
    }
    const c = this.cur;
    if (c?.stage === 'warming' && c.primed < 2 && now - c.since >= PRIME_AT_S) c.warm!.prime?.(c.primed++ as 0 | 1);
    else if (c?.stage === 'warming' && c.warm!.ready()) {
      const to = storySpot(c.s, d.animal, d.ground), pose = carried(c.warm!.pose, c.from, to.pos, c.size, d.ground);
      d.peek.open(pose, stillFov(pose, to));
      c.stage = 'picture';
      this.open = true;
      this.strength = 0;
    }
    if (c?.stage === 'picture' && d.peek.drawn) {
      // the still is taken: the warm lets the spot go only now, so the plants (banded for the warm's eye, at the same
      // place) are not banded afresh for the peek's camera just for its one picture
      c.warm!.done();
      c.warm = null;
      c.stage = 'shown';
    }
    if (c?.stage === 'shown') d.card.show(c.s, d.line(c.s), d.hint(), d.rect());
    if (!this.open) return;
    const step = dt / CARD_FADE_S;
    this.strength = c?.stage === 'shown' ? Math.min(1, this.strength + step) : Math.max(0, this.strength - step);
    d.peek.fade(this.strength);
    if (!c && this.strength === 0) {
      d.peek.close();
      this.open = false;
    }
  }

  /**
   * Go there: the card goes now (its picture fades out after it); or the documentary beginning (`atOnce`): the picture
   * goes too, so it never shows over the documentary's opening.
   */
  close(atOnce = false): void {
    this.d.queue.end();
    this.drop();
    if (atOnce && this.open) (this.d.peek.close(), (this.open = false), (this.strength = 0));
  }

  private begin(s: Story, now: number): void {
    const { d } = this;
    console.assert(!d.documentary(), 'the invitation card and the documentary never hold the second eye together');
    if (this.open) (d.peek.close(), (this.open = false)); // the last card's picture, still fading
    const spot = storySpot(s, d.animal, d.ground);
    this.cur = { s, stage: 'warming', warm: d.prewarm(spot.pos, spot.size), from: spot.pos, size: spot.size, since: now, primed: 0 };
  }

  /** The card's story is over: its warm let go, a picture not yet shown closed at once, a card on the screen faded out. */
  private drop(): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.warm?.done();
    if (c.stage === 'picture') (this.d.peek.close(), (this.open = false));
    if (c.stage === 'shown') this.d.card.show(null, '', '', this.d.rect());
  }
}
