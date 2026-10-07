import { describe, expect, it } from 'vitest';
import { extractCode, isIngestible, MIN_CONFIDENCE } from '../electron/extractor';

/**
 * Regressions for the two complaints that prompted this filter:
 *   1. ordinary notification mail was showing up in the inbox;
 *   2. the inbox was filled with codes that predate the source.
 *
 * Fixtures are synthetic look-alikes of the real messages — never the real
 * addresses, which must not end up in the repository.
 */

describe('提取引擎：不再把通知类邮件当成验证码', () => {
  it('不会从邮箱地址里取出 4 位数字（user0412@ → 0412）', () => {
    const result = extractCode({
      subject: '新设备登录提醒',
      from: '账号安全 <safe@service.example.com>',
      text: [
        '新设备登录提醒',
        '系统检测到 user0412@example.com 刚刚在 未知设备 上成功登录。',
        '如果不是本人操作，账号密码可能已泄露，建议您修改密码。',
        '账号：user0412@example.com',
        '时间：2026-10-07 19:48:27',
        '地点：广东省，广州市',
      ].join('\n'),
    });

    expect(result?.code).not.toBe('0412');
    expect(result === null || result.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('不会把日期当作验证码（2026-10-05 → 2026）', () => {
    const result = extractCode({
      subject: '[owner/repo] Run failed: Close Stale Issues - main (ef05cd)',
      from: 'notifications@github.com',
      text: [
        'Repository: owner/repo',
        'Workflow: Close Stale Issues',
        'Duration: 15 minutes and 3.0 seconds',
        'Finished: 2026-10-05 19:59:46 UTC',
      ].join(' '),
    });

    expect(result?.code).not.toBe('2026');
    expect(result === null || result.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('不会把 URL 里的数字当作验证码', () => {
    const result = extractCode({
      subject: 'Weekly digest',
      from: 'news@example.com',
      text: '阅读全文：https://example.com/posts/20241005/summary',
    });
    expect(result === null || result.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('回归：真实验证码仍然被正确提取', () => {
    const cases: Array<[string, string]> = [
      ['您的验证码是 123456，5分钟内有效。', '123456'],
      ['【微博】验证码 8888，请勿泄露。', '8888'],
      ['Your verification code is 482913', '482913'],
      ['G-583920 is your Google verification code', '583920'],
    ];

    for (const [text, expected] of cases) {
      const result = extractCode({ subject: '', text });
      expect(result?.code, text).toBe(expected);
      expect(result!.confidence, text).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    }
  });
});

describe('isIngestible：入库前的两道闸门', () => {
  const baseline = 1_700_000_000_000;

  it('拒绝来源创建之前到达的旧邮件', () => {
    expect(isIngestible(baseline - 1, baseline, 0.9)).toBe(false);
    expect(isIngestible(baseline - 86_400_000, baseline, 0.9)).toBe(false);
  });

  it('接受来源创建之后到达的邮件（含同一毫秒）', () => {
    expect(isIngestible(baseline, baseline, 0.9)).toBe(true);
    expect(isIngestible(baseline + 1, baseline, 0.9)).toBe(true);
  });

  it('拒绝置信度低于阈值的猜测（即便时间满足条件）', () => {
    expect(isIngestible(baseline + 1, baseline, MIN_CONFIDENCE - 0.01)).toBe(false);
    expect(isIngestible(baseline + 1, baseline, 0.2)).toBe(false);
  });

  it('阈值边界本身算通过', () => {
    expect(isIngestible(baseline + 1, baseline, MIN_CONFIDENCE)).toBe(true);
  });

  it('两个条件必须同时满足', () => {
    expect(isIngestible(baseline - 1, baseline, 0.1)).toBe(false);
    expect(isIngestible(baseline + 1, baseline, 0.9)).toBe(true);
  });
});
