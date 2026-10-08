import { describe, expect, it } from 'vitest';
import { extractCode } from '../electron/extractor';

/**
 * QA-independent verification of the extraction engine.
 *
 * Deliberately written by the QA engineer (NOT the implementer) with concrete,
 * numeric assertions (exact code, matched keyword, confidence bounds) rather
 * than loose "not null" checks, so a regression cannot hide behind a non-empty
 * return value.
 */

describe('QA extractCode — Chinese templates', () => {
  it('【微博】您的验证码是 123456，5分钟内有效', () => {
    const now = 1_700_000_000_000;
    const result = extractCode(
      { subject: '微博安全提醒', text: '【微博】您的验证码是 123456，5分钟内有效' },
      now,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBe('123456');
    expect(result?.matchedKeyword).toBe('验证码');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result?.expiresAtHint).toBe(now + 5 * 60 * 1000);
  });

  it('验证码为 8888，请勿泄露', () => {
    const result = extractCode({ subject: '', text: '验证码为 8888，请勿泄露' });
    expect(result?.code).toBe('8888');
    expect(result?.matchedKeyword).toBe('验证码');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('动态密码 654321', () => {
    const result = extractCode({ subject: '', text: '动态密码 654321' });
    expect(result?.code).toBe('654321');
    expect(result?.matchedKeyword).toBe('动态密码');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('QA extractCode — English templates', () => {
  it('Your verification code is 482913', () => {
    const result = extractCode({ subject: '', text: 'Your verification code is 482913' });
    expect(result?.code).toBe('482913');
    expect(result?.matchedKeyword).not.toBeNull();
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('OTP: 918273', () => {
    const result = extractCode({ subject: '', text: 'OTP: 918273' });
    expect(result?.code).toBe('918273');
    expect(result?.matchedKeyword).toBe('otp');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('G-583920 is your Google verification code', () => {
    const result = extractCode({
      subject: '',
      text: 'G-583920 is your Google verification code',
    });
    expect(result?.code).toBe('583920');
    expect(result?.matchedKeyword).toBe('verification code');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('QA extractCode — distractors must NOT be high-confidence codes', () => {
  const cases: Array<{ label: string; text: string }> = [
    { label: 'order amount ¥1234.00', text: '订单金额 ¥1234.00' },
    { label: 'balance 8888 元', text: '余额 8888 元' },
    { label: 'order id 2024091512345678', text: '订单号 2024091512345678' },
    { label: 'year 2024', text: '时间 2024' },
    { label: 'courier 20240915 已发出', text: '您的快递 20240915 已发出' },
  ];

  it.each(cases)('$label is not extracted with high confidence', ({ text }) => {
    const result = extractCode({ subject: '', text });
    // Either nothing is returned, or it is a low-confidence, keyword-less guess.
    if (result !== null) {
      expect(result.confidence).toBeLessThan(0.3);
    }
    expect(result?.matchedKeyword ?? null).toBeNull();
  });

  it('a long 16-digit order number yields no candidate at all', () => {
    expect(extractCode({ subject: '', text: '订单号 2024091512345678' })).toBeNull();
  });
});

describe('QA extractCode — empty / no-candidate inputs', () => {
  it('returns null for empty subject and body', () => {
    expect(extractCode({ subject: '', text: '' })).toBeNull();
  });

  it('returns null when there is no digit/alnum token at all', () => {
    expect(extractCode({ subject: 'hello', text: 'world, nothing here' })).toBeNull();
  });
});
