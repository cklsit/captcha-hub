import { syncAll } from './ingest';
import { getSettings } from './store';

/**
 * Background polling scheduler.
 *
 * A single timer drives the ingestion loop; the interval is sourced from user
 * settings and clamped to a sane [15s, 600s] range. It can be restarted at
 * runtime whenever the poll interval changes.
 */

const MIN_INTERVAL_SEC = 15;
const MAX_INTERVAL_SEC = 600;
const INITIAL_DELAY_MS = 4000;

let pollTimer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(seconds)));
}

export function stopScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
}

export function startScheduler(): void {
  stopScheduler();
  const { pollIntervalSec } = getSettings();
  const intervalMs = clampInterval(pollIntervalSec) * 1000;

  // Kick off a first sync shortly after launch, then poll on the interval.
  initialTimer = setTimeout(() => {
    void syncAll();
  }, INITIAL_DELAY_MS);

  pollTimer = setInterval(() => {
    void syncAll();
  }, intervalMs);
}

export function restartScheduler(): void {
  startScheduler();
}
