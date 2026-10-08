import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from '../electron/sanitize';

/**
 * The sanitiser is the reading pane's only line of defence: mail is untrusted
 * input, so anything that can execute or phone home must be gone before the
 * HTML ever reaches the renderer's sandboxed iframe.
 */

describe('sanitizeMailHtml', () => {
  it('删除 script 标签及其内容', () => {
    const out = sanitizeMailHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('删除 iframe / object / embed', () => {
    const out = sanitizeMailHtml(
      '<iframe src="https://evil.example.com"></iframe><object data="x"></object><embed src="y">',
    );
    expect(out).not.toMatch(/iframe|object|embed/i);
  });

  it('删除 on* 事件属性', () => {
    const out = sanitizeMailHtml('<img src="https://example.com/a.png" onerror="steal()">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('steal');
  });

  it('默认拦截远程图片，但保留内联 data: 图片', () => {
    const remote = '<img src="https://example.com/pixel.png" alt="x">';
    expect(sanitizeMailHtml(remote)).not.toContain('https://example.com/pixel.png');

    const inline = '<img src="data:image/png;base64,AAAA" alt="x">';
    expect(sanitizeMailHtml(inline)).toContain('data:image/png;base64,AAAA');
  });

  it('cid: 图片引用一并移除', () => {
    expect(sanitizeMailHtml('<img src="cid:logo">')).not.toContain('cid:');
  });

  it('开启远程图片后保留 http(s) 图片', () => {
    const out = sanitizeMailHtml('<img src="https://example.com/a.png">', { allowRemoteImages: true });
    expect(out).toContain('https://example.com/a.png');
  });

  it('为链接补上 target / rel，防止沙箱内跳转', () => {
    const out = sanitizeMailHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('保留排版标签，不误伤正常邮件', () => {
    const out = sanitizeMailHtml('<table><tbody><tr><td><b>总额</b></td></tr></tbody></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('<b>总额</b>');
  });

  it('关闭远程图片时中和 CSS 里的远程 url()', () => {
    const out = sanitizeMailHtml('<div style="background:url(https://example.com/b.png)">x</div>');
    expect(out).not.toContain('https://example.com/b.png');
  });

  it('空输入安全返回空串', () => {
    expect(sanitizeMailHtml('')).toBe('');
  });
});
