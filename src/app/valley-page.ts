/**
 * The menu's Valley page in the running valley: start again (clear the save, reload), back up (to a file) and restore (from
 * a file, reload). It needs the valley's save and the creature list.
 */
import { h } from '../shared/dom';
import { backupName, makeBackup, restoreBackup, type ValleySaves } from '../sim/save';
import type { CreatureList } from '../creatures/list';
import { toast } from './loading';
import type { ValleyPage } from './menu';

/** What the page needs: the screen, the save and the list, a way to save the valley as it is now, and the autosave's switch. */
export type ValleyPageDeps = {
  ui: HTMLElement;
  saves: ValleySaves;
  list: CreatureList;
  /** Save the valley as it is now (nothing to save without a simulation). */
  save(): Promise<unknown>;
  /** Off while the valley is being started again or a backup restored: the page reloads next, and must not write the old state back. */
  saving(on: boolean): void;
};

/** The Valley page (see the file's note). */
export const valleyPage = ({ ui, saves, list, save, saving }: ValleyPageDeps): ValleyPage => ({
  startAgain: () => {
    saving(false);
    saves.clear().then(() => location.reload(), (e) => {
      console.error('the valley could not start again', e);
      saving(true);
      toast(ui, 'The valley could not start again.', 3000);
    });
  },
  backUp: () => {
    // what is saved is up to a minute old: save the valley as it is now, then back that up
    save().then(() => makeBackup(saves, list)).then((blob) => {
      const link = h('a', { href: URL.createObjectURL(blob), download: backupName(new Date()) });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      toast(ui, 'Backup saved to your downloads 💾');
    }, (e) => {
      console.error('the valley could not be backed up', e);
      toast(ui, 'The valley could not be backed up.', 3000);
    });
  },
  restore: (file) => {
    saving(false); // the restored save is what the reload must find
    restoreBackup(file, saves, list).then(() => location.reload(), (e) => {
      console.error('the backup could not be restored', e);
      saving(true);
      toast(ui, 'That file is not a valley backup.', 3000);
    });
  },
});
