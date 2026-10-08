import { describeImapError, fetchFolder, listFolders } from './imap';
import { ensureFreshCredentials } from './mail-auth';
import { extractCode } from './extractor';
import { sanitizeMailHtml } from './sanitize';
import { buildEnvelope, buildHighlight } from './ingest-core';
import { broadcast } from './events';
import { getStore } from './mail-service';
import * as store from './store';
import type {
  Account,
  AccountSyncResult,
  Envelope,
  Folder,
  SyncResult,
  SyncStatusInfo,
} from '../shared/types';

/**
 * SyncService — the ingestion orchestrator.
 *
 * v2 behaviour: for every enabled account it lists the server folders, then for
 * each *subscribed* folder pulls everything newer than the stored UID cursor and
 * stores it **unconditionally**. The verification-code extractor's result is
 * demoted to highlight metadata; it never gates ingestion, and there is no
 * "only after account creation" baseline any more.
 *
 * Runs one account at a time to avoid hammering a single mailbox with parallel
 * connections.
 */

const FETCH_LIMIT = 500;
const DEFAULT_FOLDERS = ['INBOX'];

let syncing = false;
let lastRun: SyncResult | null = null;

export function isSyncing(): boolean {
  return syncing;
}

export function getLastRun(): SyncResult | null {
  return lastRun;
}

export function getSyncStatus(): SyncStatusInfo {
  return { syncing, lastRun };
}

function subscribedSet(account: Account): Set<string> {
  const paths = account.syncFolders.length > 0 ? account.syncFolders : DEFAULT_FOLDERS;
  return new Set(paths);
}

/** Syncs one account across all of its subscribed folders. */
export async function syncAccount(account: Account): Promise<AccountSyncResult> {
  const empty: AccountSyncResult = {
    accountId: account.id,
    accountName: account.name,
    added: 0,
    folders: 0,
    error: null,
  };
  if (!account.enabled) return empty;

  const core = getStore();

  try {
    const credentials = await ensureFreshCredentials(account);
    const serverFolders = await listFolders(credentials);
    const stored: Folder[] = core.saveFolders(account.id, serverFolders);
    broadcast('folders:changed', account.id);

    const wanted = subscribedSet(account);
    const inserted: Envelope[] = [];
    let folderCount = 0;

    for (const folder of serverFolders) {
      if (!wanted.has(folder.path)) continue;
      folderCount += 1;

      const record = stored.find((entry) => entry.path === folder.path);
      const result = await fetchFolder(
        credentials,
        folder.path,
        record?.lastUid ?? 0,
        FETCH_LIMIT,
        record?.uidValidity ?? 0,
      );

      const folderEnvelopes: Envelope[] = [];
      for (const mail of result.mails) {
        const extracted = extractCode({
          subject: mail.parsed.subject,
          text: mail.parsed.text,
          from: mail.parsed.from,
        });
        const envelope = buildEnvelope({
          accountId: account.id,
          folderId: folder.path,
          uid: mail.uid,
          parsed: mail.parsed,
          highlight: buildHighlight(extracted),
          seen: mail.seen,
        });
        core.writeBody(account.id, folder.path, mail.uid, {
          text: mail.parsed.text,
          html: mail.parsed.html,
          // Keep image URLs in the stored HTML (structure is still sanitised);
          // the reading pane's sandboxed iframe CSP decides at render time
          // whether remote images may actually load. This is the "double
          // insurance": strip execution now, gate the network later.
          safeHtml: sanitizeMailHtml(mail.parsed.html, { allowRemoteImages: true }),
        });
        folderEnvelopes.push(envelope);
      }

      if (folderEnvelopes.length > 0) {
        const { added } = core.upsertEnvelopes(folderEnvelopes);
        inserted.push(...added);
      }

      core.updateFolderCursor(account.id, record?.id ?? `${account.id}::${folder.path}`, {
        uidValidity: result.uidValidity,
        lastUid: result.lastUid,
        lastSyncAt: Date.now(),
      });
      broadcast('folders:changed', account.id);
    }

    store.setAccountSyncResult(account.id, 'ok', null, Date.now());
    if (inserted.length > 0) broadcast('mail:new', inserted);

    return {
      accountId: account.id,
      accountName: account.name,
      added: inserted.length,
      folders: folderCount,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? describeImapError(error, account.imap.host) : String(error);
    store.setAccountSyncResult(account.id, 'error', message, Date.now());
    return { accountId: account.id, accountName: account.name, added: 0, folders: 0, error: message };
  }
}

/** Syncs every enabled account, or a single one when `accountId` is given. */
export async function syncAll(accountId?: string): Promise<SyncResult> {
  if (syncing) {
    return lastRun ?? { startedAt: Date.now(), finishedAt: Date.now(), totalAdded: 0, results: [] };
  }

  syncing = true;
  broadcast('sync:state', { syncing: true });

  const startedAt = Date.now();
  try {
    const accounts = store
      .getAccounts()
      .filter((account) => account.enabled && (accountId ? account.id === accountId : true));

    const results: AccountSyncResult[] = [];
    for (const account of accounts) {
      results.push(await syncAccount(account));
    }

    const result: SyncResult = {
      startedAt,
      finishedAt: Date.now(),
      totalAdded: results.reduce((sum, item) => sum + item.added, 0),
      results,
    };
    lastRun = result;
    return result;
  } finally {
    syncing = false;
    broadcast('sync:state', { syncing: false, lastRun });
  }
}
