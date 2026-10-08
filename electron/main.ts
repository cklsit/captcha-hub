import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerIpc } from './ipc';
import { migrate } from './migrate';
import { applyLoginItem } from './autostart';
import { startScheduler, stopScheduler } from './scheduler';
import { getSettings } from './store';

/**
 * Electron main entry point.
 * Owns the window, IPC registration, background polling and app lifecycle.
 */

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
