import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc } from './ipc';
import { migrate } from './migrate';
import { applyLoginItem } from './autostart';
import { startScheduler, stopScheduler } from './scheduler';
import { getSettings, repairStoredSecrets } from './store';

/**
 * Electron main entry point.
 * Owns the window, IPC registration, background polling and app lifecycle.
 */

/**
 * Last-resort safety net for the main process.
 *
 * This app holds background IMAP/SMTP connections open for hours at a time, so
 * one stray async error — a socket timing out after its handler was released, a
 * rejected promise nobody awaited — must not replace the window with Electron's
 * fatal "A JavaScript error occurred in the main process" dialog.
 *
 * Both handlers log and carry on. Nothing is hidden from the user by doing so:
 * account-level failures are already reported through the per-account sync
 * status. This exists purely so a transport hiccup cannot take the app down.
 */
process.on('uncaughtException', (error) => {
  console.error('[mail-hub] 主进程未捕获异常：', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[mail-hub] 主进程未处理的 Promise 拒绝：', reason);
});

let mainWindow: BrowserWindow | null = null;

/**
 * vite-plugin-electron may emit the preload bundle as `.mjs` or `.js`
 * depending on the resolved module format; resolve defensively.
 */
function resolvePreloadPath(): string {
  const candidates = ['preload.mjs', 'preload.js', 'preload.cjs'].map((file) =>
    path.join(__dirname, file),
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[1];
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    title: '邮件中心 · Mail Hub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Enforce a single running instance so two pollers never fight over the store.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Upgrade any v1 "Captcha Hub" data before anything reads the new store.
    try {
      migrate();
    } catch {
      /* a migration failure must never block startup */
    }

    // Re-seal secrets an older build may have written in the clear. Cheap when
    // there is nothing to fix, and it makes the file clean on the very next
    // boot instead of waiting for each account to be re-saved by hand.
    try {
      repairStoredSecrets();
    } catch {
      /* never block startup over a repair attempt */
    }

    registerIpc();
    createWindow();

    try {
      applyLoginItem(getSettings().launchOnStartup);
    } catch {
      /* startup item is best-effort only */
    }

    startScheduler();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  stopScheduler();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
