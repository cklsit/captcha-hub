import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { decryptString, encryptString } from './crypto';
import { getPendingTokens, MS_DEFAULT_TENANT } from './ms-oauth';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import { withTotpDefaults } from './totp';
import type {
  Account,
  AccountInput,
  AppSettings,
  BackupBundle,
  EmailAuthType,
  SafeAccount,
  SafeImapCredentials,
  SafeSmtpCredentials,
  SafeTotpEntry,
  SafeTotpSecret,
  SmtpCredentials,
  SyncStatus,
  TotpEntry,
  TotpEntryInput,
  TotpExportItem,
} from '../shared/types';

/**
 * Configuration persistence (accounts / TOTP entries / settings).
 *
 * Storage engine: `electron-store` (pure-JS, JSON file, atomic). We deliberately
 * avoid any native module — a second ABI in `node_modules` would make `npm test`
 * (Node ABI) and `npm run dev` (Electron ABI) mutually exclusive. Secrets are
 * encrypted before they ever hit the disk (see crypto.ts). Mail envelopes and
 * bodies live in `mail-store-core.ts`, not here.
 */

type PersistShape = {
  accounts: Account[];
  totpEntries: TotpEntry[];
  settings: AppSettings;
};

let storeInstance: Store<PersistShape> | null = null;

function store(): Store<PersistShape> {
  if (!storeInstance) {
    storeInstance = new Store<PersistShape>({
      name: 'mail-hub-data',
      defaults: {
        accounts: [],
        totpEntries: [],
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

/**
 * Secrets are encrypted field by field. OAuth tokens matter as much as
 * passwords here: a refresh token is a durable, revocable key to the mailbox,
 * so it must never sit in the JSON file in the clear.
 */
function encryptAccount(account: Account): Account {
  const next = clone(account);
  if (next.imap.password) next.imap.password = encryptString(next.imap.password);
  if (next.imap.refreshToken) next.imap.refreshToken = encryptString(next.imap.refreshToken);
  if (next.imap.accessToken) next.imap.accessToken = encryptString(next.imap.accessToken);
  if (next.smtp && next.smtp.password) next.smtp.password = encryptString(next.smtp.password);
  return next;
}

function decryptAccount(account: Account): Account {
  const next = clone(account);
  if (next.imap.password) next.imap.password = safeDecrypt(next.imap.password);
  if (next.imap.refreshToken) next.imap.refreshToken = safeDecrypt(next.imap.refreshToken);
  if (next.imap.accessToken) next.imap.accessToken = safeDecrypt(next.imap.accessToken);
  if (next.smtp && next.smtp.password) next.smtp.password = safeDecrypt(next.smtp.password);
  return next;
}

function encryptTotpEntry(entry: TotpEntry): TotpEntry {
  const next = clone(entry);
  if (next.totp.secret) next.totp.secret = encryptString(next.totp.secret);
  return next;
}

function decryptTotpEntry(entry: TotpEntry): TotpEntry {
  const next = clone(entry);
  if (next.totp.secret) next.totp.secret = safeDecrypt(next.totp.secret);
  return next;
}

function toSafeAccount(account: Account): SafeAccount {
  const { password, refreshToken, accessToken, ...imapRest } = account.imap;
  const imap: SafeImapCredentials = {
    ...imapRest,
    hasPassword: Boolean(password),
    hasRefreshToken: Boolean(refreshToken),
  };
  let smtp: SafeSmtpCredentials | null = null;
  if (account.smtp) {
    const { password: smtpPassword, ...smtpRest } = account.smtp;
    smtp = { ...smtpRest, hasPassword: Boolean(smtpPassword) };
  }
  return {
    id: account.id,
    name: account.name,
    enabled: account.enabled,
    emailAddress: account.emailAddress,
    displayName: account.displayName,
    imap,
    smtp,
    syncFolders: account.syncFolders,
    signature: account.signature,
    scopes: account.scopes,
    needsReauth: account.needsReauth,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastSyncAt: account.lastSyncAt,
    lastSyncStatus: account.lastSyncStatus,
    lastSyncError: account.lastSyncError,
  };
}

function toSafeTotpEntry(entry: TotpEntry): SafeTotpEntry {
  const { secret, ...rest } = entry.totp;
  const safe: SafeTotpSecret = { ...rest, hasSecret: Boolean(secret) };
  return { ...entry, totp: safe };
}

/* --------------------------------------------------------------- accounts */

/** All accounts with secrets decrypted — MAIN PROCESS ONLY. */
export function getAccounts(): Account[] {
  return store().get('accounts').map(decryptAccount);
}

export function listSafeAccounts(): SafeAccount[] {
  return getAccounts().map(toSafeAccount);
}

export function getAccount(id: string): Account | null {
  return getAccounts().find((account) => account.id === id) ?? null;
}

function buildAccount(input: AccountInput, existing?: Account): Account {
  const now = Date.now();
  const authType: EmailAuthType = input.imap?.authType ?? existing?.imap.authType ?? 'password';
  const keepTokens = authType === 'oauth2';

  const base: Account = existing
    ? clone(existing)
    : {
        id: input.id ?? randomUUID(),
        name: input.name,
        enabled: input.enabled,
        emailAddress: '',
        displayName: '',
        imap: {
          host: '',
          port: 993,
          secure: true,
          username: '',
          password: '',
          authType,
          clientId: '',
          tenant: MS_DEFAULT_TENANT,
          refreshToken: '',
          accessToken: '',
          accessTokenExpiresAt: 0,
        },
        smtp: null,
        syncFolders: ['INBOX'],
        signature: '',
        scopes: [],
        needsReauth: false,
        createdAt: now,
        updatedAt: now,
        lastSyncAt: null,
        lastSyncStatus: 'never',
        lastSyncError: null,
      };

  base.name = input.name.trim() || base.name || '未命名账户';
  base.enabled = input.enabled;
  base.updatedAt = now;

  // Freshly minted tokens (from a just-finished device-code login) replace
  // whatever is stored; otherwise existing tokens are kept so merely editing an
  // account never silently signs the user out.
  const flow = input.imap?.oauthFlowId ? getPendingTokens(input.imap.oauthFlowId) : null;
  if (keepTokens && !flow && !existing?.imap.refreshToken) {
    throw new Error('请先完成 Microsoft 账户登录，再保存该账户。');
  }

  base.imap = {
    host: input.imap?.host ?? existing?.imap.host ?? '',
    port: input.imap?.port ?? existing?.imap.port ?? 993,
    secure: input.imap?.secure ?? existing?.imap.secure ?? true,
    username: input.imap?.username ?? existing?.imap.username ?? '',
    password: input.imap?.password ? input.imap.password : (existing?.imap.password ?? ''),
    authType,
    clientId: input.imap?.clientId?.trim() ?? existing?.imap.clientId ?? '',
    tenant: input.imap?.tenant?.trim() || existing?.imap.tenant || MS_DEFAULT_TENANT,
    // Switching an account back to password auth drops the tokens: keeping a
    // live mailbox key around that the user has just stopped using is a
    // liability, not a convenience.
    refreshToken: keepTokens ? flow?.refreshToken || existing?.imap.refreshToken || '' : '',
    accessToken: keepTokens ? flow?.accessToken || existing?.imap.accessToken || '' : '',
    accessTokenExpiresAt: keepTokens
      ? (flow?.expiresAt ?? existing?.imap.accessTokenExpiresAt ?? 0)
      : 0,
  };

  base.emailAddress = input.emailAddress?.trim() || base.imap.username;
  base.displayName = input.displayName ?? existing?.displayName ?? '';
  base.signature = input.signature ?? existing?.signature ?? '';
  base.syncFolders =
    input.syncFolders && input.syncFolders.length > 0
      ? [...new Set(input.syncFolders)]
      : (existing?.syncFolders ?? ['INBOX']);

  if (flow) {
    base.scopes = flow.scopes;
    base.needsReauth = false;
  } else if (existing) {
    base.scopes = existing.scopes;
    base.needsReauth = existing.needsReauth;
  }

  // SMTP: explicit input wins; otherwise keep what existed. An OAuth account
  // reuses its XOAUTH2 token, so it needs no SMTP password.
  if (input.smtp !== undefined) {
    if (input.smtp === null) {
      base.smtp = null;
    } else {
      const previous = existing?.smtp ?? null;
      const smtpAuth: EmailAuthType =
        input.smtp.authType ?? previous?.authType ?? (authType === 'oauth2' ? 'oauth2' : 'password');
      const smtp: SmtpCredentials = {
        host: input.smtp.host ?? previous?.host ?? base.imap.host,
        port: input.smtp.port ?? previous?.port ?? 465,
        secure: input.smtp.secure ?? previous?.secure ?? true,
        username: input.smtp.username ?? previous?.username ?? base.imap.username,
        password: input.smtp.password ? input.smtp.password : (previous?.password ?? ''),
        authType: smtpAuth,
      };
      base.smtp = smtp;
    }
  }

  return base;
}

export function createAccount(input: AccountInput): SafeAccount {
  const accounts = getAccounts();
  const created = buildAccount(input);
  accounts.push(encryptAccount(created));
  store().set('accounts', accounts);
  return toSafeAccount(created);
}

export function updateAccount(id: string, input: AccountInput): SafeAccount {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) throw new Error(`账户不存在: ${id}`);
  const updated = buildAccount({ ...input, id }, accounts[index]);
  accounts[index] = encryptAccount(updated);
  store().set('accounts', accounts);
  return toSafeAccount(updated);
}

export function deleteAccount(id: string): void {
  store().set(
    'accounts',
    getAccounts().filter((account) => account.id !== id),
  );
}

export function setAccountEnabled(id: string, enabled: boolean): SafeAccount {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) throw new Error(`账户不存在: ${id}`);
  accounts[index].enabled = enabled;
  accounts[index].updatedAt = Date.now();
  const result = accounts[index];
  accounts[index] = encryptAccount(result);
  store().set('accounts', accounts);
  return toSafeAccount(result);
}

export function setAccountSyncFolders(id: string, paths: string[]): SafeAccount {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) throw new Error(`账户不存在: ${id}`);
  const unique = [...new Set(paths.filter((path) => path.length > 0))];
  accounts[index].syncFolders = unique.length > 0 ? unique : ['INBOX'];
  accounts[index].updatedAt = Date.now();
  const result = accounts[index];
  accounts[index] = encryptAccount(result);
  store().set('accounts', accounts);
  return toSafeAccount(result);
}

export function setAccountSyncResult(
  id: string,
  status: SyncStatus,
  error: string | null,
  at: number,
): void {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) return;
  accounts[index].lastSyncAt = at;
  accounts[index].lastSyncStatus = status;
  accounts[index].lastSyncError = error;
  accounts[index] = encryptAccount(accounts[index]);
  store().set('accounts', accounts);
}

/**
 * Persists refreshed OAuth tokens (and the granted scope set) onto an account.
 * Tokens go through the same encryption path as passwords.
 */
export function updateAccountTokens(
  id: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number; scopes?: string[] },
): void {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) return;
  const target = accounts[index];
  target.imap.accessToken = tokens.accessToken;
  if (tokens.refreshToken) target.imap.refreshToken = tokens.refreshToken;
  target.imap.accessTokenExpiresAt = tokens.expiresAt;
  if (tokens.scopes && tokens.scopes.length > 0) target.scopes = tokens.scopes;
  accounts[index] = encryptAccount(target);
  store().set('accounts', accounts);
}

export function setAccountNeedsReauth(id: string, needsReauth: boolean): void {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) return;
  accounts[index].needsReauth = needsReauth;
  accounts[index] = encryptAccount(accounts[index]);
  store().set('accounts', accounts);
}

/** Bulk write used by the migration path (plaintext secrets → encrypted). */
export function replaceAccounts(accounts: Account[]): void {
  store().set('accounts', accounts.map(encryptAccount));
}

/* ------------------------------------------------------------ totp entries */

export function listTotpEntries(): TotpEntry[] {
  return store().get('totpEntries').map(decryptTotpEntry);
}

export function listSafeTotpEntries(): SafeTotpEntry[] {
  return listTotpEntries().map(toSafeTotpEntry);
}

export function getTotpEntry(id: string): TotpEntry | null {
  return listTotpEntries().find((entry) => entry.id === id) ?? null;
}

function buildTotpEntry(input: TotpEntryInput, existing?: TotpEntry): TotpEntry {
  const now = Date.now();
  const previousSecret = existing?.totp.secret ?? '';
  const merged = withTotpDefaults({ ...(existing?.totp ?? {}), ...(input.totp ?? {}) });
  merged.secret = input.totp?.secret ? input.totp.secret : previousSecret;
  return {
    id: existing?.id ?? input.id ?? randomUUID(),
    name: input.name.trim() || existing?.name || merged.issuer || merged.account || '未命名验证器',
    enabled: input.enabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    totp: merged,
  };
}

export function createTotpEntry(input: TotpEntryInput): SafeTotpEntry {
  const entries = listTotpEntries();
  const created = buildTotpEntry(input);
  entries.push(encryptTotpEntry(created));
  store().set('totpEntries', entries);
  return toSafeTotpEntry(created);
}

export function updateTotpEntry(id: string, input: TotpEntryInput): SafeTotpEntry {
  const entries = listTotpEntries();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new Error(`验证器不存在: ${id}`);
  const updated = buildTotpEntry({ ...input, id }, entries[index]);
  entries[index] = encryptTotpEntry(updated);
  store().set('totpEntries', entries);
  return toSafeTotpEntry(updated);
}

export function deleteTotpEntry(id: string): void {
  store().set(
    'totpEntries',
    listTotpEntries().filter((entry) => entry.id !== id),
  );
}

export function replaceTotpEntries(entries: TotpEntry[]): void {
  store().set('totpEntries', entries.map(encryptTotpEntry));
}

/** Export all TOTP secrets (optionally masked) for a user-initiated backup. */
export function exportTotp(includeSecrets: boolean): TotpExportItem[] {
  return listTotpEntries().map((entry) => ({
    name: entry.name,
    issuer: entry.totp.issuer,
    account: entry.totp.account,
    algorithm: entry.totp.algorithm,
    digits: entry.totp.digits,
    period: entry.totp.period,
    secret: includeSecrets ? entry.totp.secret : '',
  }));
}

/** Bulk-import TOTP entries. */
export function importTotp(items: TotpExportItem[]): SafeTotpEntry[] {
  const created: SafeTotpEntry[] = [];
  for (const item of items) {
    if (!item || !item.secret) continue;
    created.push(
      createTotpEntry({
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

/* ---------------------------------------------------------------- settings */

export function getSettings(): AppSettings {
  return mergeSettings(store().get('settings'), undefined);
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = mergeSettings(store().get('settings'), patch);
  store().set('settings', merged);
  return merged;
}

/* ------------------------------------------------------- backup / teardown */

export function exportBackup(includeSecrets: boolean): BackupBundle {
  const accounts = getAccounts();
  const bundle: BackupBundle = {
    version: 2,
    exportedAt: Date.now(),
    includeSecrets,
    // Mail passwords / OAuth tokens are NEVER exported in plaintext — the user
    // re-enters them after a restore. Only TOTP secrets are optionally included.
    accounts: accounts.map(toSafeAccount),
    envelopes: [],
    drafts: [],
    settings: getSettings(),
  };

  if (includeSecrets) {
    bundle.totpSecrets = exportTotp(true);
  }
  return bundle;
}

export function importBackup(bundle: BackupBundle): void {
  if (!bundle || bundle.version !== 2) {
    throw new Error('不支持的备份文件版本（需要 Mail Hub v2 备份）');
  }

  const accounts = getAccounts();
  const existingIds = new Set(accounts.map((account) => account.id));

  for (const safe of bundle.accounts ?? []) {
    const account: Account = {
      id: safe.id && !existingIds.has(safe.id) ? safe.id : randomUUID(),
      name: safe.name,
      enabled: safe.enabled,
      emailAddress: safe.emailAddress,
      displayName: safe.displayName ?? '',
      imap: {
        host: safe.imap.host,
        port: safe.imap.port,
        secure: safe.imap.secure,
        username: safe.imap.username,
        password: '',
        authType: safe.imap.authType ?? 'password',
        clientId: safe.imap.clientId ?? '',
        tenant: safe.imap.tenant ?? MS_DEFAULT_TENANT,
        // Tokens are never exported, so a restored OAuth account must be
        // re-authorised once before it can sync again.
        refreshToken: '',
        accessToken: '',
        accessTokenExpiresAt: 0,
      },
      smtp: safe.smtp
        ? {
            host: safe.smtp.host,
            port: safe.smtp.port,
            secure: safe.smtp.secure,
            username: safe.smtp.username,
            password: '',
            authType: safe.smtp.authType ?? 'password',
          }
        : null,
      syncFolders: safe.syncFolders ?? ['INBOX'],
      signature: safe.signature ?? '',
      scopes: [],
      needsReauth: false,
      createdAt: safe.createdAt || Date.now(),
      updatedAt: Date.now(),
      lastSyncAt: safe.lastSyncAt ?? null,
      lastSyncStatus: 'never',
      lastSyncError: null,
    };
    accounts.push(encryptAccount(account));
    existingIds.add(account.id);
  }
  store().set('accounts', accounts);

  if (Array.isArray(bundle.totpSecrets) && bundle.totpSecrets.length > 0) {
    importTotp(bundle.totpSecrets);
  }
  if (bundle.settings) {
    updateSettings(bundle.settings);
  }
}

export function clearAll(): void {
  store().set('accounts', []);
  store().set('totpEntries', []);
  store().set('settings', { ...DEFAULT_SETTINGS, migratedFromV1: true });
}
