/**
 * The simulation's good moments on the screen. In free flight they are invitations: a card in the bottom-left corner
 * with a still picture of the moment, its line and "X Go there" (see src/director/invite.ts). While watching an animal,
 * steering it or on the map, they are today's quiet caption line, one at a time (X is the Sense button there). It
 * listens to the moments and the Director's stories, keeps both queues, and each frame shows what is up (or nothing
 * while something else has the screen). The menu's Moment invitations switch covers both.
 */
import { InviteCards, InviteQueue, type InviteDeps } from '../director/invite';
import { inviteCard } from '../director/invite-ui';
import type { Story } from '../director/types';
import { remember, stored } from '../shared/settings';
import type { Moment } from '../sim/types';
import { CaptionQueue, captionView } from './captions';

/** What the moments need: the screen, the simulation's moments, whether the camera is in free flight, and the cards' world. */
export type MomentsUiDeps = {
  ui: HTMLElement;
  /** The simulation's moments (none: the valley has no simulation, so no captions). */
  moments?: { on(listener: (m: Moment) => void): unknown };
  /** Free flight: the cards show instead of the captions. */
  free(): boolean;
  /** What the cards work with, and the Director's stories as their moments happen (none: no cards). */
  invites?: Omit<InviteDeps, 'queue' | 'card' | 'line'> & { stories: { on(listener: (s: Story, m: Moment) => void): unknown } };
};

/** The moments on the screen (see the file's note). */
export function createMomentsUi(d: MomentsUiDeps) {
  let on = stored<unknown>('valley.captions', 'on') !== 'off';
  const queue = new CaptionQueue(), caption = captionView(d.ui);
  let realTime = 0; // real seconds the valley has run (the drive's dt, so `step` moves it too)
  d.moments?.on((m) => queue.offer(m, realTime));
  /** Each story's line: its latest moment's words. */
  const lines = new Map<string, string>();
  const invites = new InviteQueue();
  const cards = d.invites && new InviteCards({ ...d.invites, queue: invites, card: inviteCard(d.ui), line: (s) => lines.get(s.id) ?? '' });
  d.invites?.stories.on((s, m) => {
    lines.set(s.id, m.text);
    invites.offer(s, realTime);
  });
  return {
    /** The invitations setting: `set` also keeps it for next time; `switchTo` only switches (the caller has saved it). */
    captions: { get: () => on, set: (v: boolean) => ((on = v), remember('valley.captions', v ? 'on' : 'off')), switchTo: (v: boolean) => void (on = v) },
    /** The caption showing now (watching an animal), or null. */
    get showing(): Moment | null {
      return queue.showing;
    },
    /** The story whose invitation card is on the screen now (free flight), or null: Go there goes to it. */
    get invitation(): Story | null {
      return cards?.story ?? null;
    },
    /** The card goes now (Go there pressed: its picture fades out after it; the documentary beginning, `atOnce`: with it). */
    closeCard: (atOnce = false) => cards?.close(atOnce),
    /** A card for `s` with `line` now, whatever the wait (the dev hook). */
    show(s: Story, line: string) {
      lines.set(s.id, line);
      invites.showNow(s, realTime);
    },
    /**
     * One frame of `dt` real seconds: the cards in free flight, the captions otherwise; both wait (`away`) while something
     * else has the screen, and when they are off.
     */
    frame(dt: number, away: boolean) {
      realTime += dt;
      const free = d.free();
      caption.show(queue.update(realTime, !on || away || free), '');
      cards?.frame(realTime, dt, !on || away || !free);
    },
  };
}
/** The moments' wiring (see `createMomentsUi`). */
export type MomentsUi = ReturnType<typeof createMomentsUi>;
