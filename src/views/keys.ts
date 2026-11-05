/**
 * What the buttons and keys do for the views (spec section 8): lock on to the highlighted animal, change view, sense,
 * step to the neighbours, take the reins, let go, the map. Pure: the wiring acts on the answer. Everything a button
 * does not mean here (RB Fast, Y walk height, the D-pad, X Fly there in free flight, Start) stays free flight's own.
 */
import type { Button } from '../shared/input';
import type { Mode } from './views';

/** Something the player asked of the views. */
export type ViewAction = 'lock' | 'cycleView' | 'sense' | 'prev' | 'next' | 'reins' | 'do' | 'letGo' | 'map' | 'choose' | 'closeMap';

/**
 * What button `b` asks of the views in `mode` (null: nothing; free flight or the rest of the valley may take it), with
 * `highlighted` whether an animal is highlighted in free flight. `fromKeys` is true for a key's button (Input maps keys to
 * buttons: Enter and Space are A, Backspace is B, X is X): the bumpers the keyboard sends are `[` and `]`, the time steps,
 * so they never step to a neighbour (`,` and `.` do that, see `keyAction`). The open menu takes its presses first.
 */
export function viewAction(b: Button, mode: Mode, highlighted: boolean, fromKeys = false): ViewAction | null {
  if (mode === 'map') return b === 'a' ? 'choose' : b === 'b' || b === 'select' ? 'closeMap' : null;
  if (b === 'select') return 'map';
  if (mode === 'free') return b === 'a' && highlighted ? 'lock' : null;
  if (b === 'x') return 'sense';
  if (b === 'y') return 'cycleView';
  // with the reins A is Do, B hands them back and RB is run
  if (mode === 'reins') return b === 'a' ? 'do' : b === 'b' ? 'reins' : null;
  if ((b === 'lb' || b === 'rb') && !fromKeys) return b === 'lb' ? 'prev' : 'next';
  if (b === 'b') return 'letGo';
  return b === 'a' && mode === 'locked' ? 'reins' : null; // gliding there, the reins wait for the arrival
}

/**
 * What a key with no button of its own asks of the views in `mode`: Tab opens the map (and closes it), and while
 * watching an animal V changes view, R takes or hands back the reins and `,` / `.` step to the neighbours (not with the
 * reins). Null for any other key.
 */
export function keyAction(key: string, mode: Mode): ViewAction | null {
  if (key === 'Tab') return mode === 'map' ? 'closeMap' : 'map';
  if (mode === 'free' || mode === 'map') return null;
  const k = key.toLowerCase();
  if (k === 'v') return 'cycleView';
  if (k === 'r') return 'reins';
  if (mode === 'reins') return null;
  return k === ',' ? 'prev' : k === '.' ? 'next' : null;
}
