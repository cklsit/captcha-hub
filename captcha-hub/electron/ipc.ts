import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import * as store from './store';
import { SOURCE_PRESETS } from './presets';
import { testImapConnection } from './imap';
import { generateTotp } from './totp';
import { getSyncStatus, syncAll } from './ingest';
import { restartScheduler } from './scheduler';
import { applyLoginItem } from './autostart';
import type {
  AppSettings,
  BackupBundle,
  CaptchaMessage,
  ConnectionTestResult,
  EmailCredentials,
  MessageFilter,
  SafeSource,
  SourceInput,
  SourcePreset,
  SyncResult,
  SyncStatusInfo,
  TotpDisplay,
  TotpExportItem,
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

  // When editing an existing source the password field may be left blank; fall
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

export function registerIpc(): void {
  // --- sources -------------------------------------------------------------
  ipcMain.handle('sources:list', (): SafeSource[] => store.listSafeSources());
  ipcMain.handle('sources:presets', (): SourcePreset[] => SOURCE_PRESETS);
  ipcMain.handle('sources:create', (_event, input: SourceInput): SafeSource =>
    store.createSource(input),
  );
  ipcMain.handle('sources:update', (_event, id: string, input: SourceInput): SafeSource =>
    store.updateSource(id, input),
  );
  ipcMain.handle('sources:delete', (_event, id: string): void => {
    store.deleteSource(id);
  });
  ipcMain.handle('sources:toggle', (_event, id: string, enabled: boolean): SafeSource =>
    store.setSourceEnabled(id, enabled),
  );
  ipcMain.handle('sources:test', (_event, input: SourceInput): Promise<ConnectionTestResult> =>
    testSource(input),
  );

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
}
