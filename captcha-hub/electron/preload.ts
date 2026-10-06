import { clipboard, contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  BackupBundle,
  CaptchaHubApi,
  CaptchaMessage,
  ConnectionTestResult,
  MessageFilter,
  SafeSource,
  SourceInput,
  SourcePreset,
  SyncResult,
  SyncStateEvent,
  SyncStatusInfo,
  TotpDisplay,
  TotpExportItem,
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

const api: CaptchaHubApi = {
  sources: {
    list: (): Promise<SafeSource[]> => ipcRenderer.invoke('sources:list'),
    presets: (): Promise<SourcePreset[]> => ipcRenderer.invoke('sources:presets'),
    create: (input: SourceInput): Promise<SafeSource> => ipcRenderer.invoke('sources:create', input),
    update: (id: string, input: SourceInput): Promise<SafeSource> =>
      ipcRenderer.invoke('sources:update', id, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('sources:delete', id),
    toggle: (id: string, enabled: boolean): Promise<SafeSource> =>
      ipcRenderer.invoke('sources:toggle', id, enabled),
    test: (input: SourceInput): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('sources:test', input),
  },
  messages: {
    list: (filter?: MessageFilter): Promise<CaptchaMessage[]> =>
      ipcRenderer.invoke('messages:list', filter),
    markRead: (id: string, read: boolean): Promise<void> =>
      ipcRenderer.invoke('messages:markRead', id, read),
    markAllRead: (): Promise<void> => ipcRenderer.invoke('messages:markAllRead'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('messages:delete', id),
    clear: (): Promise<void> => ipcRenderer.invoke('messages:clear'),
  },
  totp: {
    list: (): Promise<TotpDisplay[]> => ipcRenderer.invoke('totp:list'),
    export: (includeSecrets: boolean): Promise<TotpExportItem[]> =>
      ipcRenderer.invoke('totp:export', includeSecrets),
    import: (items: TotpExportItem[]): Promise<SafeSource[]> =>
      ipcRenderer.invoke('totp:import', items),
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
    now: (): Promise<SyncResult> => ipcRenderer.invoke('sync:now'),
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
    platform: process.platform,
    appVersion: process.env.npm_package_version ?? '1.0.0',
  },
  on: {
    newMessages: (callback: (messages: CaptchaMessage[]) => void): (() => void) =>
      subscribe<CaptchaMessage[]>('inbox:new', callback),
    syncState: (callback: (state: SyncStateEvent) => void): (() => void) =>
      subscribe<SyncStateEvent>('sync:state', callback),
  },
};

contextBridge.exposeInMainWorld('api', api);
