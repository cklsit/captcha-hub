import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { decryptString, encryptString } from './crypto';
import { capMessages, mergeMessages, sortByReceivedDesc } from './dedupe';
import { withTotpDefaults } from './totp';
import type {
  AppSettings,
  BackupBundle,
  CaptchaMessage,
  MessageFilter,
  SafeEmailCredentials,
  SafeSource,
  SafeTotpSecret,
  Source,
  SourceInput,
  SyncStatus,
  TotpExportItem,
} from '../shared/types';

/**
 * Persistence layer.
 *
 * Storage engine: `electron-store` (pure-JS, JSON file). We deliberately avoid
 * `better-sqlite3` because its native addon frequently fails to build on plain
 * Windows dev machines without a full toolchain; electron-store keeps the whole
 * app runnable with zero native compilation while still being simple and
 * atomic. Secrets are encrypted before they ever hit the disk (see crypto.ts).
 */

const MAX_MESSAGES = 2000;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  pollIntervalSec: 60,
  launchOnStartup: false,
  pinRecent: true,
};

type PersistShape = {
  sources: Source[];
  messages: CaptchaMessage[];
  settings: AppSettings;
};

let storeInstance: Store<PersistShape> | null = null;

function store(): Store<PersistShape> {
  if (!storeInstance) {
    storeInstance = new Store<PersistShape>({
      name: 'captcha-hub-data',
      defaults: {
        sources: [],
        messages: [],
        settings: DEFAULT_SETTINGS,
      },
    });
  }
  return storeInstance;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeDecrypt(value: string): string {
  return decryptString(value);
}

function encryptSource(source: Source): Source {
  const next = clone(source);
  if (next.email && next.email.password) {
    next.email.password = encryptString(next.email.password);
  }
  if (next.totp && next.totp.secret) {
    next.totp.secret = encryptString(next.totp.secret);
  }
  return next;
}

function decryptSource(source: Source): Source {
  const next = clone(source);
  if (next.email && next.email.password) {
    next.email.password = safeDecrypt(next.email.password);
  }
  if (next.totp && next.totp.secret) {
    next.totp.secret = safeDecrypt(next.totp.secret);
  }
  return next;
}

function toSafeSource(source: Source): SafeSource {
  let email: SafeEmailCredentials | null = null;
  if (source.email) {
    const { password, ...rest } = source.email;
    email = { ...rest, hasPassword: Boolean(password) };
  }
  let totp: SafeTotpSecret | null = null;
  if (source.totp) {
    const { secret, ...rest } = source.totp;
    totp = { ...rest, hasSecret: Boolean(secret) };
  }
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    enabled: source.enabled,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastSyncAt: source.lastSyncAt,
    lastSyncStatus: source.lastSyncStatus,
    lastSyncError: source.lastSyncError,
    email,
    phone: source.phone,
    totp,
  };
}

/* ------------------------------------------------------------------ sources */

/** All sources with secrets decrypted — MAIN PROCESS ONLY. */
export function getSources(): Source[] {
  return store().get('sources').map(decryptSource);
}

/** All sources with secrets stripped — safe to send to the renderer. */
export function listSafeSources(): SafeSource[] {
  return getSources().map(toSafeSource);
}

/** A single decrypted source (for IMAP / TOTP work) — MAIN PROCESS ONLY. */
export function getSource(id: string): Source | null {
  const found = getSources().find((source) => source.id === id);
  return found ?? null;
}

function buildSource(input: SourceInput, existing?: Source): Source {
  const now = Date.now();
  const base: Source = existing
    ? clone(existing)
    : {
        id: input.id ?? randomUUID(),
        kind: input.kind,
        name: input.name,
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now,
        lastSyncAt: null,
        lastSyncStatus: 'never',
        lastSyncError: null,
        email: null,
        phone: null,
        totp: null,
      };

  base.kind = input.kind;
  base.name = input.name.trim() || base.name || '未命名来源';
  base.enabled = input.enabled;
  base.updatedAt = now;

  if (input.kind === 'email') {
    const previousPassword = existing?.email?.password ?? '';
    const password = input.email?.password ? input.email.password : previousPassword;
    base.email = {
      host: input.email?.host ?? existing?.email?.host ?? '',
      port: input.email?.port ?? existing?.email?.port ?? 993,
      secure: input.email?.secure ?? existing?.email?.secure ?? true,
      username: input.email?.username ?? existing?.email?.username ?? '',
      password,
      mailbox: input.email?.mailbox || existing?.email?.mailbox || 'INBOX',
    };
    base.phone = null;
    base.totp = null;
  } else if (input.kind === 'phone') {
    base.phone = {
      phoneNumber: input.phone?.phoneNumber ?? existing?.phone?.phoneNumber ?? '',
      rule: {
        emailSourceId: input.phone?.rule.emailSourceId ?? existing?.phone?.rule.emailSourceId ?? '',
        matchField: input.phone?.rule.matchField ?? existing?.phone?.rule.matchField ?? 'subject',
        matchKeyword: input.phone?.rule.matchKeyword ?? existing?.phone?.rule.matchKeyword ?? '',
      },
    };
    base.email = null;
    base.totp = null;
  } else {
    const previousSecret = existing?.totp?.secret ?? '';
    const merged = withTotpDefaults({
      ...(existing?.totp ?? {}),
      ...(input.totp ?? {}),
    });
    merged.secret = input.totp?.secret ? input.totp.secret : previousSecret;
    base.totp = merged;
    base.email = null;
    base.phone = null;
  }

  return base;
}

export function createSource(input: SourceInput): SafeSource {
  const sources = getSources();
  const created = buildSource(input);
  sources.push(encryptSource(created));
  store().set('sources', sources);
  return toSafeSource(created);
}

export function updateSource(id: string, input: SourceInput): SafeSource {
  const sources = getSources();
  const index = sources.findIndex((source) => source.id === id);
  if (index === -1) throw new Error(`来源不存在: ${id}`);
  const updated = buildSource({ ...input, id }, sources[index]);
  sources[index] = encryptSource(updated);
  store().set('sources', sources);
  return toSafeSource(updated);
}

export function deleteSource(id: string): void {
  const sources = getSources().filter((source) => source.id !== id);
  store().set('sources', sources);
  // Also drop messages that referenced the deleted source.
  const messages = store().get('messages').filter((message) => message.sourceId !== id);
  store().set('messages', messages);
}

export function setSourceEnabled(id: string, enabled: boolean): SafeSource {
  const sources = getSources();
  const index = sources.findIndex((source) => source.id === id);
  if (index === -1) throw new Error(`来源不存在: ${id}`);
  sources[index].enabled = enabled;
  sources[index].updatedAt = Date.now();
  const result = sources[index];
  sources[index] = encryptSource(result);
  store().set('sources', sources);
  return toSafeSource(result);
}

export function setSourceSyncResult(
  id: string,
  status: SyncStatus,
  error: string | null,
  at: number,
): void {
  const sources = getSources();
  const index = sources.findIndex((source) => source.id === id);
  if (index === -1) return;
  sources[index].lastSyncAt = at;
  sources[index].lastSyncStatus = status;
  sources[index].lastSyncError = error;
  sources[index] = encryptSource(sources[index]);
  store().set('sources', sources);
}

/* ----------------------------------------------------------------- messages */

export function listMessages(filter?: MessageFilter): CaptchaMessage[] {
  let list = store().get('messages');

  if (filter) {
    if (filter.kind && filter.kind !== 'all') {
      list = list.filter((message) => message.sourceKind === filter.kind);
    }
    if (filter.sourceId && filter.sourceId !== 'all') {
      list = list.filter((message) => message.sourceId === filter.sourceId);
    }
    if (filter.unreadOnly) {
      list = list.filter((message) => !message.read);
    }
    if (filter.sinceMs && filter.sinceMs > 0) {
      list = list.filter((message) => message.receivedAt >= filter.sinceMs!);
    }
    if (filter.search && filter.search.trim()) {
      const query = filter.search.trim().toLowerCase();
      list = list.filter(
        (message) =>
          message.code.toLowerCase().includes(query) ||
          message.subject.toLowerCase().includes(query) ||
          message.from.toLowerCase().includes(query) ||
          message.summary.toLowerCase().includes(query) ||
          message.sourceName.toLowerCase().includes(query),
      );
    }
  }

  list = sortByReceivedDesc(list);
  if (filter?.limit && filter.limit > 0) {
    list = list.slice(0, filter.limit);
  }
  return list;
}

export function addMessages(messages: CaptchaMessage[]): {
  addedCount: number;
  inserted: CaptchaMessage[];
} {
  const existing = store().get('messages');
  const { merged, added } = mergeMessages(existing, messages);
  if (added.length > 0) {
    store().set('messages', capMessages(merged, MAX_MESSAGES));
  }
  return { addedCount: added.length, inserted: added };
}

export function setMessageRead(id: string, read: boolean): void {
  const messages = store().get('messages');
  const index = messages.findIndex((message) => message.id === id);
  if (index === -1) return;
  messages[index].read = read;
  store().set('messages', messages);
}

export function markAllMessagesRead(): void {
  const messages = store().get('messages').map((message) => ({ ...message, read: true }));
  store().set('messages', messages);
}

export function deleteMessage(id: string): void {
  store().set(
    'messages',
    store()
      .get('messages')
      .filter((message) => message.id !== id),
  );
}

export function clearMessages(): void {
  store().set('messages', []);
}

/* ----------------------------------------------------------------- settings */

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store().get('settings') };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...getSettings(), ...patch };
  merged.pollIntervalSec = Math.min(600, Math.max(15, Math.round(merged.pollIntervalSec)));
  merged.theme = merged.theme === 'light' ? 'light' : 'dark';
  store().set('settings', merged);
  return merged;
}

/* ------------------------------------------------------- backup / teardown */

export function exportBackup(includeSecrets: boolean): BackupBundle {
  const sources = getSources();

  const bundle: BackupBundle = {
    version: 1,
    exportedAt: Date.now(),
    includeSecrets,
    // Email passwords are NEVER exported in plaintext — the user re-enters them
    // after a restore. Only TOTP secrets are optionally included (explicit ask).
    sources: sources.map(toSafeSource),
    messages: store().get('messages'),
    settings: getSettings(),
  };

  if (includeSecrets) {
    bundle.totpSecrets = sources
      .filter((source) => source.kind === 'totp' && source.totp)
      .map((source) => ({
        name: source.name,
        issuer: source.totp!.issuer,
        account: source.totp!.account,
        algorithm: source.totp!.algorithm,
        digits: source.totp!.digits,
        period: source.totp!.period,
        secret: source.totp!.secret,
      }));
  }

  return bundle;
}

export function importBackup(bundle: BackupBundle): void {
  if (!bundle || bundle.version !== 1) {
    throw new Error('不支持的备份文件版本');
  }

  // Import plaintext sources (secrets optional) direct into storage.
  const sources = getSources();
  const existingIds = new Set(sources.map((source) => source.id));

  for (const safe of bundle.sources ?? []) {
    const source: Source = {
      id: safe.id && !existingIds.has(safe.id) ? safe.id : randomUUID(),
      kind: safe.kind,
      name: safe.name,
      enabled: safe.enabled,
      createdAt: safe.createdAt || Date.now(),
      updatedAt: Date.now(),
      lastSyncAt: safe.lastSyncAt ?? null,
      lastSyncStatus: 'never',
      lastSyncError: null,
      email: safe.email
        ? {
            host: safe.email.host,
            port: safe.email.port,
            secure: safe.email.secure,
            username: safe.email.username,
            password: '',
            mailbox: safe.email.mailbox,
          }
        : null,
      phone: safe.phone ?? null,
      totp: safe.totp ? withTotpDefaults(safe.totp) : null,
    };
    sources.push(encryptSource(source));
    existingIds.add(source.id);
  }
  store().set('sources', sources);

  if (Array.isArray(bundle.messages)) {
    addMessages(bundle.messages);
  }
  if (Array.isArray(bundle.totpSecrets) && bundle.totpSecrets.length > 0) {
    importTotp(bundle.totpSecrets);
  }
  if (bundle.settings) {
    updateSettings(bundle.settings);
  }
}

export function clearAll(): void {
  store().set('sources', []);
  store().set('messages', []);
  store().set('settings', DEFAULT_SETTINGS);
}

/** Export all TOTP secrets (optionally masked) for a user-initiated backup. */
export function exportTotp(includeSecrets: boolean): TotpExportItem[] {
  return getSources()
    .filter((source) => source.kind === 'totp' && source.totp)
    .map((source) => ({
      name: source.name,
      issuer: source.totp!.issuer,
      account: source.totp!.account,
      algorithm: source.totp!.algorithm,
      digits: source.totp!.digits,
      period: source.totp!.period,
      secret: includeSecrets ? source.totp!.secret : '',
    }));
}

/** Bulk-import TOTP entries as new sources. */
export function importTotp(items: TotpExportItem[]): SafeSource[] {
  const created: SafeSource[] = [];
  for (const item of items) {
    if (!item || !item.secret) continue;
    created.push(
      createSource({
        kind: 'totp',
        name: item.name || item.issuer || item.account || '导入的验证器',
        enabled: true,
        totp: {
          algorithm: item.algorithm,
          digits: item.digits,
          period: item.period,
          secret: item.secret,
          issuer: item.issuer,
          account: item.account,
          note: '',
        },
      }),
    );
  }
  return created;
}
