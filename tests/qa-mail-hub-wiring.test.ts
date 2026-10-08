import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * QA-independent *behavioural wiring* check (static, source-level).
 *
 * The transformation deleted CodeCard / SourceForm / Inbox / Sources and moved
 * their capabilities elsewhere. This file pins that the capabilities really
 * survived: the TOTP create/edit/delete/scan entry points, the one-click copy
 * path, and the removal of the deleted files. It also cross-checks the
 * `totp.*` contract member-for-member between the three parties.
 */

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

/** Extracts `group.member` keys from a `group: { member(): ... }` block. */
function apiMembers(src: string, startMarker: string): Set<string> {
  const start = src.indexOf(startMarker);
  const keys = new Set<string>();
  if (start === -1) return keys;
  let group: string | null = null;
  for (const line of src.slice(start).split(/\r?\n/)) {
    const groupMatch = line.match(/^\s{2}(\w+)\s*:\s*\{\s*$/);
    if (groupMatch) {
      group = groupMatch[1];
      continue;
    }
    const memberMatch = line.match(/^\s{4}(\w+)\s*[:(]/);
    if (memberMatch && group) keys.add(`${group}.${memberMatch[1]}`);
  }
  return keys;
}

describe('QA 渲染层——被删除功能的善后', () => {
  it('旧的 CodeCard / SourceForm / Inbox / Sources 已删除', () => {
    for (const gone of [
      'src/components/CodeCard.tsx',
      'src/components/SourceForm.tsx',
      'src/pages/Inbox.tsx',
      'src/pages/Sources.tsx',
    ]) {
      expect(exists(gone), `${gone} 应已删除`).toBe(false);
    }
  });

  it('替代组件确实存在', () => {
    for (const present of [
      'src/components/CodeHighlight.tsx',
      'src/components/TotpForm.tsx',
      'src/pages/Mail.tsx',
      'src/pages/Accounts.tsx',
    ]) {
      expect(exists(present), `${present} 应存在`).toBe(true);
    }
  });

  it('TOTP 新建 / 编辑 / 删除 / 导入导出 在验证器页仍有入口', () => {
    const src = read('src/pages/Authenticator.tsx');
    expect(src).toMatch(/api\.totp\.create\(/);
    expect(src).toMatch(/api\.totp\.update\(/);
    expect(src).toMatch(/api\.totp\.remove\(/);
    expect(src).toMatch(/api\.totp\.import\(/);
    expect(src).toMatch(/api\.totp\.export\(/);
    expect(src).toMatch(/<TotpForm/);
  });

  it('TOTP 扫码录入（文件 / 剪贴板）在表单里仍可触发', () => {
    const src = read('src/components/TotpForm.tsx');
    expect(src).toMatch(/api\.totp\.scanImage\(/);
    expect(src).toMatch(/api\.totp\.scanClipboard\(/);
  });

  it('验证码一键复制能力被保留（高亮组件 + 主进程剪贴板）', () => {
    const highlight = read('src/components/CodeHighlight.tsx');
    expect(highlight).toMatch(/onCopy/);
    expect(highlight).toMatch(/ContentCopyIcon/);
    // list + reader both render the highlight affordance
    expect(read('src/components/MailListItem.tsx')).toMatch(/CodeHighlight/);
    expect(read('src/components/MessageView.tsx')).toMatch(/onCopy/);
    // and the copy actually reaches the clipboard bridge
    expect(read('src/App.tsx')).toMatch(/api\.system\.copy\(/);
  });
});

describe('QA IPC 契约——totp 分组三方逐成员一致', () => {
  const declared = apiMembers(read('shared/types.ts'), 'export interface MailHubApi {');
  const preload = apiMembers(read('electron/preload.ts'), 'const api: MailHubApi = {');
  const ipc = read('electron/ipc.ts');

  const pick = (set: Set<string>, group: string): string[] =>
    [...set].filter((k) => k.startsWith(`${group}.`)).map((k) => k.split('.')[1]).sort();

  it('types ↔ preload 的 totp 成员完全一致', () => {
    expect(pick(preload, 'totp')).toEqual(pick(declared, 'totp'));
  });

  it('每个 totp 成员都有对应的 ipcMain.handle 通道', () => {
    const handlers = new Set(
      [...ipc.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]),
    );
    for (const member of pick(declared, 'totp')) {
      expect(handlers.has(`totp:${member}`), `缺少通道 totp:${member}`).toBe(true);
    }
  });

  it('关键通道的参数位与 preload 传参一致（防止单边改签名）', () => {
    const preloadSrc = read('electron/preload.ts');
    // accounts:update(id, input)
    expect(preloadSrc).toMatch(/invoke\('accounts:update',\s*id,\s*input\)/);
    // messages:setFlags(id, flags)
    expect(preloadSrc).toMatch(/invoke\('messages:setFlags',\s*id,\s*flags\)/);
    // messages:move(id, targetFolderId)
    expect(preloadSrc).toMatch(/invoke\('messages:move',\s*id,\s*targetFolderId\)/);
    // attachments:download(messageId, partId)
    expect(preloadSrc).toMatch(/invoke\('attachments:download',\s*messageId,\s*partId\)/);
    // accounts:msLoginPoll(flowId)
    expect(preloadSrc).toMatch(/invoke\('accounts:msLoginPoll',\s*flowId\)/);
    // 对应的 handler 也必须接收相同数量的参数
    expect(ipc).toMatch(/ipcMain\.handle\('accounts:update',\s*\(_event,\s*id: string,\s*input: AccountInput\)/);
    expect(ipc).toMatch(/ipcMain\.handle\('messages:setFlags',\s*\(_event,\s*id: string,\s*flags: Partial<MessageFlags>\)/);
  });
});

describe('QA 纯模块守卫——无原生模块 / 无脏导入', () => {
  it('package.json 不含任何已知原生模块依赖', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const banned of ['better-sqlite3', 'sqlite3', 'node-gyp', 'sharp', 'canvas']) {
      expect(all[banned], `${banned} 是原生模块，禁止引入`).toBeUndefined();
    }
  });

  it('package.json 无 postinstall（避免 ABI 重建）', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.postinstall).toBeUndefined();
  });
});
