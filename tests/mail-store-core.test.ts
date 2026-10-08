import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MailStoreCore } from '../electron/mail-store-core';
import type { Envelope } from '../shared/types';

/**
 * The storage core must be provably correct without Electron — that is the
 * whole point of the pure/`mail-service` split. These tests exercise it end to
 * end in a throwaway temp directory: CRUD, atomic index writes, path-traversal
 * defence, body relocation, folder cursors, drafts and body scanning.
 */

let rootDir: string;
let core: MailStoreCore;

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  const accountId = overrides.accountId ?? 'acct-1';
  const folderId = overrides.folderId ?? 'INBOX';
  const uid = overrides.uid ?? '1';
  return {
    id: overrides.id ?? `${accountId}::${folderId}::${uid}`,
    accountId,
    folderId,
    uid,
    messageId: `<${uid}@example.com>`,
    subject: '主题',
    from: 'noreply@example.com',
    to: 'me@example.com',
    cc: '',
    replyTo: '',
    snippet: '摘要',
    receivedAt: 1000,
    ingestedAt: 1001,
    flags: { seen: false, flagged: false, answered: false, draft: false },
    hasAttachments: false,
    attachments: [],
    highlight: null,
    bodyTruncated: false,
    ...overrides,
  };
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-store-'));
  core = new MailStoreCore(rootDir);
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('MailStoreCore — 信封索引', () => {
  it('插入后可查、可列、按时间倒序', () => {
    core.upsertEnvelopes([envelope({ uid: '1', receivedAt: 1000 }), envelope({ uid: '2', receivedAt: 2000 })]);
    expect(core.getEnvelope('acct-1::INBOX::1')?.uid).toBe('1');
    expect(core.listEnvelopes().map((e) => e.uid)).toEqual(['2', '1']);
  });

  it('相同 account::folder::uid 视为同一封，重复插入不新增', () => {
    const first = core.upsertEnvelopes([envelope({ uid: '1' })]);
    const second = core.upsertEnvelopes([envelope({ uid: '1', subject: '改过的主题' })]);
    expect(first.added).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.updated).toBe(1);
    expect(core.listEnvelopes()).toHaveLength(1);
    expect(core.getEnvelope('acct-1::INBOX::1')?.subject).toBe('改过的主题');
  });

  it('索引被原子写入磁盘（存在 index.json）', () => {
    core.upsertEnvelopes([envelope()]);
    expect(fs.existsSync(path.join(rootDir, 'index.json'))).toBe(true);
    // 重新构造实例会从磁盘恢复
    const reopened = new MailStoreCore(rootDir);
    expect(reopened.listEnvelopes()).toHaveLength(1);
  });

  it('按账户 / 文件夹 / 未读 / 关键词过滤', () => {
    core.upsertEnvelopes([
      envelope({ uid: '1', folderId: 'INBOX', receivedAt: 1 }),
      envelope({ uid: '2', folderId: 'INBOX', receivedAt: 2, flags: { seen: true, flagged: false, answered: false, draft: false } }),
      envelope({ uid: '3', folderId: 'Sent', receivedAt: 3, subject: '发票 invoice' }),
    ]);
    expect(core.listEnvelopes({ folderId: 'INBOX' })).toHaveLength(2);
    expect(core.listEnvelopes({ unreadOnly: true })).toHaveLength(2);
    expect(core.listEnvelopes({ search: 'invoice' })).toHaveLength(1);
    expect(core.listEnvelopes({ limit: 1 })).toHaveLength(1);
  });
});

describe('MailStoreCore — 正文文件', () => {
  it('写入后可按 account/folder/uid 读回', () => {
    core.writeBody('acct-1', 'INBOX', '1', { text: 'hello', html: '<p>hello</p>', safeHtml: '<p>hello</p>' });
    expect(core.readBody('acct-1', 'INBOX', '1')?.text).toBe('hello');
    expect(core.readBody('acct-1', 'INBOX', 'nope')).toBeNull();
  });

  it('路径穿越被 safeSegment 挡下（不会写到 rootDir 之外）', () => {
    core.writeBody('../evil', '../../etc', '../../x', { text: 'poc', html: '', safeHtml: '' });
    const escaped = path.resolve(rootDir, '..', '..', 'etc', 'x.json');
    expect(fs.existsSync(escaped)).toBe(false);
    const outside = path.resolve(rootDir, '..', 'evil');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('moveMessage 会把正文一并搬到目标文件夹', () => {
    core.upsertEnvelopes([envelope({ uid: '1' })]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'body', html: '', safeHtml: '' });
    const moved = core.moveMessage('acct-1::INBOX::1', 'Archive', '1');
    expect(moved?.folderId).toBe('Archive');
    expect(core.readBody('acct-1', 'Archive', '1')?.text).toBe('body');
    expect(core.readBody('acct-1', 'INBOX', '1')).toBeNull();
  });

  it('deleteMessage 同时删除索引与正文', () => {
    core.upsertEnvelopes([envelope({ uid: '1' })]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'body', html: '', safeHtml: '' });
    core.deleteMessage('acct-1::INBOX::1');
    expect(core.getEnvelope('acct-1::INBOX::1')).toBeNull();
    expect(core.readBody('acct-1', 'INBOX', '1')).toBeNull();
  });

  it('scanBodies 命中正文（大小写不敏感）并可分批回调', () => {
    core.upsertEnvelopes([envelope({ uid: '1' }), envelope({ uid: '2' })]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'Your CODE is 483920', html: '', safeHtml: '' });
    core.writeBody('acct-1', 'INBOX', '2', { text: 'nothing here', html: '', safeHtml: '' });
    const batches: string[][] = [];
    const matched = core.scanBodies(undefined, 'code', (ids) => batches.push(ids));
    expect(matched).toEqual(['acct-1::INBOX::1']);
    expect(batches.flat()).toEqual(['acct-1::INBOX::1']);
  });

  it('scanBodies 在空关键词时短路返回空数组', () => {
    core.upsertEnvelopes([envelope({ uid: '1' })]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'anything', html: '', safeHtml: '' });
    expect(core.scanBodies(undefined, '   ')).toEqual([]);
  });
});

describe('MailStoreCore — 路径安全化 (safeSegment)', () => {
  it('转义 Windows 保留设备名（含带扩展名形式）', () => {
    expect(core.safeSegment('CON')).toBe('_CON');
    expect(core.safeSegment('nul')).toBe('_nul');
    expect(core.safeSegment('AUX')).toBe('_AUX');
    expect(core.safeSegment('PRN')).toBe('_PRN');
    expect(core.safeSegment('COM1')).toBe('_COM1');
    expect(core.safeSegment('LPT9')).toBe('_LPT9');
    expect(core.safeSegment('CON.txt')).toBe('_CON.txt');
  });

  it('去掉结尾的点与空格，并对空值兜底', () => {
    expect(core.safeSegment('foo.')).toBe('foo');
    expect(core.safeSegment('foo   ')).toBe('foo');
    expect(core.safeSegment('..')).toBe('_');
    expect(core.safeSegment('   ')).toBe('_');
    expect(core.safeSegment('')).toBe('_');
  });

  it('替换路径分隔符与控制字符', () => {
    expect(core.safeSegment('a/b\\c')).toBe('a_b_c');
    expect(core.safeSegment('x:y?z*')).toBe('x_y_z_');
  });

  it('保留名不会真的写到保留设备路径（防穿越复核）', () => {
    core.writeBody('CON', 'INBOX', '1', { text: 'x', html: '', safeHtml: '' });
    expect(fs.existsSync(path.join(rootDir, 'accounts', '_CON', 'INBOX', '1.json'))).toBe(true);
  });
});

describe('MailStoreCore — 原子写', () => {
  it('写入失败时不残留 .tmp-* 临时文件', () => {
    // Make the rename target a directory so `renameSync` fails.
    fs.mkdirSync(path.join(rootDir, 'index.json'));
    expect(() => core.upsertEnvelopes([envelope()])).toThrow();
    const leftovers = fs.readdirSync(rootDir).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

describe('MailStoreCore — 文件夹与计数', () => {
  it('保存服务器文件夹并保留订阅 / 游标', () => {
    core.saveFolders('acct-1', [
      { path: 'INBOX', name: '收件箱', delimiter: '/', specialUse: '\\Inbox' },
      { path: 'Sent', name: '已发送', delimiter: '/', specialUse: '\\Sent' },
    ]);
    core.setSubscribed('acct-1', ['INBOX']);
    core.updateFolderCursor('acct-1', 'acct-1::INBOX', { uidValidity: 42, lastUid: 100, lastSyncAt: 5 });

    // Re-saving must not clobber the user's subscription or sync cursor.
    const folders = core.saveFolders('acct-1', [
      { path: 'INBOX', name: '收件箱', delimiter: '/', specialUse: '\\Inbox' },
      { path: 'Sent', name: '已发送', delimiter: '/', specialUse: '\\Sent' },
    ]);
    const inbox = folders.find((folder) => folder.path === 'INBOX');
    expect(inbox?.subscribed).toBe(true);
    expect(inbox?.uidValidity).toBe(42);
    expect(inbox?.lastUid).toBe(100);
    expect(folders.find((folder) => folder.path === 'Sent')?.subscribed).toBe(false);
  });

  it('folderCounts 反映未读与总数', () => {
    core.upsertEnvelopes([
      envelope({ uid: '1', receivedAt: 1 }),
      envelope({ uid: '2', receivedAt: 2, flags: { seen: true, flagged: false, answered: false, draft: false } }),
      envelope({ uid: '3', folderId: 'Sent', receivedAt: 3 }),
    ]);
    const counts = core.folderCounts('acct-1');
    expect(counts.INBOX).toEqual({ unread: 1, total: 2 });
    expect(counts.Sent).toEqual({ unread: 1, total: 1 });
  });
});

describe('MailStoreCore — 草稿', () => {
  it('保存 / 列出 / 更新 / 删除', () => {
    const draft = core.saveDraft({
      accountId: 'acct-1',
      mode: 'new',
      inReplyTo: '',
      to: 'someone@example.com',
      cc: '',
      subject: 'hi',
      bodyText: 'hello',
      bodyHtml: '',
      attachments: [],
    });
    expect(core.listDrafts('acct-1')).toHaveLength(1);
    const updated = core.saveDraft({ ...draft, subject: 'hi again' });
    expect(updated.id).toBe(draft.id);
    expect(core.listDrafts('acct-1')[0].subject).toBe('hi again');
    core.deleteDraft(draft.id);
    expect(core.listDrafts('acct-1')).toHaveLength(0);
  });

  it('草稿全字段往返，可供渲染层续写预填', () => {
    const draft = core.saveDraft({
      accountId: 'acct-1',
      mode: 'reply',
      inReplyTo: '<m1@example.com>',
      to: 'a@example.com',
      cc: 'b@example.com',
      subject: 'Re: hi',
      bodyText: 'quoted body',
      bodyHtml: '<p>quoted body</p>',
      attachments: ['C:\\docs\\file.pdf'],
    });
    const listed = core.listDrafts('acct-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: draft.id,
      accountId: 'acct-1',
      mode: 'reply',
      inReplyTo: '<m1@example.com>',
      to: 'a@example.com',
      cc: 'b@example.com',
      subject: 'Re: hi',
      bodyText: 'quoted body',
      bodyHtml: '<p>quoted body</p>',
      attachments: ['C:\\docs\\file.pdf'],
    });
    expect(listed[0].updatedAt).toBeGreaterThan(0);
  });

  it('listDrafts 可按账户过滤，删除后不再出现', () => {
    const first = core.saveDraft({
      accountId: 'acct-1',
      mode: 'new',
      inReplyTo: '',
      to: 'a@example.com',
      cc: '',
      subject: 'one',
      bodyText: '',
      bodyHtml: '',
      attachments: [],
    });
    core.saveDraft({
      accountId: 'acct-2',
      mode: 'new',
      inReplyTo: '',
      to: 'b@example.com',
      cc: '',
      subject: 'two',
      bodyText: '',
      bodyHtml: '',
      attachments: [],
    });
    expect(core.listDrafts('acct-1')).toHaveLength(1);
    expect(core.listDrafts()).toHaveLength(2);
    core.deleteDraft(first.id);
    expect(core.listDrafts('acct-1')).toHaveLength(0);
    expect(core.listDrafts()).toHaveLength(1);
  });
});
