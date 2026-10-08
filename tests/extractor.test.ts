import { describe, expect, it } from 'vitest';
import { extractCode } from '../electron/extractor';

/**
 * Extraction engine regressions. The engine is now a pure *highlighter* — its
 * output no longer decides whether a mail is stored — so these cases only pin
 * the code / keyword / confidence behaviour.
 */

describe('extractCode', () => {
  it('extracts a Chinese SMS-style code', () => {
    const now = 1_700_000_000_000;
    const result = extractCode(
      { subject: '登录验证', text: '您的验证码是 483921，5 分钟内有效。' },
      now,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBe('483921');
    expect(result?.matchedKeyword).toBe('验证码');
    expect(result?.expiresAtHint).toBe(now + 5 * 60 * 1000);
    expect(result?.confidence).toBeGreaterThan(0.5);
  });

  it('extracts an English verification code', () => {
    const result = extractCode({
      subject: 'Your verification code',
      text: 'Your verification code is 293104. Do not share it with anyone.',
    });
    expect(result?.code).toBe('293104');
    expect(result?.matchedKeyword).not.toBeNull();
  });

  it('handles Google-style G- prefixed codes', () => {
    const result = extractCode({
      subject: 'Security alert',
      text: 'G-482913 is your Google verification code.',
    });
    expect(result?.code).toBe('482913');
  });

  it('prefers the code over a currency amount', () => {
    const result = extractCode({
      subject: '订单通知',
      text: '订单金额 ¥1234 元。验证码 889900，10 分钟内有效。',
    });
    expect(result?.code).toBe('889900');
  });

  it('extracts 8-digit codes', () => {
    const result = extractCode({ subject: '', text: '您的动态码：58493012（请勿泄露）' });
    expect(result?.code).toBe('58493012');
  });

  it('returns null when nothing looks like a code', () => {
    expect(extractCode({ subject: 'hello', text: 'world, nothing here' })).toBeNull();
    expect(extractCode({ subject: '', text: '' })).toBeNull();
  });
});
