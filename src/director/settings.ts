/** The documentary's settings as the valley remembers them (localStorage, like the other settings; see `DocSettings`). */
import { remember, stored } from '../shared/settings';
import { DOC_DEFAULTS, type DocSettings } from './wire';

/** Where each setting is kept. The invitations stay on the old captions key, so a family that turned captions off keeps them off. */
const KEYS = { idle: 'valley.docIdle', narrator: 'valley.narrator', timelapses: 'valley.timelapses', invitations: 'valley.captions' } as const;

/** The remembered settings; anything missing or not one of the choices reads as the default. */
export function readDocSettings(): DocSettings {
  const pick = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
    const v = stored<unknown>(key, fallback);
    return choices.includes(v as T) ? (v as T) : fallback;
  };
  return {
    idle: pick(KEYS.idle, ['3', '10', 'off'], DOC_DEFAULTS.idle),
    narrator: pick(KEYS.narrator, ['voice', 'words', 'off'], DOC_DEFAULTS.narrator),
    timelapses: pick(KEYS.timelapses, ['on', 'off'], 'on') === 'on',
    invitations: pick(KEYS.invitations, ['on', 'off'], 'on') === 'on',
  };
}

/** Remember the settings in `s` for next time. */
export function saveDocSettings(s: Partial<DocSettings>) {
  if (s.idle !== undefined) remember(KEYS.idle, s.idle);
  if (s.narrator !== undefined) remember(KEYS.narrator, s.narrator);
  if (s.timelapses !== undefined) remember(KEYS.timelapses, s.timelapses ? 'on' : 'off');
  if (s.invitations !== undefined) remember(KEYS.invitations, s.invitations ? 'on' : 'off');
}
