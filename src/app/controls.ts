/**
 * The player's controls in the valley: the controller's presses and the keyboard and mouse, sent to the menu, the views, the
 * viewpoints, the clock and Go there (an invitation card's). Free flight's own movement is the camera's (see `camera-drive.ts`); this is what the
 * buttons and keys mean. LB (free flight) and P start the documentary; while it runs, any press, key or click takes over
 * and is used up doing it (A locks on to its animal; Start and the menu key open the menu over it).
 */
import { remember } from '../shared/settings';
import type { ValleyClock } from '../world/clock';
import type { Input } from '../shared/input';
import type { Residents } from '../residents/residents';
import { visitView } from '../bring/release';
import { REINS_CLOCK_NOTE } from '../views/hud';
import { keyAction, viewAction } from '../views/keys';
import type { Views } from '../views/views';
import type { ViewsWire } from '../views/wire';
import type { Director } from '../director/wire';
import type { CameraDrive } from './camera-drive';
import type { MenuControl } from './menu-control';
import { SPEEDS, speedId } from './menu';
import { setSpeed } from './menu-control';
import { toast } from './loading';
import type { MomentsUi } from './moments-ui';
import { stepSpeed, type ReleaseTimeHold } from './time';

/** What the controls act on: the camera, the views, the menu, the clock, the invitation cards, and the state of the screen. */
export type ControlsDeps = {
  ui: HTMLElement;
  canvas: HTMLCanvasElement;
  input: Input;
  clock: ValleyClock;
  timeHold: ReleaseTimeHold;
  residents: Residents;
  viewer: Views;
  wire: ViewsWire;
  cam: CameraDrive;
  menu: MenuControl;
  moments: MomentsUi;
  director: Director;
  /** The start screen is still up: the controls wait for it. */
  waiting(): boolean;
  /** The workshop has the screen (and so the controls). */
  workshop(): boolean;
  /** Back/Escape while the workshop shows. */
  back(): void;
  /** The sound is on (after M toggles it): for the toast. */
  muted(): boolean;
};

/** The controls (see the file's note): hooks the controller, keyboard and mouse up, and returns the actions they share. */
export function createControls(d: ControlsDeps) {
  const { ui, canvas, input, clock, timeHold, residents, viewer, wire, cam, menu, moments, director } = d;
  /**
   * The clock a step faster or slower (d-pad up/down, `]` `[`): kept for next time, with its name and note shown. While the
   * player steers it holds at Normal, and says so.
   */
  const stepClock = (dir: 1 | -1) => {
    if (viewer.state.reins) return void toast(ui, REINS_CLOCK_NOTE, 2000);
    const id = stepSpeed(speedId(clock.speed, clock.paused), dir), s = SPEEDS.find((x) => x.id === id)!;
    timeHold.playerChanged();
    setSpeed(clock, id);
    remember('valley.speed', id);
    toast(ui, `${s.label} · ${s.note}`, 1600);
  };
  /**
   * Go there (free flight, with an invitation card up): glide to the card's animal (or where its story is, if it has
   * gone), then lock on to it. The card closes as the glide begins.
   */
  const flyThere = () => {
    const s = moments.invitation;
    if (!s || viewer.state.mode !== 'free') return;
    const id = s.subject, a = id !== null ? residents.animal(id) : null, eye = { x: cam.fly.pos.x, z: cam.fly.pos.z };
    const to = a ? visitView(a.rig.position, a.rig.altitude, a.home, eye)
      : visitView(s.at, 0, { species: '', count: 0, center: s.at, radius: 0, medium: 'land', prefer: [] }, eye);
    moments.closeCard();
    cam.flyTo(to, (arrived) => void (arrived && a && id !== null && viewer.lock(id)));
  };
  /** What the views do with a press (or a key): nothing while the arrival has the camera; the map ends a glide. */
  const viewsDo = (act: ReturnType<typeof viewAction>) => {
    if (!act || cam.arrival.active) return false;
    if (act === 'map') cam.endGlide();
    wire.act(act);
    return true;
  };
  input.onPress = (b, repeat) => {
    if (d.waiting()) return; // the start screen comes first
    if (d.workshop()) return void (b === 'b' && !repeat && d.back()); // the workshop has the controls
    if (menu.press(b, repeat) || repeat) return; // a held arrow key must not restart the glide
    if (director.press(b, input.using === 'keys')) return; // it took over: the press is used up
    // LB (the controller's, in free flight) starts the documentary; the keyboard's `[` sends LB too, and is a time step
    if (b === 'lb' && input.using === 'pad' && viewer.state.mode === 'free' && !cam.arrival.active) return director.start();
    wire.poke();
    // `[` and `]` send the bumpers too (Input's keys): they are the time steps (below), so they never step to a neighbour
    if (viewsDo(viewAction(b, viewer.state.mode, wire.highlighted !== null, input.using === 'keys'))) return;
    if (b === 'up' || b === 'down') return stepClock(b === 'up' ? 1 : -1);
    if (b === 'x') return flyThere();
    if (b === 'left') cam.neighbour(-1); // the previous viewpoint
    else if (b === 'right') cam.neighbour(1);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat || d.waiting()) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    // the documentary took it over (or its button did): used up (a browser shortcut still works)
    if (!menu.open && !d.workshop() && director.other()) return void (mod || e.preventDefault());
    if (mod) return;
    if (e.key === 'p' || e.key === 'P') {
      if (!menu.open && !d.workshop() && viewer.state.mode === 'free' && !cam.arrival.active) director.start();
    } else if (/^[1-8]$/.test(e.key)) {
      if (!menu.open && !d.workshop()) cam.goTo(+e.key);
    } else if (e.key === ']' || e.key === '[') {
      if (!menu.open && !d.workshop()) stepClock(e.key === ']' ? 1 : -1);
    } else if (e.key === 'f' || e.key === 'F') {
      if (!menu.open && !d.workshop()) flyThere();
    } else if (e.key === 'm' || e.key === 'M') {
      menu.toggleMute();
      toast(ui, d.muted() ? 'Sound off' : 'Sound on', 1200);
    } else if (!menu.open && !d.workshop()) {
      const act = keyAction(e.key, viewer.state.mode);
      if (act) wire.poke();
      if (viewsDo(act)) e.preventDefault(); // Tab must not move the focus
    }
  });
  // a click captures the mouse; with it captured, a click on a highlighted animal in free flight locks on (as A does), and
  // nothing else (a click is not A while watching: it would take the reins); on the map (its mouse free) a click chooses
  canvas.addEventListener('click', () => {
    // a click in the documentary takes over (and captures the mouse, as the first click does), and does nothing else
    const used = !d.waiting() && !menu.open && !d.workshop() && director.other();
    if (used && document.pointerLockElement !== canvas) return void (canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {});
    if (used) return;
    if (!d.waiting() && !menu.open && !d.workshop() && viewer.state.mode === 'map') return void viewsDo('choose');
    if (document.pointerLockElement !== canvas) return void (canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {});
    if (!d.waiting() && !menu.open && !d.workshop() && viewer.state.mode === 'free') viewsDo(viewAction('a', 'free', wire.highlighted !== null));
  });

  return { viewsDo, stepClock, flyThere };
}
/** The controls' actions (see `createControls`). */
export type Controls = ReturnType<typeof createControls>;
