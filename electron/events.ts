import { BrowserWindow } from 'electron';

/**
 * Fan-out helper for main -> renderer push events (new codes, sync state).
 * Uses only alive windows so a closing window can never throw.
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
