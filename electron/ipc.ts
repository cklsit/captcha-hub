import { clipboard, dialog, ipcMain, nativeImage, shell, type NativeImage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import * as store from './store';
import { SOURCE_PRESETS } from './presets';
import { testImapConnection } from './imap';
import { ensureFreshCredentials } from './mail-auth';
import { generateTotp } from './totp';
import { parseOtpAuthUri } from './otpauth';
import { cancelLogin, MS_DEFAULT_TENANT, pollLogin, requestDeviceCode } from './ms-oauth';
import { bgraToRgba, decodeQrPixels } from './qr';
import { getSyncStatus, syncAll } from './ingest';
import { restartScheduler } from './scheduler';
import { applyLoginItem } from './autostart';
import type {
  AppSettings,
  BackupBundle,
  CaptchaMessage,
  ConnectionTestResult,
  EmailCredentials,
  EmailSourceInput,
  MessageFilter,
  MsLoginPollResult,
  MsLoginStartResult,
  SafeSource,
  SourceInput,
  SourcePreset,
  SyncResult,
  SyncStatusInfo,
  TotpDisplay,
  TotpExportItem,
  TotpScanResult,
} from '../shared/types';

/**
 * Every renderer-reachable operation is registered here. Handlers are thin:
 * validation/IO lives in the dedicated modules, this file only wires channels.
 */

function toTotpDisplays(): TotpDisplay[] {
  return store
    .getSources()
    .filter((source) => source.kind === 'totp' && source.totp && source.enabled)
    .map((source) => {
      const result = generateTotp(source.totp!);
      return {
        id: source.id,
        name: source.name,
        issuer: source.totp!.issuer,
        account: source.totp!.account,
        code: result.code,
        remaining: result.remaining,
        period: result.period,
        progress: result.progress,
        enabled: source.enabled,
      };
    });
}

async function testSource(input: SourceInput): Promise<ConnectionTestResult> {
  if (input.kind !== 'email') {
    return { ok: false, message: '只有“邮箱来源”支持连接测试。' };
  }

  const authType = input.email?.authType ?? 'password';

  // An existing OAuth source is tested with its stored, silently refreshed
  // tokens: the form cannot carry them, and there is no password to type.
  if (authType === 'oauth2' && input.id) {
    const stored = store.getSource(input.id);
    if (!stored?.email) return { ok: false, message: '来源不存在。' };
    try {
      return await testImapConnection(await ensureFreshCredentials(stored));
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  if (authType === 'oauth2') {
    return {
      ok: false,
      message: '请先点击「使用 Microsoft 账户登录」完成授权并保存，之后即可测试连接。',
    };
  }

  // When editing a password source the password field may be left blank; fall
  // back to the stored (encrypted) credential so the test still works.
  let password = input.email?.password ?? '';
  if (!password && input.id) {
    password = store.getSource(input.id)?.email?.password ?? '';
  }

  const credentials: EmailCredentials = {
    host: input.email?.host ?? '',
    port: input.email?.port ?? 993,
    secure: input.email?.secure ?? true,
    username: input.email?.username ?? '',
    password,
    mailbox: input.email?.mailbox || 'INBOX',
    authType,
    clientId: input.email?.clientId ?? '',
    tenant: input.email?.tenant ?? MS_DEFAULT_TENANT,
    refreshToken: '',
    accessToken: '',
    accessTokenExpiresAt: 0,
  };

  if (!credentials.host || !credentials.username || !credentials.password) {
    return { ok: false, message: '请填写完整的 IMAP 服务器、用户名与授权码。' };
  }

  return testImapConnection(credentials);
}

function applySettings(patch: Partial<AppSettings>): AppSettings {
  const updated = store.updateSettings(patch);
  if (patch.pollIntervalSec !== undefined) {
    restartScheduler();
  }
  if (patch.launchOnStartup !== undefined) {
    applyLoginItem(updated.launchOnStartup);
  }
  return updated;
}

/**
 * Kicks off a sync the moment a source is added, edited or switched on, so the
 * inbox fills itself without the user having to press 立即同步.
 *
 * Deliberately not awaited and never surfaced as a dialog: the create/edit
 * dialog must close instantly, and any failure is already recorded per source
 * by the ingest layer and rendered in the source list.
 */
function syncInBackground(): void {
  void syncAll().catch(() => {
    /* per-source sync errors are persisted by ingest.ts */
  });
}

/**
 * Decodes the first QR code found in a bitmap.
 *
 * A screenshot pasted at 100% is frequently only ~200px across, which jsQR
 * decodes unreliably, so a 2× upscale is retried before admitting defeat.
 */
function decodeQrFromImage(image: NativeImage): string | null {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return null;

  const direct = decodeQrPixels(bgraToRgba(image.toBitmap()), size.width, size.height);
  if (direct) return direct;

  const scaled = image.resize({
    width: size.width * 2,
    height: size.height * 2,
    quality: 'best',
  });
  const scaledSize = scaled.getSize();
  return decodeQrPixels(bgraToRgba(scaled.toBitmap()), scaledSize.width, scaledSize.height);
}

/** Turns a scanned payload into a form prefill, or an actionable failure. */
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

export function registerIpc(): void {
  // --- sources -------------------------------------------------------------
  ipcMain.handle('sources:list', (): SafeSource[] => store.listSafeSources());
  ipcMain.handle('sources:presets', (): SourcePreset[] => SOURCE_PRESETS);
  ipcMain.handle('sources:create', (_event, input: SourceInput): SafeSource => {
    const created = store.createSource(input);
    if (created.kind === 'email' && created.enabled) syncInBackground();
    return created;
  });
  ipcMain.handle('sources:update', (_event, id: string, input: SourceInput): SafeSource => {
    const updated = store.updateSource(id, input);
    if (updated.kind === 'email' && updated.enabled) syncInBackground();
    return updated;
  });
  ipcMain.handle('sources:delete', (_event, id: string): void => {
    store.deleteSource(id);
  });
  ipcMain.handle('sources:toggle', (_event, id: string, enabled: boolean): SafeSource => {
    const toggled = store.setSourceEnabled(id, enabled);
    if (toggled.kind === 'email' && toggled.enabled) syncInBackground();
    return toggled;
  });
  ipcMain.handle('sources:test', (_event, input: SourceInput): Promise<ConnectionTestResult> =>
    testSource(input),
  );
  ipcMain.handle(
    'sources:msLoginStart',
    (_event, email: EmailSourceInput): Promise<MsLoginStartResult> =>
      requestDeviceCode(email.clientId ?? '', email.tenant ?? MS_DEFAULT_TENANT),
  );
  ipcMain.handle(
    'sources:msLoginPoll',
    (_event, flowId: string): Promise<MsLoginPollResult> => pollLogin(flowId),
  );
  ipcMain.handle('sources:msLoginCancel', (_event, flowId: string): void => {
    cancelLogin(flowId);
  });

  // --- messages ------------------------------------------------------------
  ipcMain.handle('messages:list', (_event, filter?: MessageFilter): CaptchaMessage[] =>
    store.listMessages(filter),
  );
  ipcMain.handle('messages:markRead', (_event, id: string, read: boolean): void => {
    store.setMessageRead(id, read);
  });
  ipcMain.handle('messages:markAllRead', (): void => {
    store.markAllMessagesRead();
  });
  ipcMain.handle('messages:delete', (_event, id: string): void => {
    store.deleteMessage(id);
  });
  ipcMain.handle('messages:clear', (): void => {
    store.clearMessages();
  });

  // --- TOTP ----------------------------------------------------------------
  ipcMain.handle('totp:list', (): TotpDisplay[] => toTotpDisplays());
  ipcMain.handle('totp:export', (_event, includeSecrets: boolean): TotpExportItem[] =>
    store.exportTotp(includeSecrets),
  );
  ipcMain.handle('totp:import', (_event, items: TotpExportItem[]): SafeSource[] =>
    store.importTotp(items),
  );
  ipcMain.handle('totp:scanImage', (): Promise<TotpScanResult> => scanTotpQrFromFile());
  ipcMain.handle('totp:scanClipboard', (): TotpScanResult => scanTotpQrFromClipboard());

  // --- settings ------------------------------------------------------------
  ipcMain.handle('settings:get', (): AppSettings => store.getSettings());
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>): AppSettings =>
    applySettings(patch),
  );
  ipcMain.handle('settings:export', (_event, includeSecrets: boolean): BackupBundle =>
    store.exportBackup(includeSecrets),
  );
  ipcMain.handle('settings:import', (_event, bundle: BackupBundle): void => {
    store.importBackup(bundle);
  });
  ipcMain.handle('settings:clearAll', (): void => {
    store.clearAll();
  });

  // --- sync ----------------------------------------------------------------
  ipcMain.handle('sync:now', (): Promise<SyncResult> => syncAll());
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
