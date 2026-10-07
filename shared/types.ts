/**
 * Shared domain types used by BOTH the Electron main process and the renderer.
 * This file must stay free of any runtime dependency (types only) so that it can
 * be imported from either side without pulling Node or DOM globals in.
 */

export type SourceKind = 'email' | 'phone' | 'totp';
export type MatchField = 'subject' | 'from' | 'body';
export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export type ThemeMode = 'dark' | 'light';
export type SyncStatus = 'never' | 'ok' | 'error' | 'syncing';

/**
 * How a mailbox authenticates.
 *
 * `password` covers every provider that still accepts an app-specific password
 * or authorisation code. `oauth2` exists because Microsoft retired Basic
 * Authentication for IMAP entirely — outlook.office365.com advertises
 * LOGINDISABLED and rejects every password, so an access token is the only way in.
 */
export type EmailAuthType = 'password' | 'oauth2';

/** IMAP credentials for an email source. Secret fields are plaintext only in memory. */
export interface EmailCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Used when `authType` is `password`. */
  password: string;
  mailbox: string;
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

/** Rule that maps an incoming SMS-forwarding email to a phone number source. */
export interface PhoneForwardRule {
  emailSourceId: string;
  matchField: MatchField;
  matchKeyword: string;
}

export interface PhoneSourceConfig {
  /** E.164 formatted phone number, e.g. +8613800138000. */
  phoneNumber: string;
  rule: PhoneForwardRule;
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

/** TOTP entry decoded from a QR code — everything except the free-form note. */
export type TotpScanDraft = Omit<TotpSecret, 'note'>;

/** Outcome of scanning a 2FA enrolment QR code (image file or clipboard). */
export interface TotpScanResult {
  ok: boolean;
  message: string;
  /** Present only when `ok` is true. */
  draft?: TotpScanDraft;
}

/**
 * A fully-resolved source as used inside the main process (contains plaintext
 * secrets after decryption). Never send this object to the renderer.
 */
export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
  lastSyncStatus: SyncStatus;
  lastSyncError: string | null;
  email: EmailCredentials | null;
  phone: PhoneSourceConfig | null;
  totp: TotpSecret | null;
}

/** Email credentials safe for the renderer: every secret is stripped out. */
export interface SafeEmailCredentials
  extends Omit<EmailCredentials, 'password' | 'refreshToken' | 'accessToken'> {
  hasPassword: boolean;
  /** True once a Microsoft device-code login succeeded for this source. */
  hasRefreshToken: boolean;
}

export interface SafeTotpSecret extends Omit<TotpSecret, 'secret'> {
  hasSecret: boolean;
}

/** Source representation safe to expose to the renderer (secrets stripped). */
export interface SafeSource extends Omit<Source, 'email' | 'totp'> {
  email: SafeEmailCredentials | null;
  totp: SafeTotpSecret | null;
}

/**
 * Email portion of a create/update payload.
 *
 * `oauthFlowId` is a handle to a completed Microsoft device-code login whose
 * tokens live in the main process; the renderer never sees them. Supplying it
 * is what makes an `oauth2` source usable — without it the source has no way
 * to authenticate.
 */
export interface EmailSourceInput extends Partial<EmailCredentials> {
  oauthFlowId?: string;
}

/** Payload used when creating / updating a source from the renderer. */
export interface SourceInput {
  id?: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  email?: EmailSourceInput | null;
  phone?: PhoneSourceConfig | null;
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

export interface CaptchaMessage {
  id: string;
  sourceId: string;
  sourceKind: SourceKind;
  sourceName: string;
  code: string;
  confidence: number;
  matchedKeyword: string | null;
  expiresAtHint: number | null;
  subject: string;
  from: string;
  summary: string;
  receivedAt: number;
  ingestedAt: number;
  read: boolean;
  /** Unique mail identifier within the source mailbox (IMAP UID). */
  uid: string;
}

export interface MessageFilter {
  search?: string;
  kind?: SourceKind | 'all';
  sourceId?: string | 'all';
  unreadOnly?: boolean;
  sinceMs?: number | null;
  limit?: number;
}

export interface AppSettings {
  theme: ThemeMode;
  /** Polling interval in seconds (clamped between 15 and 600). */
  pollIntervalSec: number;
  launchOnStartup: boolean;
  /** When true the inbox pins codes received within the last 5 minutes to the top. */
  pinRecent: boolean;
}

export interface SourcePreset {
  key: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
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

export interface SourceSyncResult {
  sourceId: string;
  sourceName: string;
  added: number;
  error: string | null;
}

export interface SyncResult {
  startedAt: number;
  finishedAt: number;
  totalAdded: number;
  results: SourceSyncResult[];
}

export interface SyncStatusInfo {
  syncing: boolean;
  lastRun: SyncResult | null;
}

export interface SyncStateEvent {
  syncing: boolean;
  lastRun?: SyncResult | null;
}

export interface BackupBundle {
  version: 1;
  exportedAt: number;
  includeSecrets: boolean;
  sources: SafeSource[];
  messages: CaptchaMessage[];
  settings: AppSettings;
  totpSecrets?: TotpExportItem[];
}

/** The complete, typed surface exposed to the renderer through the preload bridge. */
export interface CaptchaHubApi {
  sources: {
    list(): Promise<SafeSource[]>;
    presets(): Promise<SourcePreset[]>;
    create(input: SourceInput): Promise<SafeSource>;
    update(id: string, input: SourceInput): Promise<SafeSource>;
    remove(id: string): Promise<void>;
    toggle(id: string, enabled: boolean): Promise<SafeSource>;
    test(input: SourceInput): Promise<ConnectionTestResult>;
    /** Starts a Microsoft device-code login; the user approves it in a browser. */
    msLoginStart(email: EmailSourceInput): Promise<MsLoginStartResult>;
    /** Advances the pending login by one poll. Tokens stay in the main process. */
    msLoginPoll(flowId: string): Promise<MsLoginPollResult>;
    /** Abandons a pending login and discards any tokens it collected. */
    msLoginCancel(flowId: string): Promise<void>;
  };
  messages: {
    list(filter?: MessageFilter): Promise<CaptchaMessage[]>;
    markRead(id: string, read: boolean): Promise<void>;
    markAllRead(): Promise<void>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
  totp: {
    list(): Promise<TotpDisplay[]>;
    export(includeSecrets: boolean): Promise<TotpExportItem[]>;
    import(items: TotpExportItem[]): Promise<SafeSource[]>;
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
    now(): Promise<SyncResult>;
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
    newMessages(cb: (messages: CaptchaMessage[]) => void): () => void;
    syncState(cb: (state: SyncStateEvent) => void): () => void;
  };
}
