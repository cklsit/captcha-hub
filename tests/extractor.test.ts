import { describe, expect, it } from 'vitest';
import { extractCode, resolveSourceForMail } from '../electron/extractor';
import type { Source } from '../shared/types';

function source(partial: Partial<Source> & Pick<Source, 'id' | 'kind' | 'name'>): Source {
  return {
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    lastSyncAt: null,
    lastSyncStatus: 'never',
    lastSyncError: null,
    email: null,
    phone: null,
    totp: null,
    ...partial,
  };
}

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

describe('resolveSourceForMail', () => {
  const emailSource = source({
    id: 'email-1',
    kind: 'email',
    name: '我的邮箱',
    email: {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'me@example.com',
      password: 'secret',
      mailbox: 'INBOX',
      authType: 'password',
      clientId: '',
      tenant: 'common',
      refreshToken: '',
      accessToken: '',
      accessTokenExpiresAt: 0,
    },
  });

  const phoneSource = source({
    id: 'phone-1',
    kind: 'phone',
    name: '138****8000',
    phone: {
      phoneNumber: '+8613800138000',
      rule: { emailSourceId: 'email-1', matchField: 'subject', matchKeyword: '短信转发' },
    },
  });

  it('attributes a matching mail to the phone source', () => {
    const resolved = resolveSourceForMail(
      { subject: '【短信转发】验证码 123456', from: 'forward@example.com', text: '...' },
      'email-1',
      [emailSource, phoneSource],
    );
    expect(resolved?.source.id).toBe('phone-1');
    expect(resolved?.matchedByRule).toBe(true);
  });

  it('falls back to the email source when no rule matches', () => {
    const resolved = resolveSourceForMail(
      { subject: '普通邮件', from: 'someone@example.com', text: '...' },
      'email-1',
      [emailSource, phoneSource],
    );
    expect(resolved?.source.id).toBe('email-1');
    expect(resolved?.matchedByRule).toBe(false);
  });

  it('returns null when the email source does not exist', () => {
    expect(
      resolveSourceForMail({ subject: 'x', from: 'y', text: 'z' }, 'missing', [phoneSource]),
    ).toBeNull();
  });
});
