import fs from 'node:fs';
import path from 'node:path';
import type { Draft, Envelope, Folder, MessageFilter, MessageFlags } from '../shared/types';
import { envelopeKey } from './dedupe';

/**
 * Pure-JS storage core (Maildir-flavoured).
 *
 * Deliberately free of ANY `electron` import and taking its `rootDir` through
 * the constructor, so it can be exercised end-to-end in a temporary directory
 * on a headless CI runner (see `tests/mail-store-core.test.ts`). `mail-service.ts`
 * is the thin Electron-aware wrapper that injects `app.getPath('userData')`.
 *
 * Layout under `rootDir`:
 *   index.json                          → Envelope[] (the in-memory index)
 *   drafts.json                         → Draft[]
 *   folders.json                        → Folder[] (server folder metadata + sync cursors)
 *   accounts/<accountId>/<folderId>/<uid>.json → { text, html, safeHtml } (the body)
 *
 * All writes are atomic (write to a temp file, then `rename` over the target)
 * and every path segment sourced from a server (accountId / folderId / uid) is
 * passed through {@link MailStoreCore.safeSegment} to block path traversal.
 */

/** Per-folder index cap; envelopes are tiny so this is intentionally generous. */
export const MAX_ENVELOPES_PER_FOLDER = 20000;

/** Sanitised body shape persisted on disk. */
export interface MailBody {
  text: string;
  /** Raw HTML as received (kept for reference; never rendered directly). */
  html: string;
  /** Sanitized HTML, safe to inject into the reading pane's sandboxed iframe. */
  safeHtml: string;
}

const BODY_EXT = '.json';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable de-duplication key (see `dedupe.ts`): `account::folder::uid`. */
export { envelopeKey };

export function folderKey(accountId: string, folderId: string): string {
  return `${accountId}::${folderId}`;
}

export interface FolderCount {
  unread: number;
  total: number;
}

export interface ScanOptions {
  /** Maximum number of matches to return (default 500). */
  limit?: number;
  /** Number of bodies inspected per batch handed to `onBatch` (default 64). */
  batchSize?: number;
}

export class MailStoreCore {
  private readonly rootDir: string;
  private indexCache: Envelope[] | null = null;
  private foldersCache: Folder[] | null = null;
  private draftsCache: Draft[] | null = null;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /* ------------------------------------------------------------ path safety */

  /** Strips separators / control chars from a value used as a path segment. */
  safeSegment(segment: string): string {
    const cleaned = String(segment ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:?*"<>|\u0000-\u001f]/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim();
    return cleaned.length > 0 ? cleaned.slice(0, 180) : '_';
  }

  private indexPath(): string {
    return path.join(this.rootDir, 'index.json');
  }

  private draftsPath(): string {
    return path.join(this.rootDir, 'drafts.json');
  }

  private foldersPath(): string {
    return path.join(this.rootDir, 'folders.json');
  }

  private bodyPath(accountId: string, folderId: string, uid: string): string {
    return path.join(
      this.rootDir,
      'accounts',
      this.safeSegment(accountId),
      this.safeSegment(folderId),
      `${this.safeSegment(uid)}${BODY_EXT}`,
    );
  }

  /* -------------------------------------------------------------- atomic io */

  private ensureDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    this.ensureDir(filePath);
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  private readJson<T>(filePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /* --------------------------------------------------------------- indexing */

  loadIndex(): Envelope[] {
    if (this.indexCache === null) {
      const raw = this.readJson<Envelope[]>(this.indexPath(), []);
      this.indexCache = Array.isArray(raw) ? raw : [];
    }
    return this.indexCache;
  }

  private persistIndex(): void {
    this.writeJsonAtomic(this.indexPath(), this.indexCache ?? []);
  }

  /** Drops the in-memory cache so the next read re-reads from disk. */
  reload(): void {
    this.indexCache = null;
    this.foldersCache = null;
    this.draftsCache = null;
  }

  private matches(envelope: Envelope, filter?: MessageFilter): boolean {
    if (!filter) return true;
    if (filter.accountId && filter.accountId !== 'all' && envelope.accountId !== filter.accountId) {
      return false;
    }
    if (filter.folderId && filter.folderId !== 'all' && envelope.folderId !== filter.folderId) {
      return false;
    }
    if (filter.unreadOnly && envelope.flags.seen) return false;
    if (filter.hasAttachments && !envelope.hasAttachments) return false;
    if (filter.captchaOnly && !envelope.highlight) return false;
    if (filter.sinceMs && filter.sinceMs > 0 && envelope.receivedAt < filter.sinceMs) return false;
    if (filter.search && filter.search.trim()) {
      const query = filter.search.trim().toLowerCase();
      const haystack = [
        envelope.subject,
        envelope.from,
        envelope.to,
        envelope.cc,
        envelope.snippet,
        envelope.highlight?.code ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  listEnvelopes(filter?: MessageFilter): Envelope[] {
    let list = this.loadIndex().filter((envelope) => this.matches(envelope, filter));
    list = [...list].sort((a, b) => b.receivedAt - a.receivedAt);
    const offset = filter?.offset && filter.offset > 0 ? filter.offset : 0;
    if (offset > 0) list = list.slice(offset);
    if (filter?.limit && filter.limit > 0) list = list.slice(0, filter.limit);
    return clone(list);
  }

  getEnvelope(id: string): Envelope | null {
    const found = this.loadIndex().find((envelope) => envelope.id === id);
    return found ? clone(found) : null;
  }

  /**
   * Inserts new envelopes and refreshes the flags/highlight of existing ones
   * (matched by `accountId::folderId::uid`). Returns the genuinely new entries.
   */
  upsertEnvelopes(envelopes: Envelope[]): { added: Envelope[]; updated: number } {
    const index = this.loadIndex();
    const position = new Map<string, number>();
    index.forEach((envelope, i) => position.set(envelopeKey(envelope), i));

    const added: Envelope[] = [];
    let updated = 0;

    for (const incoming of envelopes) {
      const key = envelopeKey(incoming);
      const at = position.get(key);
      if (at === undefined) {
        index.push(clone(incoming));
        position.set(key, index.length - 1);
        added.push(clone(incoming));
      } else {
        const existing = index[at];
        // Preserve locally-known flags when the server did not carry them.
        index[at] = { ...clone(incoming), id: existing.id, flags: incoming.flags ?? existing.flags };
        updated += 1;
      }
    }

    this.capFolders(index);
    this.persistIndex();
    return { added, updated };
  }

  /** Enforces {@link MAX_ENVELOPES_PER_FOLDER} and cleans up evicted bodies. */
  private capFolders(index: Envelope[]): void {
    const groups = new Map<string, number[]>();
    index.forEach((envelope, i) => {
      const key = folderKey(envelope.accountId, envelope.folderId);
      const bucket = groups.get(key);
      if (bucket) bucket.push(i);
      else groups.set(key, [i]);
    });

    const remove = new Set<number>();
    for (const bucket of groups.values()) {
      if (bucket.length <= MAX_ENVELOPES_PER_FOLDER) continue;
      const ordered = bucket
        .map((i) => index[i])
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(MAX_ENVELOPES_PER_FOLDER);
      for (const evicted of ordered) {
        const at = index.findIndex((envelope) => envelope.id === evicted.id);
        if (at !== -1) remove.add(at);
        this.removeBodyFile(evicted.accountId, evicted.folderId, evicted.uid);
      }
    }

    if (remove.size > 0) {
      for (let i = index.length - 1; i >= 0; i -= 1) {
        if (remove.has(i)) index.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ bodies */

  writeBody(accountId: string, folderId: string, uid: string, body: MailBody): void {
    this.writeJsonAtomic(this.bodyPath(accountId, folderId, uid), {
      text: body.text ?? '',
      html: body.html ?? '',
      safeHtml: body.safeHtml ?? '',
    });
  }

  readBody(accountId: string, folderId: string, uid: string): MailBody | null {
    return this.readJson<MailBody | null>(this.bodyPath(accountId, folderId, uid), null);
  }

  private removeBodyFile(accountId: string, folderId: string, uid: string): void {
    try {
      const target = this.bodyPath(accountId, folderId, uid);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      /* best effort */
    }
  }

  /* --------------------------------------------------------------- mutations */

  setFlags(id: string, flags: Partial<MessageFlags>): Envelope | null {
    const index = this.loadIndex();
    const at = index.findIndex((envelope) => envelope.id === id);
    if (at === -1) return null;
    index[at] = { ...index[at], flags: { ...index[at].flags, ...flags } };
    this.persistIndex();
    return clone(index[at]);
  }

  moveMessage(id: string, targetFolderId: string, targetUid?: string): Envelope | null {
    const index = this.loadIndex();
    const at = index.findIndex((envelope) => envelope.id === id);
    if (at === -1) return null;
    const current = index[at];
    const movedUid = targetUid && targetUid.length > 0 ? targetUid : current.uid;

    // Relocate the body file to the new folder directory.
    const body = this.readBody(current.accountId, current.folderId, current.uid);
    this.writeBody(current.accountId, targetFolderId, movedUid, body ?? { text: '', html: '', safeHtml: '' });
    if (current.folderId !== targetFolderId || movedUid !== current.uid) {
      this.removeBodyFile(current.accountId, current.folderId, current.uid);
    }

    const updated: Envelope = {
      ...current,
      folderId: targetFolderId,
      uid: movedUid,
      accountId: current.accountId,
    };
    index[at] = updated;
    this.persistIndex();
    return clone(updated);
  }

  deleteMessage(id: string): void {
    const index = this.loadIndex();
    const at = index.findIndex((envelope) => envelope.id === id);
    if (at === -1) return;
    const [removed] = index.splice(at, 1);
    this.removeBodyFile(removed.accountId, removed.folderId, removed.uid);
    this.persistIndex();
  }

  /** Removes every envelope of an account / folder and its body files. */
  deleteFolderEnvelopes(accountId: string, folderId: string): void {
    const index = this.loadIndex();
    const survivors: Envelope[] = [];
    for (const envelope of index) {
      if (envelope.accountId === accountId && envelope.folderId === folderId) {
        this.removeBodyFile(envelope.accountId, envelope.folderId, envelope.uid);
      } else {
        survivors.push(envelope);
      }
    }
    this.indexCache = survivors;
    this.persistIndex();
  }

  clearAll(): void {
    this.indexCache = [];
    this.foldersCache = [];
    this.draftsCache = [];
    this.persistIndex();
    this.writeJsonAtomic(this.foldersPath(), []);
    this.writeJsonAtomic(this.draftsPath(), []);
    try {
      fs.rmSync(path.join(this.rootDir, 'accounts'), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  /** Drops every envelope and body file but keeps folders and drafts intact. */
  clearEnvelopes(): void {
    this.indexCache = [];
    this.persistIndex();
    try {
      fs.rmSync(path.join(this.rootDir, 'accounts'), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  folderCounts(accountId: string): Record<string, FolderCount> {
    const counts: Record<string, FolderCount> = {};
    for (const envelope of this.loadIndex()) {
      if (accountId && envelope.accountId !== accountId) continue;
      const bucket = counts[envelope.folderId] ?? { unread: 0, total: 0 };
      bucket.total += 1;
      if (!envelope.flags.seen) bucket.unread += 1;
      counts[envelope.folderId] = bucket;
    }
    return counts;
  }

  /* ------------------------------------------------------------ body search */

  /**
   * On-demand body scan for a substring (case-insensitive). Bodies are read
   * lazily, in batches, and the result set is capped — this is intentionally
   * NOT a full-text index (the app does not promise index-grade immediacy).
   */
  scanBodies(
    filter: MessageFilter | undefined,
    search: string,
    onBatch?: (ids: string[]) => void,
    options: ScanOptions = {},
  ): string[] {
    const query = (search ?? '').trim().toLowerCase();
    if (!query) return [];

    const limit = options.limit && options.limit > 0 ? options.limit : 500;
    const batchSize = options.batchSize && options.batchSize > 0 ? options.batchSize : 64;

    const candidates = this.loadIndex().filter((envelope) => this.matches(envelope, filter));
    const matched: string[] = [];
    let buffer: string[] = [];

    for (const envelope of candidates) {
      if (matched.length >= limit) break;
      const body = this.readBody(envelope.accountId, envelope.folderId, envelope.uid);
      if (body && body.text.toLowerCase().includes(query)) {
        matched.push(envelope.id);
        buffer.push(envelope.id);
        if (buffer.length >= batchSize) {
          if (onBatch) onBatch(buffer);
          buffer = [];
        }
      }
    }

    if (buffer.length > 0 && onBatch) onBatch(buffer);
    return matched;
  }

  /* ---------------------------------------------------------------- folders */

  private loadFolders(): Folder[] {
    if (this.foldersCache === null) {
      const raw = this.readJson<Folder[]>(this.foldersPath(), []);
      this.foldersCache = Array.isArray(raw) ? raw : [];
    }
    return this.foldersCache;
  }

  private persistFolders(): void {
    this.writeJsonAtomic(this.foldersPath(), this.foldersCache ?? []);
  }

  /** Reconciles the server folder list with what is stored, preserving user prefs. */
  saveFolders(
    accountId: string,
    serverFolders: Array<Pick<Folder, 'path' | 'name' | 'delimiter' | 'specialUse'>>,
  ): Folder[] {
    const existing = this.loadFolders();
    const byPath = new Map<string, Folder>();
    existing.filter((folder) => folder.accountId === accountId).forEach((f) => byPath.set(f.path, f));

    const merged: Folder[] = [];
    for (const server of serverFolders) {
      const prior = byPath.get(server.path);
      merged.push({
        id: folderKey(accountId, server.path),
        accountId,
        path: server.path,
        name: server.name || server.path,
        delimiter: server.delimiter || '/',
        specialUse: server.specialUse || '',
        unreadCount: prior?.unreadCount ?? 0,
        totalCount: prior?.totalCount ?? 0,
        subscribed: prior?.subscribed ?? false,
        lastSyncAt: prior?.lastSyncAt ?? null,
        uidValidity: prior?.uidValidity ?? 0,
        lastUid: prior?.lastUid ?? 0,
      });
    }

    const others = existing.filter((folder) => folder.accountId !== accountId);
    this.foldersCache = [...others, ...merged];
    this.persistFolders();
    return clone(merged);
  }

  listFolders(accountId?: string): Folder[] {
    const folderList = this.loadFolders().filter(
      (folder) => !accountId || folder.accountId === accountId,
    );
    const counts = new Map<string, FolderCount>();
    if (accountId) {
      for (const [folderId, count] of Object.entries(this.folderCounts(accountId))) {
        counts.set(folderKey(accountId, folderId), count);
      }
    }
    return clone(
      folderList.map((folder) => {
        const count = counts.get(folder.id);
        return count
          ? { ...folder, unreadCount: count.unread, totalCount: count.total }
          : folder;
      }),
    );
  }

  getFolder(_accountId: string, folderId: string): Folder | null {
    const found = this.loadFolders().find((folder) => folder.id === folderId);
    return found ?? null;
  }

  setSubscribed(accountId: string, paths: string[]): Folder[] {
    const wanted = new Set(paths);
    this.foldersCache = this.loadFolders().map((folder) =>
      folder.accountId === accountId ? { ...folder, subscribed: wanted.has(folder.path) } : folder,
    );
    this.persistFolders();
    return this.listFolders(accountId);
  }

  updateFolderCursor(
    _accountId: string,
    folderId: string,
    cursor: { uidValidity?: number; lastUid?: number; lastSyncAt?: number | null },
  ): void {
    this.foldersCache = this.loadFolders().map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            uidValidity: cursor.uidValidity ?? folder.uidValidity,
            lastUid: cursor.lastUid ?? folder.lastUid,
            lastSyncAt: cursor.lastSyncAt === undefined ? folder.lastSyncAt : cursor.lastSyncAt,
          }
        : folder,
    );
    this.persistFolders();
  }

  deleteAccount(accountId: string): void {
    this.indexCache = this.loadIndex().filter((envelope) => envelope.accountId !== accountId);
    this.foldersCache = this.loadFolders().filter((folder) => folder.accountId !== accountId);
    this.draftsCache = this.loadDrafts().filter((draft) => draft.accountId !== accountId);
    this.persistIndex();
    this.persistFolders();
    this.writeJsonAtomic(this.draftsPath(), this.draftsCache);
    try {
      fs.rmSync(path.join(this.rootDir, 'accounts', this.safeSegment(accountId)), {
        recursive: true,
        force: true,
      });
    } catch {
      /* best effort */
    }
  }

  /* ----------------------------------------------------------------- drafts */

  private loadDrafts(): Draft[] {
    if (this.draftsCache === null) {
      const raw = this.readJson<Draft[]>(this.draftsPath(), []);
      this.draftsCache = Array.isArray(raw) ? raw : [];
    }
    return this.draftsCache;
  }

  private persistDrafts(): void {
    this.writeJsonAtomic(this.draftsPath(), this.draftsCache ?? []);
  }

  saveDraft(input: Omit<Draft, 'id' | 'updatedAt'> & { id?: string }): Draft {
    const drafts = this.loadDrafts();
    const now = Date.now();
    if (input.id) {
      const at = drafts.findIndex((draft) => draft.id === input.id);
      if (at !== -1) {
        const updated: Draft = { ...drafts[at], ...clone(input), id: input.id, updatedAt: now };
        drafts[at] = updated;
        this.persistDrafts();
        return clone(updated);
      }
    }
    const created: Draft = {
      id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
      accountId: input.accountId,
      mode: input.mode,
      inReplyTo: input.inReplyTo ?? '',
      to: input.to ?? '',
      cc: input.cc ?? '',
      subject: input.subject ?? '',
      bodyText: input.bodyText ?? '',
      bodyHtml: input.bodyHtml ?? '',
      attachments: input.attachments ?? [],
      updatedAt: now,
    };
    drafts.push(created);
    this.draftsCache = drafts;
    this.persistDrafts();
    return clone(created);
  }

  listDrafts(accountId?: string): Draft[] {
    return clone(
      this.loadDrafts()
        .filter((draft) => !accountId || draft.accountId === accountId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }

  deleteDraft(id: string): void {
    this.draftsCache = this.loadDrafts().filter((draft) => draft.id !== id);
    this.persistDrafts();
  }
}
