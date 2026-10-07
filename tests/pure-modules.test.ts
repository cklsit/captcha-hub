import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architectural guard.
 *
 * Unit tests import these modules directly. If any of them reaches the
 * `electron` package through its local import graph, the whole test file dies
 * on a headless CI runner — CI deliberately sets ELECTRON_SKIP_BINARY_DOWNLOAD
 * for speed, so `require('electron')` throws "Electron failed to install
 * correctly" and the suite fails for a reason that has nothing to do with the
 * code under test. That is exactly what happened once; this test keeps it from
 * happening again.
 *
 * Modules that legitimately need Electron (ipc.ts, store.ts, crypto.ts,
 * main.ts…) must not be imported by unit tests; exercise their pure helpers
 * instead, or move the helper somewhere dependency-free.
 */

const ROOT = process.cwd();

const PURE_ENTRY_POINTS = [
  'electron/extractor.ts',
  'electron/qr.ts',
  'electron/otpauth.ts',
  'electron/ms-oauth.ts',
  'electron/dedupe.ts',
  'electron/totp.ts',
  'electron/imap.ts',
];

const IMPORT_RE = /(?:from\s*|require\(\s*)['"]([^'"]+)['"]/g;
const ELECTRON_IMPORT_RE = /(?:from\s*|require\(\s*)['"]electron['"]/;

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Resolves a relative specifier to an on-disk file, or null when external. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  return (
    [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(isFile) ?? null
  );
}

/** Walks the local import graph starting at `entry`. */
function collectLocalGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const pending = [path.resolve(ROOT, entry)];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);

    const source = readFileSync(current, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const dependency = resolveLocal(current, match[1]);
      if (dependency) pending.push(dependency);
    }
  }

  return visited;
}

describe('纯模块不得依赖 electron', () => {
  it.each(PURE_ENTRY_POINTS)('%s 的本地依赖图中不含 electron', (entry) => {
    const graph = collectLocalGraph(entry);
    const offenders = [...graph].filter((file) =>
      ELECTRON_IMPORT_RE.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders.map((file) => path.relative(ROOT, file)),
      '这些文件（或其本地依赖）导入了 electron，会让无 Electron 二进制的 CI 直接挂掉',
    ).toEqual([]);
  });

  it('至少确实解析到了入口文件本身，避免测试因空图而假通过', () => {
    for (const entry of PURE_ENTRY_POINTS) {
      expect(collectLocalGraph(entry).size).toBeGreaterThan(0);
    }
  });
});
