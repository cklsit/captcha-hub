import { clipboard, contextBridge, ipcRenderer } from 'electron';
import type {
  AccountInput,
  AccountPreset,
  AppSettings,
  AttachmentDownloadResult,
  BackupBundle,
  ComposePayload,
  ConnectionTestResult,
  Draft,
  EmailSourceInput,
  Envelope,
  Folder,
  MailHubApi,
  MailMessage,
  MessageFilter,
  MessageFlags,
  MsLoginPollResult,
  MsLoginStartResult,
  SafeAccount,
  SafeTotpEntry,
  SendResult,
  SyncResult,
  SyncStateEvent,
  SyncStatusInfo,
  TotpDisplay,
  TotpEntryInput,
  TotpExportItem,
  TotpScanResult,
} from '../shared/types';

/**
 * Preload bridge. The renderer has NO direct Node access — everything it can do
 * is enumerated below and runs in the main process via ipcRenderer.invoke.
 */

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener as never);
  return () => {
    ipcRenderer.removeListener(channel, listener as never);
  };
}

const api: MailHubApi = {
  accounts: {
    list: (): Promise<SafeAccount[]> => ipcRenderer.invoke('accounts:list'),
    presets: (): Promise<AccountPreset[]> => ipcRenderer.invoke('accounts:presets'),
    create: (input: AccountInput): Promise<SafeAccount> => ipcRenderer.invoke('accounts:create', input),
    update: (id: string, input: AccountInput): Promise<SafeAccount> =>
      ipcRenderer.invoke('accounts:update', id, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('accounts:delete', id),
    toggle: (id: string, enabled: boolean): Promise<SafeAccount> =>
      ipcRenderer.invoke('accounts:toggle', id, enabled),
    test: (input: AccountInput): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('accounts:test', input),
    testSmtp: (input: AccountInput): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('accounts:testSmtp', input),
    folders: (id: string): Promise<Folder[]> => ipcRenderer.invoke('accounts:folders', id),
    msLoginStart: (email: EmailSourceInput): Promise<MsLoginStartResult> =>
      ipcRenderer.invoke('accounts:msLoginStart', email),
    msLoginPoll: (flowId: string): Promise<MsLoginPollResult> =>
      ipcRenderer.invoke('accounts:msLoginPoll', flowId),
    msLoginCancel: (flowId: string): Promise<void> =>
      ipcRenderer.invoke('accounts:msLoginCancel', flowId),
  },
  folders: {
    list: (accountId?: string): Promise<Folder[]> => ipcRenderer.invoke('folders:list', accountId),
    setSubscribed: (accountId: string, paths: string[]): Promise<Folder[]> =>
      ipcRenderer.invoke('folders:setSubscribed', accountId, paths),
    refresh: (accountId: string): Promise<Folder[]> => ipcRenderer.invoke('folders:refresh', accountId),
  },
  messages: {
    list: (filter?: MessageFilter): Promise<Envelope[]> => ipcRenderer.invoke('messages:list', filter),
    get: (id: string): Promise<MailMessage | null> => ipcRenderer.invoke('messages:get', id),
    setFlags: (id: string, flags: Partial<MessageFlags>): Promise<void> =>
      ipcRenderer.invoke('messages:setFlags', id, flags),
    move: (id: string, targetFolderId: string): Promise<void> =>
      ipcRenderer.invoke('messages:move', id, targetFolderId),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('messages:delete', id),
    clear: (): Promise<void> => ipcRenderer.invoke('messages:clear'),
    markAllRead: (filter?: MessageFilter): Promise<void> =>
      ipcRenderer.invoke('messages:markAllRead', filter),
    searchBodies: (search: string, limit?: number): Promise<string[]> =>
      ipcRenderer.invoke('messages:searchBodies', search, limit),
  },
  attachments: {
    download: (messageId: string, partId: string): Promise<AttachmentDownloadResult> =>
      ipcRenderer.invoke('attachments:download', messageId, partId),
  },
  compose: {
    send: (payload: ComposePayload): Promise<SendResult> => ipcRenderer.invoke('compose:send', payload),
    saveDraft: (payload: ComposePayload): Promise<Draft> =>
      ipcRenderer.invoke('compose:saveDraft', payload),
    listDrafts: (accountId?: string): Promise<Draft[]> =>
      ipcRenderer.invoke('compose:listDrafts', accountId),
    removeDraft: (id: string): Promise<void> => ipcRenderer.invoke('compose:removeDraft', id),
    replyPrefill: (messageId: string): Promise<ComposePayload | null> =>
      ipcRenderer.invoke('compose:replyPrefill', messageId),
    forwardPrefill: (messageId: string): Promise<ComposePayload | null> =>
      ipcRenderer.invoke('compose:forwardPrefill', messageId),
  },
  totp: {
    list: (): Promise<TotpDisplay[]> => ipcRenderer.invoke('totp:list'),
    create: (input: TotpEntryInput): Promise<SafeTotpEntry> => ipcRenderer.invoke('totp:create', input),
    update: (id: string, input: TotpEntryInput): Promise<SafeTotpEntry> =>
      ipcRenderer.invoke('totp:update', id, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('totp:remove', id),
    export: (includeSecrets: boolean): Promise<TotpExportItem[]> =>
      ipcRenderer.invoke('totp:export', includeSecrets),
    import: (items: TotpExportItem[]): Promise<SafeTotpEntry[]> =>
      ipcRenderer.invoke('totp:import', items),
    scanImage: (): Promise<TotpScanResult> => ipcRenderer.invoke('totp:scanImage'),
    scanClipboard: (): Promise<TotpScanResult> => ipcRenderer.invoke('totp:scanClipboard'),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', patch),
    export: (includeSecrets: boolean): Promise<BackupBundle> =>
      ipcRenderer.invoke('settings:export', includeSecrets),
    import: (bundle: BackupBundle): Promise<void> => ipcRenderer.invoke('settings:import', bundle),
    clearAll: (): Promise<void> => ipcRenderer.invoke('settings:clearAll'),
  },
  sync: {
    now: (accountId?: string): Promise<SyncResult> => ipcRenderer.invoke('sync:now', accountId),
    status: (): Promise<SyncStatusInfo> => ipcRenderer.invoke('sync:status'),
  },
  system: {
    copy: (text: string): void => clipboard.writeText(text),
    saveTextFile: (
      defaultName: string,
      content: string,
    ): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke('system:saveText', defaultName, content),
    openTextFile: (): Promise<{ canceled: boolean; content?: string; path?: string }> =>
      ipcRenderer.invoke('system:openText'),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:openExternal', url),
    platform: process.platform,
    appVersion: process.env.npm_package_version ?? '1.0.0',
  },
  on: {
    newMessages: (callback: (envelopes: Envelope[]) => void): (() => void) =>
      subscribe<Envelope[]>('mail:new', callback),
    syncState: (callback: (state: SyncStateEvent) => void): (() => void) =>
      subscribe<SyncStateEvent>('sync:state', callback),
    foldersChanged: (callback: (accountId: string) => void): (() => void) =>
      subscribe<string>('folders:changed', callback),
  },
};

contextBridge.exposeInMainWorld('api', api);
