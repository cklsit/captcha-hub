/**
 * Shared domain types used by BOTH the Electron main process and the renderer.
 * This file must stay free of any runtime dependency (types only) so that it can
 * be imported from either side without pulling Node or DOM globals in.
 */

export type MatchField = 'subject' | 'from' | 'body';
export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export type ThemeMode = 'dark' | 'light';
export type SyncStatus = 'never' | 'ok' | 'error' | 'syncing';
/** Whether the HTML body is rendered in a sandbox or downgraded to plain text. */
export type BodyRenderMode = 'html' | 'text';

/**
 * How a mailbox authenticates.
 *
 * `password` covers every provider that still accepts an app-specific password
 * or authorisation code. `oauth2` exists because Microsoft retired Basic
 * Authentication for IMAP entirely — outlook.office365.com advertises
 * LOGINDISABLED and rejects every password, so an access token is the only way in.
 */
export type EmailAuthType = 'password' | 'oauth2';

/** IMAP credentials for an account. Secret fields are plaintext only in memory. */
export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Used when `authType` is `password`. */
  password: string;
  authType: EmailAuthType;
  /** Azure app registration (public client) backing the device-code login. */
  clientId: string;
  /** OAuth authority tenant: 'common' | 'consumers' | 'organizations' | <tenant id>. */
  tenant: string;
  /** SECRET — long-lived; encrypted at rest. */
  refreshToken: string;
  /** SECRET — short-lived; encrypted at rest, refreshed on demand. */
  accessToken: string;
  /** Epoch ms at which `accessToken` stops being usable (0 when never fetched). */
  accessTokenExpiresAt: number;
}

/** SMTP credentials used for sending. Secret fields are plaintext only in memory. */
export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** SECRET — encrypted at rest. Unused for `oauth2`. */
  password: string;
  authType: EmailAuthType;
}

/**
 * A fully-resolved mail account as used inside the main process (contains
 * plaintext secrets after decryption). Never send this object to the renderer.
 */
export interface Account {
  id: string;
  name: string;
  enabled: boolean;
  emailAddress: string;
  displayName: string;
  imap: ImapCredentials;
  smtp: SmtpCredentials | null;
  /** Folder paths the user opted into syncing (defaults to ['INBOX']). */
  syncFolders: string[];
  /** Free-form signature inserted into replies / forwards / new mails. */
  signature: string;
  /** OAuth scopes Microsoft actually granted (used to detect missing SMTP.Send). */
  scopes: string[];
  /** True when a scope upgrade (e.g. SMTP.Send) still needs a fresh login. */
  needsReauth: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
  lastSyncStatus: SyncStatus;
  lastSyncError: string | null;
}

/** TOTP (RFC 6238) configuration. `secret` is Base32 and always stored encrypted. */
export interface TotpSecret {
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  secret: string;
  issuer: string;
  account: string;
  note: string;
}

/** A standalone TOTP authenticator entry (split out of the old Source union). */
export interface TotpEntry {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  totp: TotpSecret;
}

/** TOTP entry decoded from a QR code — everything except the free-form note. */
export type TotpScanDraft = Omit<TotpSecret, 'note'>;

/** Outcome of scanning a 2FA enrolment QR code (image file or clipboard). */
export interface TotpScanResult {
  ok: boolean;
  message: string;
  /** Present only when `ok` is true. */
  draft?: TotpScanDraft;
}

/** An IMAP folder as advertised by the server. */
export interface Folder {
  id: string;
  accountId: string;
  path: string;
  name: string;
  delimiter: string;
  /** Special-use flag advertised by the server (`\Inbox`, `\Sent`, `\Trash`…). */
  specialUse: string;
  unreadCount: number;
  totalCount: number;
  subscribed: boolean;
  lastSyncAt: number | null;
  /** UIDVALIDITY of the mailbox the last time it was synced. */
  uidValidity: number;
  /** Highest UID already ingested (incremental sync cursor). */
  lastUid: number;
}

/** Read/answer flags mirrored from IMAP. */
export interface MessageFlags {
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
}

/** Metadata for an attachment; the bytes are fetched on demand. */
export interface AttachmentMeta {
  /** Index of the attachment inside the parsed mail, used to re-fetch it. */
  partId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

/** Verification-code highlight metadata attached to a mail (nullable). */
export interface CodeHighlight {
  code: string;
  confidence: number;
  matchedKeyword: string | null;
  expiresAtHint: number | null;
}

/**
 * The envelope (index entry) of a mail. Deliberately small — the body lives in
 * a separate on-disk file so the in-memory index stays cheap.
 */
export interface Envelope {
  id: string;
  accountId: string;
  folderId: string;
  uid: string;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  /** ~180 char list preview. */
  snippet: string;
  receivedAt: number;
  ingestedAt: number;
  flags: MessageFlags;
  hasAttachments: boolean;
  attachments: AttachmentMeta[];
  highlight: CodeHighlight | null;
  /** True when the stored body may be incomplete (migrated / not fully fetched). */
  bodyTruncated: boolean;
}

/** A full mail: its envelope plus the (sanitized) body. */
export interface MailMessage {
  id: string;
  envelope: Envelope;
  bodyText: string;
  /** Sanitized, iframe-safe HTML ('' when the mail has no HTML part). */
  bodyHtml: string;
}

/** Compose mode for drafts / sending. */
export type ComposeMode = 'new' | 'reply' | 'forward';

/** A locally-saved draft. */
export interface Draft {
  id: string;
  accountId: string;
  mode: ComposeMode;
  inReplyTo: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Local file paths of attachments chosen by the user. */
  attachments: string[];
  updatedAt: number;
}

export interface MessageFilter {
  search?: string;
  accountId?: string | 'all';
  folderId?: string | 'all';
  unreadOnly?: boolean;
  hasAttachments?: boolean;
  captchaOnly?: boolean;
  sinceMs?: number | null;
  limit?: number;
  offset?: number;
}

export interface AppSettings {
  theme: ThemeMode;
  /** Background sync interval in seconds (clamped between 15 and 600). */
  pollIntervalSec: number;
  launchOnStartup: boolean;
  /** When true the mail list pins messages received within the last 5 minutes. */
  pinRecent: boolean;
  bodyRenderMode: BodyRenderMode;
  /** Whether remote images load by default in the reading pane. */
  allowRemoteImages: boolean;
  /** Default directory suggested for downloaded attachments. */
  attachmentDir: string;
  desktopNotifications: boolean;
  /** Set once the v1 → v2 data migration has run. */
  migratedFromV1: boolean;
  /** One-time banner shown after migration (e.g. phone sources were dropped). */
  migrationNotice: string;
}

/** Quick-fill preset for a common mailbox provider (IMAP + SMTP). */
export interface AccountPreset {
  key: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  note: string;
}

/** Result of the verification-code extraction engine (pure, deterministic). */
export interface ExtractedCode {
  code: string;
  confidence: number;
  matchedKeyword: string | null;
  /** Absolute epoch (ms) the code is likely to expire, or null when unknown. */
  expiresAtHint: number | null;
}

export interface TotpDisplay {
  id: string;
  name: string;
  issuer: string;
  account: string;
  code: string;
  remaining: number;
  period: number;
  progress: number;
  enabled: boolean;
}

export interface TotpExportItem {
  name: string;
  issuer: string;
  account: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  secret: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** Result of downloading one attachment to disk. */
export interface AttachmentDownloadResult {
  saved: boolean;
  path?: string;
  error?: string;
}

/** Result of an SMTP send. */
export interface SendResult {
  ok: boolean;
  message: string;
  /** True when the account must re-authorise before it can send. */
  needsReauth?: boolean;
  /** The local Sent copy, when one was inserted into the index. */
  envelopeId?: string;
}

export interface AccountSyncResult {
  accountId: string;
  accountName: string;
  added: number;
  folders: number;
  error: string | null;
}

export interface SyncResult {
  startedAt: number;
  finishedAt: number;
  totalAdded: number;
  results: AccountSyncResult[];
}

export interface SyncStatusInfo {
  syncing: boolean;
  lastRun: SyncResult | null;
}

export interface SyncStateEvent {
  syncing: boolean;
  lastRun?: SyncResult | null;
}

/** Payload used when sending / saving a draft. */
export interface ComposePayload {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: string[];
  inReplyTo: string;
  mode: ComposeMode;
  /** When the compose session was resumed from an existing draft. */
  draftId?: string;
}

export interface BackupBundle {
  version: 2;
  exportedAt: number;
  includeSecrets: boolean;
  accounts: SafeAccount[];
  envelopes: Envelope[];
  drafts: Draft[];
  settings: AppSettings;
  totpSecrets?: TotpExportItem[];
}

/** IMAP credentials safe for the renderer: every secret is stripped out. */
export interface SafeImapCredentials
  extends Omit<ImapCredentials, 'password' | 'refreshToken' | 'accessToken'> {
  hasPassword: boolean;
  /** True once a Microsoft device-code login succeeded for this account. */
  hasRefreshToken: boolean;
}

/** SMTP credentials safe for the renderer. */
export interface SafeSmtpCredentials extends Omit<SmtpCredentials, 'password'> {
  hasPassword: boolean;
}

/** Account representation safe to expose to the renderer (secrets stripped). */
export interface SafeAccount extends Omit<Account, 'imap' | 'smtp'> {
  imap: SafeImapCredentials;
  smtp: SafeSmtpCredentials | null;
}

export interface SafeTotpSecret extends Omit<TotpSecret, 'secret'> {
  hasSecret: boolean;
}

export interface SafeTotpEntry extends Omit<TotpEntry, 'totp'> {
  totp: SafeTotpSecret;
}

/**
 * Email portion of a create/update payload.
 *
 * `oauthFlowId` is a handle to a completed Microsoft device-code login whose
 * tokens live in the main process; the renderer never sees them. Supplying it
 * is what makes an `oauth2` account usable — without it the account has no way
 * to authenticate.
 */
export interface EmailSourceInput extends Partial<ImapCredentials> {
  oauthFlowId?: string;
}

/** SMTP portion of a create/update payload. */
export type SmtpInput = Partial<SmtpCredentials>;

/** Payload used when creating / updating an account from the renderer. */
export interface AccountInput {
  id?: string;
  name: string;
  enabled: boolean;
  emailAddress?: string;
  displayName?: string;
  imap?: EmailSourceInput | null;
  smtp?: SmtpInput | null;
  syncFolders?: string[];
  signature?: string;
}

/** Payload used when creating / updating a TOTP entry from the renderer. */
export interface TotpEntryInput {
  id?: string;
  name: string;
  enabled: boolean;
  totp?: Partial<TotpSecret> | null;
}

/** Step 1 of the Microsoft device-code flow, shown to the user as instructions. */
export interface MsLoginStartResult {
  ok: boolean;
  message: string;
  flowId?: string;
  /** Short code the user types at `verificationUri`. */
  userCode?: string;
  verificationUri?: string;
  expiresInSec?: number;
  /** How often the renderer should call `msLoginPoll`. */
  intervalSec?: number;
}

export type MsLoginStatus = 'pending' | 'slow_down' | 'success' | 'error';

export interface MsLoginPollResult {
  status: MsLoginStatus;
  message: string;
}

/** The complete, typed surface exposed to the renderer through the preload bridge. */
export interface MailHubApi {
  accounts: {
    list(): Promise<SafeAccount[]>;
    presets(): Promise<AccountPreset[]>;
    create(input: AccountInput): Promise<SafeAccount>;
    update(id: string, input: AccountInput): Promise<SafeAccount>;
    remove(id: string): Promise<void>;
    toggle(id: string, enabled: boolean): Promise<SafeAccount>;
    test(input: AccountInput): Promise<ConnectionTestResult>;
    testSmtp(input: AccountInput): Promise<ConnectionTestResult>;
    folders(id: string): Promise<Folder[]>;
    /** Starts a Microsoft device-code login; the user approves it in a browser. */
    msLoginStart(email: EmailSourceInput): Promise<MsLoginStartResult>;
    /** Advances the pending login by one poll. Tokens stay in the main process. */
    msLoginPoll(flowId: string): Promise<MsLoginPollResult>;
    /** Abandons a pending login and discards any tokens it collected. */
    msLoginCancel(flowId: string): Promise<void>;
  };
  folders: {
    list(accountId?: string): Promise<Folder[]>;
    /** Replaces the set of subscribed folder paths for an account. */
    setSubscribed(accountId: string, paths: string[]): Promise<Folder[]>;
    /** Connects and refreshes the folder list straight from the server. */
    refresh(accountId: string): Promise<Folder[]>;
  };
  messages: {
    list(filter?: MessageFilter): Promise<Envelope[]>;
    get(id: string): Promise<MailMessage | null>;
    setFlags(id: string, flags: Partial<MessageFlags>): Promise<void>;
    move(id: string, targetFolderId: string): Promise<void>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
    markAllRead(filter?: MessageFilter): Promise<void>;
    /** On-demand body scan; returns matching envelope ids (progressive cap). */
    searchBodies(search: string, limit?: number): Promise<string[]>;
  };
  attachments: {
    download(messageId: string, partId: string): Promise<AttachmentDownloadResult>;
  };
  compose: {
    send(payload: ComposePayload): Promise<SendResult>;
    saveDraft(payload: ComposePayload): Promise<Draft>;
    listDrafts(accountId?: string): Promise<Draft[]>;
    removeDraft(id: string): Promise<void>;
    replyPrefill(messageId: string): Promise<ComposePayload | null>;
    forwardPrefill(messageId: string): Promise<ComposePayload | null>;
  };
  totp: {
    list(): Promise<TotpDisplay[]>;
    create(input: TotpEntryInput): Promise<SafeTotpEntry>;
    update(id: string, input: TotpEntryInput): Promise<SafeTotpEntry>;
    remove(id: string): Promise<void>;
    export(includeSecrets: boolean): Promise<TotpExportItem[]>;
    import(items: TotpExportItem[]): Promise<SafeTotpEntry[]>;
    /** Opens a file picker, decodes the QR code and returns a form prefill. */
    scanImage(): Promise<TotpScanResult>;
    /** Decodes the QR code currently on the clipboard. */
    scanClipboard(): Promise<TotpScanResult>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    export(includeSecrets: boolean): Promise<BackupBundle>;
    import(bundle: BackupBundle): Promise<void>;
    clearAll(): Promise<void>;
  };
  sync: {
    now(accountId?: string): Promise<SyncResult>;
    status(): Promise<SyncStatusInfo>;
  };
  system: {
    copy(text: string): void;
    saveTextFile(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>;
    openTextFile(): Promise<{ canceled: boolean; content?: string; path?: string }>;
    /** Opens an https URL in the user's default browser. Returns false if refused. */
    openExternal(url: string): Promise<boolean>;
    platform: string;
    appVersion: string;
  };
  on: {
    newMessages(cb: (envelopes: Envelope[]) => void): () => void;
    syncState(cb: (state: SyncStateEvent) => void): () => void;
    foldersChanged(cb: (accountId: string) => void): () => void;
  };
}
