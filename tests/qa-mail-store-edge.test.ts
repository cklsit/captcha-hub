import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_ENVELOPES_PER_FOLDER, MailStoreCore } from '../electron/mail-store-core';
import type { Envelope } from '../shared/types';

/**
 * QA-independent adversarial coverage for the new pure storage core.
 *
 * The engineer's suite proves the happy path; this file deliberately attacks
 * the guarantees the architecture promises: nothing may escape `rootDir`, a
 * failed write must never corrupt an existing file, the per-folder cap must
 * really trim, and the body scan must honour its result cap.
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

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-store-'));
  core = new MailStoreCore(rootDir);
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('QA MailStoreCore — safeSegment 防线', () => {
  const hostile = [
    '../../evil',
    '..\\..\\evil',
    '/etc/passwd',
    'C:\\Windows\\System32\\evil',
    '\\\\server\\share\\x',
    'a/../../b',
    '....//....//x',
    'a\u0000b',
    'a:b*c?d"e<f>g|h',
    '\n\r\t',
    '',
    '...',
    '..',
    '.',
    ' '.repeat(5),
  ];

  it.each(hostile)('safeSegment(%j) 不含路径分隔符与 .. 片段', (segment) => {
    const out = core.safeSegment(segment);
    expect(out).not.toMatch(/[/\\]/);
    expect(out).not.toMatch(/\.{2,}/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('超长片段被截断到 180 字符以内', () => {
    expect(core.safeSegment('a'.repeat(5000)).length).toBeLessThanOrEqual(180);
  });
});

describe('QA MailStoreCore — 路径穿越必须被挡下', () => {
  const hostileAccounts = [
    '../evil',
    '..\\evil',
    '/etc',
    'C:\\Windows',
    'a/../../b',
    '\\u0000',
  ];

  it.each(hostileAccounts)('accountId=%j 的正文仍写在 rootDir 内', (accountId) => {
    expect(() => core.writeBody(accountId, '../../etc', '../../x', { text: 'poc', html: '', safeHtml: '' })).not.toThrow();

    // Nothing may be created outside rootDir.
    const accountsDir = path.join(rootDir, 'accounts');
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return (fs.readdirSync(dir) as string[]).flatMap((entry) => {
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    for (const file of walk(accountsDir)) {
      expect(isInside(rootDir, file), `逃逸文件：${file}`).toBe(true);
    }
    // A traversal to the parent of rootDir must not exist.
    expect(fs.existsSync(path.resolve(rootDir, '..', 'etc'))).toBe(false);
  });

  it('Windows 保留名（CON/NUL/PRN/COM1/LPT1）不会逃出 rootDir', () => {
    for (const uid of ['CON', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT1']) {
      expect(() =>
        core.writeBody('acct', 'INBOX', uid, { text: uid, html: '', safeHtml: '' }),
      ).not.toThrow();
    }
    const accountsDir = path.join(rootDir, 'accounts');
    if (fs.existsSync(accountsDir)) {
      const files = fs.readdirSync(accountsDir, { recursive: true }) as string[];
      for (const f of files) {
        expect(isInside(rootDir, path.join(accountsDir, f))).toBe(true);
      }
    }
  });
});

describe('QA MailStoreCore — 原子写', () => {
  it('正常写入后不留 .tmp 残渣', () => {
    core.writeBody('a', 'INBOX', '1', { text: 'x', html: '', safeHtml: '' });
    core.upsertEnvelopes([envelope({ uid: '1' })]);
    const residue = (fs.readdirSync(rootDir, { recursive: true }) as string[]).filter((f) =>
      f.includes('.tmp-'),
    );
    expect(residue).toEqual([]);
  });

  it('rename 失败时，已存在的正文文件不被破坏（不产生半截文件）', () => {
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
    // The previously persisted body must be fully intact (never a half write).
    expect(core.readBody('a', 'INBOX', '1')?.text).toBe('ORIGINAL');
  });
});

describe('QA MailStoreCore — 容量与扫描上限', () => {
  it(`每文件夹上限 ${MAX_ENVELOPES_PER_FOLDER}：超出后只留最新的`, () => {
    const overflow = MAX_ENVELOPES_PER_FOLDER + 5;
    const batch = Array.from({ length: overflow }, (_, i) =>
      envelope({ uid: String(i), receivedAt: i, id: `acct-1::INBOX::${i}` }),
    );
    core.upsertEnvelopes(batch);
    const kept = core.listEnvelopes();
    expect(kept).toHaveLength(MAX_ENVELOPES_PER_FOLDER);
    // Oldest five evicted, newest retained.
    expect(kept[kept.length - 1].uid).toBe('5');
    expect(kept[0].uid).toBe(String(overflow - 1));
  });

  it('scanBodies 的 limit 上限生效', () => {
    for (let i = 0; i < 6; i += 1) {
      core.writeBody('acct-1', 'INBOX', String(i), { text: `CODE ${i}`, html: '', safeHtml: '' });
    }
    core.upsertEnvelopes(
      Array.from({ length: 6 }, (_, i) => envelope({ uid: String(i), receivedAt: i, id: `acct-1::INBOX::${i}` })),
    );
    const all = core.scanBodies(undefined, 'code');
    expect(all).toHaveLength(6);
    const capped = core.scanBodies(undefined, 'code', undefined, { limit: 2 });
    expect(capped).toHaveLength(2);
  });

  it('scanBodies 空查询返回空数组', () => {
    core.upsertEnvelopes([envelope()]);
    expect(core.scanBodies(undefined, '   ')).toEqual([]);
  });
});

describe('QA MailStoreCore — 目录与错误可读性', () => {
  it('rootDir 不存在时自动创建（无需预先 mkdir）', () => {
    const missing = path.join(rootDir, 'not-yet', 'nested');
    const fresh = new MailStoreCore(missing);
    expect(() => fresh.writeBody('a', 'INBOX', '1', { text: 'x', html: '', safeHtml: '' })).not.toThrow();
    expect(fresh.readBody('a', 'INBOX', '1')?.text).toBe('x');
  });

  it('损坏的 index.json 不会抛异常，退化为空索引', () => {
    fs.writeFileSync(path.join(rootDir, 'index.json'), '{ this is not json', 'utf8');
    const reopened = new MailStoreCore(rootDir);
    expect(reopened.listEnvelopes()).toEqual([]);
  });

  it('setFlags / moveMessage 对未知 id 返回 null 而不是崩溃', () => {
    expect(core.setFlags('nope', { seen: true })).toBeNull();
    expect(core.moveMessage('nope', 'Archive')).toBeNull();
  });
});
