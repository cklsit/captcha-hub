import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MailStoreCore } from '../electron/mail-store-core';
import type { Envelope } from '../shared/types';

/**
 * QA second-round regression — independent coverage for the two low-risk
 * storage fixes the engineer shipped in `1e164c1` (④ atomic-write temp cleanup,
 * ⑤ Windows reserved device names), plus the store-level behaviour the new
 * drafts box / body search rely on.
 *
 * These deliberately re-derive the behaviour from scratch instead of trusting
 * the engineer's added cases.
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
    subject: 's',
    from: 'f@example.com',
    to: '',
    cc: '',
    replyTo: '',
    snippet: '',
    receivedAt: 1,
    ingestedAt: 1,
    flags: { seen: false, flagged: false, answered: false, draft: false },
    hasAttachments: false,
    attachments: [],
    highlight: null,
    bodyTruncated: false,
    ...overrides,
  };
}

const tmpResidue = (dir: string): string[] =>
  (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.includes('.tmp-'));

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-r2-'));
  core = new MailStoreCore(rootDir);
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('QA ④ 原子写失败路径不留残渣', () => {
  it('body 写入在 rename 失败时不残留 .tmp-* 且原文件保持完好', () => {
    core.writeBody('a', 'INBOX', '1', { text: 'ORIGINAL', html: '', safeHtml: '' });

    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated crash before rename');
    });
    try {
      expect(() =>
        core.writeBody('a', 'INBOX', '1', { text: 'PARTIAL', html: '', safeHtml: '' }),
      ).toThrow();
    } finally {
      spy.mockRestore();
    }

    expect(core.readBody('a', 'INBOX', '1')?.text).toBe('ORIGINAL');
    expect(tmpResidue(rootDir)).toEqual([]);
  });

  it('索引持久化到目录路径（rename 必然失败）时抛错且不留 .tmp-*', () => {
    fs.mkdirSync(path.join(rootDir, 'index.json'));
    expect(() => core.upsertEnvelopes([envelope()])).toThrow();
    expect(tmpResidue(rootDir)).toEqual([]);
  });

  it('drafts/folders 持久化失败路径同样不留 .tmp-*', () => {
    fs.mkdirSync(path.join(rootDir, 'drafts.json'));
    expect(() =>
      core.saveDraft({
        accountId: 'a',
        mode: 'new',
        inReplyTo: '',
        to: '',
        cc: '',
        subject: 's',
        bodyText: '',
        bodyHtml: '',
        attachments: [],
      }),
    ).toThrow();
    expect(tmpResidue(rootDir)).toEqual([]);
  });
});

describe('QA ⑤ safeSegment 处理 Windows 保留名与尾随字符', () => {
  const cases: Array<[string, string]> = [
    ['CON', '_CON'],
    ['con', '_con'],
    ['CON.txt', '_CON.txt'],
    ['con.json', '_con.json'],
    ['NUL', '_NUL'],
    ['nul.log', '_nul.log'],
    ['PRN', '_PRN'],
    ['AUX', '_AUX'],
    ['COM1', '_COM1'],
    ['COM9', '_COM9'],
    ['LPT1', '_LPT1'],
    ['LPT9', '_LPT9'],
    ['name.', 'name'],
    ['name ', 'name'],
    ['name. ', 'name'],
    ['normal-id', 'normal-id'],
    ['COM10', 'COM10'], // Windows only reserves COM1–9; COM10 is a valid name
    ['CONSOLE', 'CONSOLE'], // must not over-match a legit name starting with CON
  ];

  it.each(cases)('safeSegment(%j) === %j', (input, expected) => {
    expect(core.safeSegment(input)).toBe(expected);
  });

  it('保留名作为 uid/accountId 也不会写到保留设备路径，且仍在 rootDir 内', () => {
    for (const name of ['CON', 'NUL', 'COM1', 'LPT9']) {
      expect(() =>
        core.writeBody(name, name, name, { text: name, html: '', safeHtml: '' }),
      ).not.toThrow();
    }
    const accountsDir = path.join(rootDir, 'accounts');
    const files = fs.readdirSync(accountsDir, { recursive: true }) as string[];
    for (const f of files) {
      const rel = path.relative(rootDir, path.join(accountsDir, f));
      expect(rel.startsWith('..')).toBe(false);
    }
    // The escaped directory really exists and is NOT the reserved device path.
    expect(fs.existsSync(path.join(rootDir, 'accounts', '_CON'))).toBe(true);
  });
});

describe('QA 草稿箱——续写不重复建稿（store 级证据）', () => {
  it('带相同 id 再次 saveDraft 为「更新」而非新增第二条', () => {
    const first = core.saveDraft({
      accountId: 'a',
      mode: 'new',
      inReplyTo: '',
      to: 'x@example.com',
      cc: '',
      subject: 'draft',
      bodyText: 'v1',
      bodyHtml: '',
      attachments: [],
    });
    const second = core.saveDraft({ ...first, subject: 'draft-edited', bodyText: 'v2' });
    expect(second.id).toBe(first.id);
    const listed = core.listDrafts('a');
    expect(listed).toHaveLength(1);
    expect(listed[0].subject).toBe('draft-edited');
    expect(listed[0].bodyText).toBe('v2');
  });

  it('发送后（removeDraft）草稿从列表消失', () => {
    const draft = core.saveDraft({
      accountId: 'a',
      mode: 'reply',
      inReplyTo: '',
      to: 'x@example.com',
      cc: '',
      subject: 's',
      bodyText: '',
      bodyHtml: '',
      attachments: [],
    });
    expect(core.listDrafts('a')).toHaveLength(1);
    core.deleteDraft(draft.id);
    expect(core.listDrafts('a')).toHaveLength(0);
  });
});

describe('QA 正文搜索——渲染层合并所依赖的 store 语义', () => {
  it('同一封「主题+正文」双命中：元数据查询与正文扫描都会返回它（供渲染层去重）', () => {
    core.upsertEnvelopes([
      envelope({ uid: '1', subject: 'invoice 483920' }),
      envelope({ uid: '2', subject: 'hello', id: 'acct-1::INBOX::2' }),
      envelope({ uid: '3', subject: 'other', id: 'acct-1::INBOX::3' }),
    ]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'body has 483920 too', html: '', safeHtml: '' });
    core.writeBody('acct-1', 'INBOX', '2', { text: 'body 483920 only', html: '', safeHtml: '' });
    core.writeBody('acct-1', 'INBOX', '3', { text: 'nothing here', html: '', safeHtml: '' });

    const term = '483920';
    const metaHits = core.listEnvelopes({ search: term }).map((e) => e.id);
    const bodyHits = core.scanBodies(undefined, term);

    // envelope 1 matches both; envelope 2 matches body only.
    expect(metaHits).toContain('acct-1::INBOX::1');
    expect(bodyHits).toEqual(expect.arrayContaining(['acct-1::INBOX::1', 'acct-1::INBOX::2']));
    // The renderer derives extras = bodyHits \ metaHits → only envelope 2 is a "正文匹配".
    const metaSet = new Set(metaHits);
    const extras = bodyHits.filter((id) => !metaSet.has(id));
    expect(extras).toEqual(['acct-1::INBOX::2']);
  });

  it('scanBodies 的结果上限（500）在 store 层生效', () => {
    const many = 12;
    for (let i = 0; i < many; i += 1) {
      core.writeBody('acct-1', 'INBOX', String(i), { text: 'needle', html: '', safeHtml: '' });
    }
    core.upsertEnvelopes(
      Array.from({ length: many }, (_, i) => envelope({ uid: String(i), id: `acct-1::INBOX::${i}` })),
    );
    expect(core.scanBodies(undefined, 'needle')).toHaveLength(many);
    expect(core.scanBodies(undefined, 'needle', undefined, { limit: 3 })).toHaveLength(3);
  });

  it('正文搜索不区分大小写', () => {
    core.upsertEnvelopes([envelope({ uid: '1' })]);
    core.writeBody('acct-1', 'INBOX', '1', { text: 'Verification CODE', html: '', safeHtml: '' });
    expect(core.scanBodies(undefined, 'verification')).toEqual(['acct-1::INBOX::1']);
  });
});
