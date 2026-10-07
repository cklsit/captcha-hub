import { randomUUID } from 'node:crypto';
import { fetchRecentMails, describeImapError } from './imap';
import { extractCode, isIngestible, resolveSourceForMail } from './extractor';
import { broadcast } from './events';
import * as store from './store';
import type { CaptchaMessage, Source, SourceSyncResult, SyncResult, SyncStatusInfo } from '../shared/types';

/**
 * Ingestion service: fetch mails -> extract codes -> attribute to a source ->
 * persist -> notify the renderer. Runs one source at a time to avoid hammering
 * a single mailbox with parallel connections.
 */

const FETCH_LIMIT = 30;
const SUMMARY_LENGTH = 180;

let syncing = false;
let lastRun: SyncResult | null = null;

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= SUMMARY_LENGTH) return clean;
  return `${clean.slice(0, SUMMARY_LENGTH)}…`;
}

export function isSyncing(): boolean {
  return syncing;
}

export function getLastRun(): SyncResult | null {
  return lastRun;
}

export function getSyncStatus(): SyncStatusInfo {
  return { syncing, lastRun };
}

export async function syncSource(source: Source): Promise<SourceSyncResult> {
  if (source.kind !== 'email' || !source.email || !source.enabled) {
    return { sourceId: source.id, sourceName: source.name, added: 0, error: null };
  }

  try {
    const mails = await fetchRecentMails(source.email, FETCH_LIMIT);
    const allSources = store.getSources();
    const collected: CaptchaMessage[] = [];

    for (const mail of mails) {
      const receivedAt = mail.date.getTime();

      const extracted = extractCode({ subject: mail.subject, text: mail.text, from: mail.from });
      if (!extracted) continue;

      const resolved = resolveSourceForMail(
        { subject: mail.subject, from: mail.from, text: mail.text },
        source.id,
        allSources,
      );
      if (!resolved) continue;

      // The mailbox source's own creation time, plus — for mail claimed by a
      // phone forwarding rule — the moment that rule was created, so a rule
      // added later cannot retroactively claim older messages.
      const baseline = Math.max(source.createdAt, resolved.source.createdAt);
      if (!isIngestible(receivedAt, baseline, extracted.confidence)) continue;

      collected.push({
        id: randomUUID(),
        sourceId: resolved.source.id,
        sourceKind: resolved.source.kind,
        sourceName: resolved.source.name,
        code: extracted.code,
        confidence: extracted.confidence,
        matchedKeyword: extracted.matchedKeyword,
        expiresAtHint: extracted.expiresAtHint,
        subject: mail.subject || '(无主题)',
        from: mail.from || '(未知发件人)',
        summary: summarize(mail.text),
        receivedAt,
        ingestedAt: Date.now(),
        read: false,
        uid: mail.uid,
      });
    }

    const { addedCount, inserted } = store.addMessages(collected);
    store.setSourceSyncResult(source.id, 'ok', null, Date.now());
    if (inserted.length > 0) {
      broadcast('inbox:new', inserted);
    }
    return { sourceId: source.id, sourceName: source.name, added: addedCount, error: null };
  } catch (error) {
    const message = describeImapError(error, source.email?.host ?? '');
    store.setSourceSyncResult(source.id, 'error', message, Date.now());
    return { sourceId: source.id, sourceName: source.name, added: 0, error: message };
  }
}

/** Syncs every enabled email source. Phone sources derive from them. */
export async function syncAll(): Promise<SyncResult> {
  if (syncing) {
    return lastRun ?? { startedAt: Date.now(), finishedAt: Date.now(), totalAdded: 0, results: [] };
  }

  syncing = true;
  broadcast('sync:state', { syncing: true });

  const startedAt = Date.now();
  try {
    const emailSources = store.getSources().filter((source) => source.kind === 'email' && source.enabled);
    const results: SourceSyncResult[] = [];
    for (const source of emailSources) {
      results.push(await syncSource(source));
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
