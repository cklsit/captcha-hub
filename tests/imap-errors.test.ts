import { describe, expect, it } from 'vitest';
import { describeImapError } from '../electron/imap';

/**
 * `describeImapError` exists because imapflow collapses almost every
 * server-side rejection into the useless string `Command failed`. These tests
 * pin down the three cases we actually care about in the field.
 */

function imapError(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

describe('describeImapError', () => {
  it('把认证失败翻译成「要用授权码」的可操作提示', () => {
    const result = describeImapError(imapError('Command failed', { authenticationFailed: true }));
    expect(result).toContain('认证失败');
    expect(result).toContain('授权码');
  });

  it('serverResponseCode 为 AUTHENTICATIONFAILED 时同样识别为认证失败', () => {
    const result = describeImapError(imapError('Command failed', { serverResponseCode: 'AUTHENTICATIONFAILED' }));
    expect(result).toContain('认证失败');
  });

  it('网易 Unsafe Login 时给出开启 IMAP 服务的提示', () => {
    const result = describeImapError(
      imapError('Command failed', {
        responseText: 'SELECT Unsafe Login. Please contact kefu@188.com for help',
      }),
    );
    expect(result).toContain('Unsafe Login');
    expect(result).toContain('IMAP');
  });

  it('暴露 responseText 与 serverResponseCode，而不是只回显 Command failed', () => {
    const result = describeImapError(
      imapError('Command failed', { responseText: 'Mailbox does not exist', serverResponseCode: 'NONEXISTENT' }),
    );
    expect(result).toContain('Mailbox does not exist');
    expect(result).toContain('NONEXISTENT');
    expect(result).not.toBe('Command failed');
  });

  it('非 Error 输入回退为字符串化，不抛异常', () => {
    expect(describeImapError('boom')).toBe('boom');
    expect(describeImapError(undefined)).toBe('undefined');
  });

  it('没有任何附加信息的普通错误原样返回', () => {
    expect(describeImapError(imapError('ETIMEDOUT'))).toBe('ETIMEDOUT');
  });
});
