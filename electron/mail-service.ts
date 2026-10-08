import { app } from 'electron';
import path from 'node:path';
import { MailStoreCore } from './mail-store-core';

/**
 * Thin Electron-aware wrapper around {@link MailStoreCore}.
 *
 * The core stays pure (no `electron` import) so it can be unit tested; the only
 * thing this module adds is resolving `app.getPath('userData')` into the storage
 * root and memoising a singleton for the rest of the main process to share.
 */

let instance: MailStoreCore | null = null;

/** The shared storage core rooted at `<userData>/mail`. */
export function getStore(): MailStoreCore {
  if (!instance) {
    instance = new MailStoreCore(path.join(app.getPath('userData'), 'mail'));
  }
  return instance;
}
