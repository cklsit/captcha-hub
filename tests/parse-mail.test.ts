import { describe, expect, it } from 'vitest';
import { buildSnippet, htmlToText, parseMailSource } from '../electron/parse-mail';

/**
 * `parse-mail` is what turns raw server bytes into the flat shape the sender
 * and the library agree on. Given it is pure, it is pinned here with synthetic
 * (`example.com`) fixtures covering plain text, HTML and attachments.
 */

const PLAIN = [
  'From: Alice <alice@example.com>',
  'To: Bob <bob@example.com>',
  'Subject: 登录验证',
  'Date: Wed, 05 Oct 2026 19:59:46 +0000',
  'Message-ID: <abc@example.com>',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  '您的验证码是 123456，5 分钟内有效。',
].join('\r\n');

const MULTIPART = [
  'From: noreply@example.com',
  'To: me@example.com',
  'Subject: With attachment',
  'Date: Wed, 05 Oct 2026 19:59:46 +0000',
  'Content-Type: multipart/mixed; boundary="BOUNDARY"',
  '',
  '--BOUNDARY',
  'Content-Type: text/html; charset="utf-8"',
  '',
  '<html><body><p>Hi <b>there</b></p></body></html>',
  '--BOUNDARY',
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  '',
  'JVBERi0xLjQK',
  '--BOUNDARY--',
].join('\r\n');

describe('parseMailSource', () => {
  it('解析纯文本邮件的头与正文', async () => {
    const parsed = await parseMailSource(PLAIN);
    expect(parsed.subject).toBe('登录验证');
    expect(parsed.from).toBe('Alice <alice@example.com>');
    expect(parsed.to).toBe('Bob <bob@example.com>');
    expect(parsed.messageId).toBe('<abc@example.com>');
    expect(parsed.text).toContain('123456');
    expect(parsed.attachments).toHaveLength(0);
    expect(parsed.date).toBeGreaterThan(0);
  });

  it('解析 HTML 与附件元数据', async () => {
    const parsed = await parseMailSource(Buffer.from(MULTIPART));
    expect(parsed.html).toContain('<b>there</b>');
    // 无 text/plain 部分时用 HTML 降级出纯文本
    expect(parsed.text).toContain('there');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe('invoice.pdf');
    expect(parsed.attachments[0].contentType).toContain('application/pdf');
    expect(parsed.attachments[0].partId).toBe('0');
  });
});

describe('htmlToText', () => {
  it('去标签并解码常见实体', () => {
    expect(htmlToText('<p>a &amp; b</p><br>c')).toContain('a & b');
    expect(htmlToText('<style>.x{color:red}</style>hello')).toBe('hello');
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('buildSnippet', () => {
  it('压平空白并在超长时截断', () => {
    expect(buildSnippet('  a\n\n  b  ')).toBe('a b');
    const long = 'x'.repeat(300);
    const snippet = buildSnippet(long, 180);
    expect(snippet.length).toBe(181);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
