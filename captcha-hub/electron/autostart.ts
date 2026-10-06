import { app } from 'electron';

/**
 * Windows "launch on startup" toggle.
 * Wrapped in try/catch because the underlying API is a no-op on some platforms
 * and throws if called before the app is ready.
 */
export function applyLoginItem(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
    });
  } catch {
    /* not supported in this environment — silently ignore */
  }
}
