import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * QA-independent STATIC cross-check of the IPC contract + security baseline.
 *
 * It reads the real source files and compares three independently-derived sets
 * (preload bridge, ipcMain handlers, renderer call sites) so that a missing
 * handler or a renderer call to a non-exposed member is caught mechanically.
 */

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Parses a `group: { member(): ... }` object/interface block into a map of
 *  `group.member` -> the accumulated source text of that member. */
function parseApiBlock(src: string, startMarker: string): Map<string, string> {
  const start = src.indexOf(startMarker);
  const map = new Map<string, string>();
  if (start === -1) return map;

  const lines = src.slice(start).split(/\r?\n/);
  let group: string | null = null;
  let current: string | null = null;
  let buffer = '';

  const flush = (): void => {
    if (group && current) map.set(`${group}.${current}`, buffer);
  };

  for (const line of lines) {
    const groupMatch = line.match(/^\s{2}(\w+)\s*:\s*\{\s*$/);
    if (groupMatch) {
      flush();
      group = groupMatch[1];
      current = null;
      buffer = '';
      continue;
    }
    const memberMatch = line.match(/^\s{4}(\w+)\s*[:(]/);
    if (memberMatch && group) {
      flush();
      current = memberMatch[1];
      buffer = line;
      continue;
    }
    buffer += '\n' + line;
  }
  flush();
  return map;
}

function matchAll(src: string, re: RegExp): string[] {
  const out: string[] = [];
  let m = re.exec(src);
  while (m) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

function srcFiles(): string[] {
  const dir = path.join(ROOT, 'src');
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => path.join(dir, f));
}

describe('QA IPC contract — preload vs ipcMain handlers', () => {
  const preload = parseApiBlock(read('electron/preload.ts'), 'const api: MailHubApi = {');
  const ipc = read('electron/ipc.ts');

  const preloadInvokeChannels = new Set(
    [...preload.values()].flatMap((body) => matchAll(body, /invoke\(\s*'([^']+)'/g)),
  );
  const preloadEventChannels = new Set(
    [...preload.values()].flatMap((body) => matchAll(body, /subscribe<[^>]*>\(\s*'([^']+)'/g)),
  );
  const handleChannels = new Set(matchAll(ipc, /ipcMain\.handle\(\s*'([^']+)'/g));

  it('parsed a non-trivial number of channels from both sides', () => {
    expect(preloadInvokeChannels.size).toBeGreaterThanOrEqual(30);
    expect(handleChannels.size).toBeGreaterThanOrEqual(30);
  });

  it('every preload invoke channel has a matching ipcMain.handle', () => {
    const missing = [...preloadInvokeChannels].filter((c) => !handleChannels.has(c)).sort();
    expect(missing).toEqual([]);
  });

  it('every ipcMain.handle channel is actually invoked by the preload bridge', () => {
    const orphan = [...handleChannels].filter((c) => !preloadInvokeChannels.has(c)).sort();
    expect(orphan).toEqual([]);
  });

  it('every preload push-event channel is broadcast by the main process', () => {
    const mainSrc = read('electron/ingest.ts') + read('electron/events.ts');
    const broadcastChannels = new Set(matchAll(mainSrc, /broadcast\(\s*'([^']+)'/g));
    const missing = [...preloadEventChannels].filter((c) => !broadcastChannels.has(c)).sort();
    expect(missing).toEqual([]);
  });
});

describe('QA IPC contract — preload vs shared MailHubApi interface', () => {
  const declared = parseApiBlock(read('shared/types.ts'), 'export interface MailHubApi {');
  const preload = parseApiBlock(read('electron/preload.ts'), 'const api: MailHubApi = {');

  it('preload exposes exactly the members declared in MailHubApi', () => {
    const declaredKeys = [...declared.keys()].sort();
    const exposedKeys = [...preload.keys()].sort();
    expect(exposedKeys).toEqual(declaredKeys);
  });
});

describe('QA IPC contract — renderer call sites vs exposed bridge', () => {
  const preload = parseApiBlock(read('electron/preload.ts'), 'const api: MailHubApi = {');
  const exposed = new Set(preload.keys());

  const used = new Set<string>();
  for (const file of srcFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /\bapi\.(\w+)\.(\w+)/g;
    let m = re.exec(src);
    while (m) {
      used.add(`${m[1]}.${m[2]}`);
      m = re.exec(src);
    }
  }

  it('collected a meaningful set of renderer call sites', () => {
    expect(used.size).toBeGreaterThanOrEqual(15);
  });

  it('every renderer api.X.Y call is exposed by the preload bridge', () => {
    const missing = [...used].filter((k) => !exposed.has(k)).sort();
    expect(missing).toEqual([]);
  });
});

describe('QA security baseline — static checks', () => {
  it('main process enables contextIsolation and disables nodeIntegration', () => {
    const main = read('electron/main.ts');
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });

  it('preload exposes the bridge via contextBridge and uses no fire-and-forget ipcRenderer.send', () => {
    const preload = read('electron/preload.ts');
    expect(preload).toMatch(/contextBridge\.exposeInMainWorld\('api'/);
    expect(preload).not.toMatch(/ipcRenderer\.send\(/);
  });

  it('the TotpDisplay contract carries no raw secret field', () => {
    const types = read('shared/types.ts');
    const start = types.indexOf('export interface TotpDisplay {');
    const block = types.slice(start, types.indexOf('}', start));
    expect(block).not.toMatch(/\bsecret\b/);
  });

  it('sensitive account fields are encrypted at rest via crypto.encryptString', () => {
    const store = read('electron/store.ts');
    expect(store).toMatch(/encryptString\(next\.imap\.password\)/);
    expect(store).toMatch(/encryptString\(next\.imap\.refreshToken\)/);
    expect(store).toMatch(/encryptString\(next\.smtp\.password\)/);
    expect(store).toMatch(/encryptString\(next\.totp\.secret\)/);
  });
});
