import type { AppSettings, SourceKind } from '../shared/types';

/** Visual identity for each source kind (label + accent colour). */
export interface KindMeta {
  label: string;
  short: string;
  color: string;
}

export const KIND_META: Record<SourceKind, KindMeta> = {
  email: { label: '邮箱来源', short: '邮箱', color: '#5b8cff' },
  phone: { label: '手机号来源', short: '手机号', color: '#34d399' },
  totp: { label: 'TOTP 验证器', short: '验证器', color: '#a78bfa' },
};

export const POLL_INTERVAL_OPTIONS = [
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 120, label: '2 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
];

export const RECENT_WINDOW_MS = 5 * 60 * 1000;

/** Renderer-side defaults used before the main process settings load. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  pollIntervalSec: 60,
  launchOnStartup: false,
  pinRecent: true,
};
