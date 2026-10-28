import { openDB, type IDBPDatabase } from 'idb';
import type { CreatureList } from '../creatures/list';
import type { GalleryItem } from '../lab/gallery';
import { Sim } from './sim';
import type { SimState, SimWorld, SpeciesDef } from './types';

/**
 * The save file's format; a file of any other version is set aside, not read. The rule: any change to the saved shape of
 * an `Agent` or the `SimState` bumps this version or adds a migration, so an older save never breaks the valley.
 */
export const SAVE_VERSION = 1;
/** The valley's life as saved: the clock, and the simulation's state (the moments are not kept). */
export type SaveFile = { kind: 'valley-save'; version: number; savedAt: number;
  clock: { hours: number; speed: number; paused: boolean }; sim: SimState };

const STORE = 'save', CURRENT = 'current', SET_ASIDE = 'set-aside';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `v` has the shape of a save this version can load (the agents' insides are the simulation's own). */
function readable(v: unknown): v is SaveFile {
  if (!isObject(v) || v.kind !== 'valley-save' || v.version !== SAVE_VERSION || !isNumber(v.savedAt)) return false;
  const c = v.clock, s = v.sim;
  if (!isObject(c) || !isNumber(c.hours) || !(isNumber(c.speed) && c.speed > 0) || typeof c.paused !== 'boolean') return false;
  return isObject(s) && s.version === 1 && ['seed', 'rng', 't', 'acc', 'nextMoment'].every((k) => isNumber(s[k]))
    && Array.isArray(s.agents) && s.agents.every((a) => isObject(a) && typeof a.id === 'string' && typeof a.species === 'string' && isObject(a.motion))
    && Array.isArray(s.pending) && isObject(s.governor) && isObject(s.nextN) && isObject(s.cooldowns);
}

/** The saved valley, in the browser's IndexedDB (one file, kept under 'current'). */
export class ValleySaves {
  private constructor(private db: IDBPDatabase) {}

  /** Opens (or makes) the database called `name` ('valley-life' by default). */
  static async open(name = 'valley-life'): Promise<ValleySaves> {
    return new ValleySaves(await openDB(name, 1, { upgrade: (d) => void d.createObjectStore(STORE) }));
  }

  /**
   * The saved valley, or null when there is none. A file that cannot be read (another version, the wrong shape) is
   * moved to 'set-aside', with a warning, and null comes back.
   */
  async load(): Promise<SaveFile | null> {
    const raw: unknown = await this.db.get(STORE, CURRENT);
    if (raw === undefined) return null;
    if (readable(raw)) return raw;
    console.warn('the saved valley could not be read; it is set aside and the valley starts afresh');
    const tx = this.db.transaction(STORE, 'readwrite');
    await Promise.all([tx.store.put(raw, SET_ASIDE), tx.store.delete(CURRENT), tx.done]);
    return null;
  }

  /** Keeps `f` as the saved valley, in place of any before. */
  async save(f: SaveFile): Promise<void> {
    await this.db.put(STORE, f, CURRENT);
  }

  /** Forgets the saved valley. */
  async clear(): Promise<void> {
    await this.db.delete(STORE, CURRENT);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * The species a save may load into: animals of species not in `species` are dropped (a family that has gone exploring),
 * and a released family in `species` with no animals and none on the way gets its animals afresh, at spots in its home.
 * Individual numbers stay above every kept animal's, so no id is used twice.
 */
export function reconcile(state: SimState, species: SpeciesDef[], world: SimWorld): SimState {
  const out = structuredClone(state), ids = new Set(species.map((d) => d.id));
  out.agents = out.agents.filter((a) => ids.has(a.species));
  out.pending = out.pending.filter((p) => ids.has(p.species));
  for (const id of Object.keys(out.nextN)) if (!ids.has(id)) delete out.nextN[id];
  for (const a of out.agents) out.nextN[a.species] = Math.max(out.nextN[a.species] ?? 0, a.n + 1);
  if (out.governor.chase && !out.agents.some((a) => a.id === out.governor.chase)) out.governor.chase = null;
  for (const def of species) {
    if (!def.released || out.agents.some((a) => a.species === def.id) || out.pending.some((p) => p.species === def.id)) continue;
    const born = new Sim(world, { seed: out.seed, species: [def] }).state(); // the Sim places a family at spots in its home
    out.agents.push(...born.agents);
    out.nextN[def.id] = born.nextN[def.id];
  }
  return out;
}

/** The valley, backed up to one file: the saved valley (null when there is none yet) and the made creatures that live in it. */
export type ValleyBackup = { kind: 'valley-backup'; version: 1; save: SaveFile | null; items: GalleryItem[] };

/** The name of a backup file made on `day` (local time): valley-backup-YYYY-MM-DD.json. */
export function backupName(day: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `valley-backup-${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}.json`;
}

/** The saved valley and every made creature with a valley record, as one JSON file (a gallery item is plain data: recipe, cards, base64 pictures). */
export async function makeBackup(saves: ValleySaves, list: CreatureList): Promise<Blob> {
  const backup: ValleyBackup = { kind: 'valley-backup', version: 1, save: await saves.load(), items: (await list.all()).filter((i) => !i.native) };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/**
 * Takes a backup back in: its creatures join the gallery (one already there, by id, is kept as it is) and its save replaces the
 * current one (a backup of a valley with no save yet clears it, so the valley starts afresh). Throws `Error('not a valley backup')`,
 * having changed nothing, for any other file or a save this version cannot read. Returns how many creatures were added.
 */
export async function restoreBackup(file: Blob, saves: ValleySaves, list: CreatureList): Promise<{ added: number }> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('not a valley backup');
  }
  if (!isObject(data) || data.kind !== 'valley-backup' || data.version !== 1 || !Array.isArray(data.items) || (data.save !== null && !readable(data.save))) {
    throw new Error('not a valley backup');
  }
  let added = 0;
  for (const item of data.items as GalleryItem[]) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.recipe || (await list.gallery.get(item.id))) continue;
    await list.save({ ...item, native: false });
    added++;
  }
  const save = data.save as SaveFile | null;
  if (save) await saves.save(save);
  else await saves.clear();
  return { added };
}
