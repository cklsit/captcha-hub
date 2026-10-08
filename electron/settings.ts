import type { AppSettings, BodyRenderMode, ThemeMode } from '../shared/types';

/**
 * Pure settings helpers.
 *
 * Kept deliberately free of any Electron / Node import so both `store.ts`
 * (main process) and `migrate-core.ts` (pure, unit-tested) can share a single
 * source of truth for defaults and normalisation.
 */

export const MIN_POLL_SEC = 15;
export const MAX_POLL_SEC = 600;

export const DEFAULT_SETTINGS: AppSettings = {
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

function clampPollSeconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.pollIntervalSec;
  return Math.min(MAX_POLL_SEC, Math.max(MIN_POLL_SEC, Math.round(parsed)));
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

function normalizeRenderMode(value: unknown): BodyRenderMode {
  return value === 'text' ? 'text' : 'html';
}

/**
 * Merges a patch into the current settings, applying validation/clamping.
 * Unknown or malformed fields fall back to the defaults rather than crashing.
 */
export function mergeSettings(
  current: Partial<AppSettings> | undefined,
  patch: Partial<AppSettings> | undefined,
): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(current ?? {}),
    ...(patch ?? {}),
  };
  merged.pollIntervalSec = clampPollSeconds(merged.pollIntervalSec);
  merged.theme = normalizeTheme(merged.theme);
  merged.bodyRenderMode = normalizeRenderMode(merged.bodyRenderMode);
  merged.allowRemoteImages = Boolean(merged.allowRemoteImages);
  merged.launchOnStartup = Boolean(merged.launchOnStartup);
  merged.pinRecent = Boolean(merged.pinRecent);
  merged.desktopNotifications = Boolean(merged.desktopNotifications);
  merged.migratedFromV1 = Boolean(merged.migratedFromV1);
  merged.migrationNotice = typeof merged.migrationNotice === 'string' ? merged.migrationNotice : '';
  merged.attachmentDir = typeof merged.attachmentDir === 'string' ? merged.attachmentDir : '';
  return merged;
}
