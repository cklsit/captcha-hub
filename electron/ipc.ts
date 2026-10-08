import { clipboard, dialog, ipcMain, nativeImage, shell, type NativeImage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import * as store from './store';
import { ACCOUNT_PRESETS } from './presets';
import { deleteMessage, listFolders, moveMessage, setSeen, testImapConnection } from './imap';
import { ensureFreshCredentials } from './mail-auth';
import { downloadAttachment } from './attachments';
import { listDrafts, removeDraft, saveDraft, buildForwardPrefill, buildReplyPrefill } from './drafts';
import { sendMail, verifySmtp } from './smtp';
import { generateTotp } from './totp';
import { parseOtpAuthUri } from './otpauth';
import { cancelLogin, MS_DEFAULT_TENANT, pollLogin, requestDeviceCode } from './ms-oauth';
import { bgraToRgba, decodeQrPixels } from './qr';
import { getSyncStatus, syncAll } from './ingest';
import { getStore } from './mail-service';
import { broadcast } from './events';
import { restartScheduler } from './scheduler';
import { applyLoginItem } from './autostart';
import type {
  Account,
  AccountInput,
  AccountPreset,
  AppSettings,
  AttachmentDownloadResult,
  BackupBundle,
  ComposePayload,
  ConnectionTestResult,
  Draft,
  EmailSourceInput,
  Folder,
  ImapCredentials,
  MailMessage,
  MessageFilter,
  MessageFlags,
  MsLoginPollResult,
  MsLoginStartResult,
  SafeAccount,
  SafeTotpEntry,
  SendResult,
  SyncResult,
  SyncStatusInfo,
  TotpDisplay,
  TotpEntryInput,
  TotpExportItem,
  TotpScanResult,
} from '../shared/types';

/**
 * Every renderer-reachable operation is registered here. Handlers are thin:
 * validation/IO lives in the dedicated modules, this file only wires channels.
 */

/* ---------------------------------------------------------------- TOTP ---- */

function toTotpDisplays(): TotpDisplay[] {
  return store
    .listTotpEntries()
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const result = generateTotp(entry.totp);
      return {
        id: entry.id,
        name: entry.name,
        issuer: entry.totp.issuer,
        account: entry.totp.account,
        code: result.code,
        remaining: result.remaining,
        period: result.period,
        progress: result.progress,
        enabled: entry.enabled,
      };
    });
}

/* ------------------------------------------------------------ account tests */

function emptyAccount(id: string): Account {
  return {
    id,
    name: '',
    enabled: true,
    emailAddress: '',
    displayName: '',
    imap: {
      host: '',
      port: 993,
      secure: true,
      username: '',
      password: '',
      authType: 'password',
      clientId: '',
      tenant: MS_DEFAULT_TENANT,
      refreshToken: '',
      accessToken: '',
      accessTokenExpiresAt: 0,
    },
    smtp: null,
    syncFolders: [],
    signature: '',
    scopes: [],
    needsReauth: false,
    createdAt: 0,
    updatedAt: 0,
    lastSyncAt: null,
    lastSyncStatus: 'never',
    lastSyncError: null,
  };
}

async function testAccount(input: AccountInput): Promise<ConnectionTestResult> {
  const authType = input.imap?.authType ?? 'password';

  // An existing OAuth account is tested with its stored, silently refreshed
  // tokens: the form cannot carry them, and there is no password to type.
  if (authType === 'oauth2' && input.id) {
    const stored = store.getAccount(input.id);
    if (!stored) return { ok: false, message: '账户不存在。' };
    try {
      return await testImapConnection(await ensureFreshCredentials(stored));
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (authType === 'oauth2') {
    return { ok: false, message: '请先点击「使用 Microsoft 账户登录」完成授权并保存，之后即可测试连接。' };
  }

  // When editing a password account the password field may be left blank; fall
  // back to the stored (encrypted) credential so the test still works.
  let password = input.imap?.password ?? '';
  if (!password && input.id) password = store.getAccount(input.id)?.imap.password ?? '';

  const credentials: ImapCredentials = {
    host: input.imap?.host ?? '',
    port: input.imap?.port ?? 993,
    secure: input.imap?.secure ?? true,
    username: input.imap?.username ?? '',
    password,
    authType,
    clientId: input.imap?.clientId ?? '',
    tenant: input.imap?.tenant ?? MS_DEFAULT_TENANT,
    refreshToken: '',
    accessToken: '',
    accessTokenExpiresAt: 0,
  };

  if (!credentials.host || !credentials.username || !credentials.password) {
    return { ok: false, message: '请填写完整的 IMAP 服务器、用户名与授权码。' };
  }
  return testImapConnection(credentials);
}

async function testAccountSmtp(input: AccountInput): Promise<ConnectionTestResult> {
  const smtpInput = input.smtp;
  if (!smtpInput || !smtpInput.host) return { ok: false, message: '请填写 SMTP 服务器地址。' };

  const stored = input.id ? store.getAccount(input.id) : null;
  const authType = smtpInput.authType ?? stored?.smtp?.authType ?? 'password';
  if (authType === 'oauth2' && !stored) {
    return { ok: false, message: '请先完成 Microsoft 账户登录并保存该账户，再测试 SMTP。' };
  }

  const base = stored ?? emptyAccount('temp');
  const candidate: Account = {
    ...base,
    smtp: {
      host: smtpInput.host,
      port: smtpInput.port ?? base.smtp?.port ?? 465,
      secure: smtpInput.secure ?? base.smtp?.secure ?? true,
      username: smtpInput.username ?? base.smtp?.username ?? base.emailAddress,
      password: smtpInput.password || base.smtp?.password || '',
      authType,
    },
  };
  return verifySmtp(candidate);
}

/* -------------------------------------------------------------- folders --- */

async function refreshAccountFolders(accountId: string): Promise<Folder[]> {
  const account = store.getAccount(accountId);
  if (!account) throw new Error('账户不存在');
  const credentials = await ensureFreshCredentials(account);
  const serverFolders = await listFolders(credentials);
  getStore().saveFolders(accountId, serverFolders);
  broadcast('folders:changed', accountId);
  return getStore().listFolders(accountId);
}

/* ------------------------------------------------------------- messages --- */

function getMessage(id: string): MailMessage | null {
  const core = getStore();
  const envelope = core.getEnvelope(id);
  if (!envelope) return null;
  const body = core.readBody(envelope.accountId, envelope.folderId, envelope.uid);
  return {
    id,
    envelope,
    bodyText: body?.text ?? '',
    bodyHtml: body?.safeHtml ?? '',
  };
}

async function credentialsFor(accountId: string): Promise<{ account: Account; imap: ImapCredentials }> {
  const account = store.getAccount(accountId);
  if (!account) throw new Error('邮件所属账户不存在。');
  return { account, imap: await ensureFreshCredentials(account) };
}

async function applyFlags(id: string, flags: Partial<MessageFlags>): Promise<void> {
  const core = getStore();
  const envelope = core.getEnvelope(id);
  if (!envelope) throw new Error('邮件不存在。');

  // Server first: only update the local index once the server accepted it, so
  // a failure never leaves the two out of sync.
  if (flags.seen !== undefined) {
    const { imap } = await credentialsFor(envelope.accountId);
    const folder = core.getFolder(envelope.accountId, envelope.folderId);
    await setSeen(imap, folder?.path ?? envelope.folderId, [envelope.uid], flags.seen);
  }
  core.setFlags(id, flags);
}

async function moveMessageById(id: string, targetFolderId: string): Promise<void> {
  const core = getStore();
  const envelope = core.getEnvelope(id);
  if (!envelope) throw new Error('邮件不存在。');
  const { account, imap } = await credentialsFor(envelope.accountId);
  const folder = core.getFolder(account.id, envelope.folderId);
  const target = core.getFolder(account.id, targetFolderId);
  await moveMessage(imap, folder?.path ?? envelope.folderId, envelope.uid, target?.path ?? targetFolderId);
  core.moveMessage(id, targetFolderId);
  broadcast('folders:changed', account.id);
}

async function removeMessage(id: string): Promise<void> {
  const core = getStore();
  const envelope = core.getEnvelope(id);
  if (!envelope) return;
  const { account, imap } = await credentialsFor(envelope.accountId);
  const folder = core.getFolder(account.id, envelope.folderId);
  await deleteMessage(imap, folder?.path ?? envelope.folderId, envelope.uid);
  core.deleteMessage(id);
  broadcast('folders:changed', account.id);
}

/* --------------------------------------------------------------- compose --- */

async function send(payload: ComposePayload): Promise<SendResult> {
  const account = store.getAccount(payload.accountId);
  if (!account) return { ok: false, message: '发件账户不存在。' };
  const result = await sendMail(payload, account);
  if (result.ok && payload.draftId) removeDraft(payload.draftId);
  if (result.ok) broadcast('folders:changed', account.id);
  return result;
}

/* ----------------------------------------------------------------- settings */

function applySettings(patch: Partial<AppSettings>): AppSettings {
  const updated = store.updateSettings(patch);
  if (patch.pollIntervalSec !== undefined) restartScheduler();
  if (patch.launchOnStartup !== undefined) applyLoginItem(updated.launchOnStartup);
  return updated;
}

/**
 * Kicks off a sync the moment an account is added, edited or switched on, so
 * the mailbox fills itself without the user pressing 立即同步. Deliberately not
 * awaited: the dialog must close instantly and any failure is recorded per
 * account and rendered in the account list.
 */
function syncInBackground(): void {
  void syncAll().catch(() => {
    /* per-account sync errors are persisted by ingest.ts */
  });
}

/* ------------------------------------------------------------------- QR ---- */

function decodeQrFromImage(image: NativeImage): string | null {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return null;

  const direct = decodeQrPixels(bgraToRgba(image.toBitmap()), size.width, size.height);
  if (direct) return direct;

  const scaled = image.resize({ width: size.width * 2, height: size.height * 2, quality: 'best' });
  const scaledSize = scaled.getSize();
  return decodeQrPixels(bgraToRgba(scaled.toBitmap()), scaledSize.width, scaledSize.height);
}

function toScanResult(payload: string | null): TotpScanResult {
  if (!payload) {
    return {
      ok: false,
      message: '没有在图片中识别到二维码。请换一张更清晰、且四周留有白边的截图重试。',
    };
  }
  const draft = parseOtpAuthUri(payload);
  if (!draft) {
    // The payload is never echoed back — it would leak the TOTP secret into the UI.
    return {
      ok: false,
      message:
        '识别到的二维码不是 TOTP 配置。本应用只支持 otpauth://totp 开头的二维码（Google Authenticator、Authy、1Password 等生成的即是）。',
    };
  }
  const label = draft.issuer || draft.account || '未命名验证器';
  return { ok: true, message: `已从二维码读取：${label}`, draft };
}

async function scanTotpQrFromFile(): Promise<TotpScanResult> {
  const result = await dialog.showOpenDialog({
    title: '选择包含 2FA 二维码的图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: '已取消选择图片。' };
  }
  const image = nativeImage.createFromPath(result.filePaths[0]);
  if (image.isEmpty()) {
    return { ok: false, message: '无法读取该图片文件，请确认格式为 PNG / JPG / WEBP。' };
  }
  return toScanResult(decodeQrFromImage(image));
}

function scanTotpQrFromClipboard(): TotpScanResult {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { ok: false, message: '剪贴板里没有图片。请先截图或复制二维码图片，再点此按钮。' };
  }
  return toScanResult(decodeQrFromImage(image));
}

/* ------------------------------------------------------------------ wiring */

export function registerIpc(): void {
  // --- accounts ------------------------------------------------------------
  ipcMain.handle('accounts:list', (): SafeAccount[] => store.listSafeAccounts());
  ipcMain.handle('accounts:presets', (): AccountPreset[] => ACCOUNT_PRESETS);
  ipcMain.handle('accounts:create', (_event, input: AccountInput): SafeAccount => {
    const created = store.createAccount(input);
    if (created.enabled) syncInBackground();
    return created;
  });
  ipcMain.handle('accounts:update', (_event, id: string, input: AccountInput): SafeAccount => {
    const updated = store.updateAccount(id, input);
    if (updated.enabled) syncInBackground();
    return updated;
  });
  ipcMain.handle('accounts:delete', (_event, id: string): void => {
    store.deleteAccount(id);
    getStore().deleteAccount(id);
  });
  ipcMain.handle('accounts:toggle', (_event, id: string, enabled: boolean): SafeAccount => {
    const toggled = store.setAccountEnabled(id, enabled);
    if (toggled.enabled) syncInBackground();
    return toggled;
  });
  ipcMain.handle('accounts:test', (_event, input: AccountInput): Promise<ConnectionTestResult> =>
    testAccount(input),
  );
  ipcMain.handle('accounts:testSmtp', (_event, input: AccountInput): Promise<ConnectionTestResult> =>
    testAccountSmtp(input),
  );
  ipcMain.handle('accounts:folders', (_event, id: string): Promise<Folder[]> =>
    refreshAccountFolders(id),
  );
  ipcMain.handle(
    'accounts:msLoginStart',
    (_event, email: EmailSourceInput): Promise<MsLoginStartResult> =>
      requestDeviceCode(email.clientId ?? '', email.tenant ?? MS_DEFAULT_TENANT),
  );
  ipcMain.handle(
    'accounts:msLoginPoll',
    (_event, flowId: string): Promise<MsLoginPollResult> => pollLogin(flowId),
  );
  ipcMain.handle('accounts:msLoginCancel', (_event, flowId: string): void => {
    cancelLogin(flowId);
  });

  // --- folders -------------------------------------------------------------
  ipcMain.handle('folders:list', (_event, accountId?: string): Folder[] =>
    getStore().listFolders(accountId),
  );
  ipcMain.handle('folders:setSubscribed', (_event, accountId: string, paths: string[]): Folder[] => {
    store.setAccountSyncFolders(accountId, paths);
    return getStore().setSubscribed(accountId, paths);
  });
  ipcMain.handle('folders:refresh', (_event, accountId: string): Promise<Folder[]> =>
    refreshAccountFolders(accountId),
  );

  // --- messages ------------------------------------------------------------
  ipcMain.handle('messages:list', (_event, filter?: MessageFilter) =>
    getStore().listEnvelopes(filter),
  );
  ipcMain.handle('messages:get', (_event, id: string): MailMessage | null => getMessage(id));
  ipcMain.handle('messages:setFlags', (_event, id: string, flags: Partial<MessageFlags>): Promise<void> =>
    applyFlags(id, flags),
  );
  ipcMain.handle('messages:move', (_event, id: string, targetFolderId: string): Promise<void> =>
    moveMessageById(id, targetFolderId),
  );
  ipcMain.handle('messages:delete', (_event, id: string): Promise<void> => removeMessage(id));
  ipcMain.handle('messages:clear', (): void => {
    getStore().clearEnvelopes();
  });
  ipcMain.handle('messages:markAllRead', (_event, filter?: MessageFilter): void => {
    const core = getStore();
    for (const envelope of core.listEnvelopes(filter)) core.setFlags(envelope.id, { seen: true });
  });
  ipcMain.handle('messages:searchBodies', (_event, search: string, limit?: number): string[] =>
    getStore().scanBodies(undefined, search, undefined, { limit }),
  );

  // --- attachments ---------------------------------------------------------
  ipcMain.handle(
    'attachments:download',
    (_event, messageId: string, partId: string): Promise<AttachmentDownloadResult> =>
      downloadAttachment(messageId, partId),
  );

  // --- compose -------------------------------------------------------------
  ipcMain.handle('compose:send', (_event, payload: ComposePayload): Promise<SendResult> =>
    send(payload),
  );
  ipcMain.handle('compose:saveDraft', (_event, payload: ComposePayload): Draft => saveDraft(payload));
  ipcMain.handle('compose:listDrafts', (_event, accountId?: string): Draft[] => listDrafts(accountId));
  ipcMain.handle('compose:removeDraft', (_event, id: string): void => removeDraft(id));
  ipcMain.handle('compose:replyPrefill', (_event, messageId: string): ComposePayload | null =>
    buildReplyPrefill(messageId),
  );
  ipcMain.handle('compose:forwardPrefill', (_event, messageId: string): ComposePayload | null =>
    buildForwardPrefill(messageId),
  );

  // --- TOTP ----------------------------------------------------------------
  ipcMain.handle('totp:list', (): TotpDisplay[] => toTotpDisplays());
  ipcMain.handle('totp:create', (_event, input: TotpEntryInput): SafeTotpEntry =>
    store.createTotpEntry(input),
  );
  ipcMain.handle('totp:update', (_event, id: string, input: TotpEntryInput): SafeTotpEntry =>
    store.updateTotpEntry(id, input),
  );
  ipcMain.handle('totp:remove', (_event, id: string): void => store.deleteTotpEntry(id));
  ipcMain.handle('totp:export', (_event, includeSecrets: boolean): TotpExportItem[] =>
    store.exportTotp(includeSecrets),
  );
  ipcMain.handle('totp:import', (_event, items: TotpExportItem[]): SafeTotpEntry[] =>
    store.importTotp(items),
  );
  ipcMain.handle('totp:scanImage', (): Promise<TotpScanResult> => scanTotpQrFromFile());
  ipcMain.handle('totp:scanClipboard', (): TotpScanResult => scanTotpQrFromClipboard());

  // --- settings ------------------------------------------------------------
  ipcMain.handle('settings:get', (): AppSettings => store.getSettings());
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>): AppSettings =>
    applySettings(patch),
  );
  ipcMain.handle('settings:export', (_event, includeSecrets: boolean): BackupBundle => {
    const bundle = store.exportBackup(includeSecrets);
    bundle.envelopes = getStore().listEnvelopes();
    bundle.drafts = getStore().listDrafts();
    return bundle;
  });
  ipcMain.handle('settings:import', (_event, bundle: BackupBundle): void => {
    store.importBackup(bundle);
  });
  ipcMain.handle('settings:clearAll', (): void => {
    store.clearAll();
    getStore().clearAll();
  });

  // --- sync ----------------------------------------------------------------
  ipcMain.handle('sync:now', (_event, accountId?: string): Promise<SyncResult> => syncAll(accountId));
  ipcMain.handle('sync:status', (): SyncStatusInfo => getSyncStatus());

  // --- system (file dialogs) ----------------------------------------------
  ipcMain.handle(
    'system:saveText',
    async (_event, defaultName: string, content: string): Promise<{ saved: boolean; path?: string }> => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await writeFile(result.filePath, content, 'utf8');
      return { saved: true, path: result.filePath };
    },
  );
  ipcMain.handle(
    'system:openText',
    async (): Promise<{ canceled: boolean; content?: string; path?: string }> => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      const content = await readFile(result.filePaths[0], 'utf8');
      return { canceled: false, content, path: result.filePaths[0] };
    },
  );
  ipcMain.handle('system:openExternal', async (_event, url: string): Promise<boolean> => {
    // Only https: the renderer can be influenced by scanned QR payloads and the
    // OAuth flow, neither of which should ever reach file:// or a custom scheme.
    if (!/^https:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}
