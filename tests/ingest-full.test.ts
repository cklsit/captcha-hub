import { describe, expect, it } from 'vitest';
import { buildEnvelope, buildHighlight } from '../electron/ingest-core';
import { extractCode } from '../electron/extractor';
import type { ParsedMailResult } from '../electron/parse-mail';

/**
 * v2 behaviour change: fetching is UNCONDITIONAL. Every mail becomes an
 * envelope; the code extractor's output is demoted to highlight metadata and
 * no longer decides whether a mail is stored. There is also no
 * "only after account creation" baseline any more — the mail's own timestamp
 * never filters it out.
 */

function parsed(overrides: Partial<ParsedMailResult> = {}): ParsedMailResult {
  return {
    subject: '主题',
    from: 'noreply@example.com',
    to: 'me@example.com',
    cc: '',
    replyTo: '',
    messageId: '<x@example.com>',
    date: 1_700_000_000_000,
    text: '正文',
    html: '',
    attachments: [],
    ...overrides,
  };
}

describe('全量入库：普通邮件也生成 Envelope', () => {
  it('没有任何验证码的邮件同样入库，highlight 为 null', () => {
    const mail = parsed({ subject: 'Weekly digest', text: 'nothing to extract here' });
    const envelope = buildEnvelope({
      accountId: 'acct-1',
      folderId: 'INBOX',
      uid: '10',
      parsed: mail,
      highlight: buildHighlight(extractCode({ subject: mail.subject, text: mail.text })),
      seen: false,
      now: 1_700_000_001_000,
    });
    expect(envelope.highlight).toBeNull();
    expect(envelope.id).toBe('acct-1::INBOX::10');
    expect(envelope.subject).toBe('Weekly digest');
  });

  it('含验证码的邮件在 envelope 上附带 highlight 元数据', () => {
    const mail = parsed({ subject: '登录验证', text: '您的验证码是 483920，5 分钟内有效。' });
    const envelope = buildEnvelope({
      accountId: 'acct-1',
      folderId: 'INBOX',
      uid: '11',
      parsed: mail,
      highlight: buildHighlight(extractCode({ subject: mail.subject, text: mail.text })),
      seen: false,
    });
    expect(envelope.highlight?.code).toBe('483920');
    expect(envelope.highlight?.matchedKeyword).toBe('验证码');
  });

  it('不再按「账户创建时间」裁剪基线：很旧的邮件也照常入库', () => {
    // 邮件时间远早于任何“账户创建时间”，v2 不会因此丢弃它。
    const mail = parsed({ date: 1, text: 'ancient mail without code' });
    const envelope = buildEnvelope({
      accountId: 'acct-1',
      folderId: 'INBOX',
      uid: '1',
      parsed: mail,
      highlight: null,
      seen: false,
    });
    expect(envelope.receivedAt).toBe(1);
    expect(envelope.bodyTruncated).toBe(false);
  });

  it('附件元数据被带上，hasAttachments 反映真实情况', () => {
    const mail = parsed({
      attachments: [{ partId: '0', filename: 'a.pdf', contentType: 'application/pdf', size: 3, inline: false }],
    });
    const envelope = buildEnvelope({ accountId: 'a', folderId: 'INBOX', uid: '5', parsed: mail, highlight: null, seen: true });
    expect(envelope.hasAttachments).toBe(true);
    expect(envelope.attachments[0].filename).toBe('a.pdf');
    expect(envelope.flags.seen).toBe(true);
  });
});

describe('buildHighlight', () => {
  it('null / undefined 提取结果映射为 null', () => {
    expect(buildHighlight(null)).toBeNull();
    expect(buildHighlight(undefined)).toBeNull();
  });
});
