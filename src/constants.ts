import type { AppSettings } from '../shared/types';

export const POLL_INTERVAL_OPTIONS = [
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 120, label: '2 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
];

/** Renderer-side defaults used before the main process settings load. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  pollIntervalSec: 60,
  launchOnStartup: false,
  pinRecent: true,
  bodyRenderMode: 'html',
  allowRemoteImages: false,
  attachmentDir: '',
  desktopNotifications: false,
  migratedFromV1: false,
  migrationNotice: '',
};
