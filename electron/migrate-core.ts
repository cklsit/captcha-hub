import type {
  Account,
  AppSettings,
  EmailAuthType,
  Envelope,
  ImapCredentials,
  SyncStatus,
  TotpEntry,
  TotpSecret,
} from '../shared/types';
import { mergeSettings } from './settings';

/**
 * Pure v1 → v2 data conversion.
 *
 * This module ONLY transforms an already-parsed legacy store object into the
 * new domain shapes; it performs no IO and needs no Electron, so it is directly
 * unit-testable. The caller (`migrate.ts`) is responsible for decrypting the
 * legacy secret fields before handing the object over and for writing the
 * results back to disk.
 *
 * Concept mapping (see architecture §0.3):
 *   - `email` source  → `Account` (syncFolders=['INBOX'], SMTP empty)
 *   - `totp`  source  → `TotpEntry`
 *   - `phone` source  → dropped (counted)
 *   - `CaptchaMessage`→ `Envelope` + on-disk body (summary as bodyText,
 *                        `bodyTruncated: true` because it was never complete)
 */

/* ----------------------------------------------------- legacy (v1) shapes */

export interface LegacyEmailCredentials {
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  mailbox?: string;
  authType?: EmailAuthType;
  clientId?: string;
  tenant?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

export interface LegacyPhoneConfig {
  phoneNumber?: string;
}

export interface LegacySource {
  id?: string;
  kind?: 'email' | 'phone' | 'totp';
  name?: string;
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastSyncAt?: number | null;
  lastSyncStatus?: SyncStatus;
  lastSyncError?: string | null;
  email?: LegacyEmailCredentials | null;
  phone?: LegacyPhoneConfig | null;
  totp?: Partial<TotpSecret> | null;
}

export interface LegacyMessage {
  id?: string;
  sourceId?: string;
  code?: string;
  confidence?: number;
  matchedKeyword?: string | null;
  expiresAtHint?: number | null;
  subject?: string;
  from?: string;
  summary?: string;
  receivedAt?: number;
  ingestedAt?: number;
  read?: boolean;
  uid?: string;
}

export interface LegacyStore {
  sources?: LegacySource[];
  messages?: LegacyMessage[];
  settings?: Partial<AppSettings>;
}

/* ------------------------------------------------------------- result */

/** A body file that must be written for a migrated envelope. */
export interface MigratedBody {
  accountId: string;
  folderId: string;
  uid: string;
  body: { text: string; html: string; safeHtml: string };
}

export interface MigrateV1Result {
  accounts: Account[];
  totpEntries: TotpEntry[];
  envelopes: Envelope[];
  bodies: MigratedBody[];
  settings: AppSettings;
  droppedPhoneCount: number;
  migratedMessageCount: number;
}

const MIGRATED_FOLDER = 'INBOX';

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toAccount(source: LegacySource): Account {
  const email = source.email ?? {};
  const now = Date.now();
  const imap: ImapCredentials = {
    host: str(email.host),
    port: num(email.port, 993),
    secure: bool(email.secure, true),
    username: str(email.username),
    password: str(email.password),
    authType: email.authType === 'oauth2' ? 'oauth2' : 'password',
    clientId: str(email.clientId),
    tenant: str(email.tenant, 'common') || 'common',
    refreshToken: str(email.refreshToken),
    accessToken: str(email.accessToken),
    accessTokenExpiresAt: num(email.accessTokenExpiresAt, 0),
  };

  return {
    id: str(source.id) || `acct-${now}`,
    name: str(source.name, '未命名账户'),
    enabled: bool(source.enabled, true),
    emailAddress: imap.username,
    displayName: '',
    imap,
    smtp: null,
    syncFolders: [MIGRATED_FOLDER],
    signature: '',
    scopes: [],
    needsReauth: false,
    createdAt: num(source.createdAt, now),
    updatedAt: now,
    lastSyncAt: source.lastSyncAt ?? null,
    lastSyncStatus: source.lastSyncStatus ?? 'never',
    lastSyncError: source.lastSyncError ?? null,
  };
}

function toTotpEntry(source: LegacySource): TotpEntry | null {
  const totp = source.totp;
  if (!totp || !totp.secret) return null;
  const now = Date.now();
  return {
    id: str(source.id) || `totp-${now}`,
    name: str(source.name, '导入的验证器'),
    enabled: bool(source.enabled, true),
    createdAt: num(source.createdAt, now),
    updatedAt: now,
    totp: {
      algorithm: totp.algorithm ?? 'SHA1',
      digits: totp.digits === 8 ? 8 : 6,
      period: num(totp.period, 30) || 30,
      secret: str(totp.secret),
      issuer: str(totp.issuer),
      account: str(totp.account),
      note: str(totp.note),
    },
  };
}

function toEnvelope(message: LegacyMessage, accountId: string): Envelope {
  const now = Date.now();
  const uid = str(message.uid) || str(message.id) || `uid-${now}`;
  const receivedAt = num(message.receivedAt, now);
  const code = str(message.code);
  return {
    id: str(message.id) || `${accountId}::${MIGRATED_FOLDER}::${uid}`,
    accountId,
    folderId: MIGRATED_FOLDER,
    uid,
    messageId: uid,
    subject: str(message.subject, '(无主题)'),
    from: str(message.from, '(未知发件人)'),
    to: '',
    cc: '',
    replyTo: '',
    snippet: str(message.summary),
    receivedAt,
    ingestedAt: num(message.ingestedAt, receivedAt),
    flags: { seen: bool(message.read, false), flagged: false, answered: false, draft: false },
    hasAttachments: false,
    attachments: [],
    highlight: code
      ? {
          code,
          confidence: num(message.confidence, 0),
          matchedKeyword: message.matchedKeyword ?? null,
          expiresAtHint: message.expiresAtHint ?? null,
        }
      : null,
    // The v1 body was only ever a ~180 char summary, so it is not the full text.
    bodyTruncated: true,
  };
}

/**
 * Converts a legacy (v1) store object into the v2 domain model.
 *
 * @param legacy Parsed v1 store JSON with SECRET FIELDS ALREADY DECRYPTED by
 *   the caller. Missing / malformed arrays are treated as empty.
 */
export function migrateV1ToV2(legacy: LegacyStore | null | undefined): MigrateV1Result {
  const sources = Array.isArray(legacy?.sources) ? legacy!.sources! : [];
  const messages = Array.isArray(legacy?.messages) ? legacy!.messages! : [];

  const accounts: Account[] = [];
  const totpEntries: TotpEntry[] = [];
  const migratedAccountIds = new Set<string>();
  let droppedPhoneCount = 0;

  for (const source of sources) {
    if (source.kind === 'email' && source.email) {
      const account = toAccount(source);
      accounts.push(account);
      migratedAccountIds.add(account.id);
    } else if (source.kind === 'totp') {
      const entry = toTotpEntry(source);
      if (entry) totpEntries.push(entry);
    } else if (source.kind === 'phone') {
      droppedPhoneCount += 1;
    }
  }

  const envelopes: Envelope[] = [];
  const bodies: MigratedBody[] = [];
  for (const message of messages) {
    const accountId = str(message.sourceId);
    if (!migratedAccountIds.has(accountId)) continue; // phone / orphaned source
    const envelope = toEnvelope(message, accountId);
    envelopes.push(envelope);
    bodies.push({
      accountId: envelope.accountId,
      folderId: envelope.folderId,
      uid: envelope.uid,
      body: { text: envelope.snippet, html: '', safeHtml: '' },
    });
  }

  const settings = mergeSettings(undefined, {
    ...(legacy?.settings ?? {}),
  });

  return {
    accounts,
    totpEntries,
    envelopes,
    bodies,
    settings,
    droppedPhoneCount,
    migratedMessageCount: envelopes.length,
  };
}
