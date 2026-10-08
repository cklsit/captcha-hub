import { describe, expect, it, vi } from 'vitest';
import { CIPHERTEXT_PREFIX, isPlaintext, sealPlaintext } from '../electron/secret-at-rest';

/**
 * These helpers exist because of a real leak: the store used to read the whole
 * (decrypted) account array, mutate one entry, and write the array back having
 * re-encrypted only that entry. Every other account's password and OAuth tokens
 * were then persisted in plaintext — the most recently touched account was
 * encrypted and all the others were not.
 *
 * The invariant that matters here is that sealing is *idempotent*: running it
 * over an already-sealed record must change nothing, because sealing a
 * ciphertext would destroy the value it protects.
 */

const seal = (value: string): string => `${CIPHERTEXT_PREFIX}sealed(${value})`;

describe('isPlaintext', () => {
  it('普通字符串视为明文', () => {
    expect(isPlaintext('hunter2')).toBe(true);
  });

  it('空值不是明文 —— 未填写的字段应当保持为空', () => {
    expect(isPlaintext('')).toBe(false);
  });

  it('两种密文前缀都识别', () => {
    expect(isPlaintext(`${CIPHERTEXT_PREFIX}safe:AAAA`)).toBe(false);
    expect(isPlaintext(`${CIPHERTEXT_PREFIX}aesgcm:BBBB`)).toBe(false);
  });

  it('非字符串一律不算明文', () => {
    expect(isPlaintext(undefined)).toBe(false);
    expect(isPlaintext(null)).toBe(false);
    expect(isPlaintext(123)).toBe(false);
  });
});

describe('sealPlaintext', () => {
  it('只封装明文字段，并报告改动数量', () => {
    const { value, sealed } = sealPlaintext(
      { password: 'hunter2', refreshToken: '', accessToken: `${CIPHERTEXT_PREFIX}safe:X` },
      ['password', 'refreshToken', 'accessToken'],
      seal,
    );

    expect(sealed).toBe(1);
    expect(value.password).toBe(`${CIPHERTEXT_PREFIX}sealed(hunter2)`);
    expect(value.refreshToken).toBe('');
    expect(value.accessToken).toBe(`${CIPHERTEXT_PREFIX}safe:X`);
  });

  it('幂等：对已封装的结果再跑一次不产生任何改动', () => {
    const first = sealPlaintext({ password: 'hunter2' }, ['password'], seal);
    const second = sealPlaintext(first.value, ['password'], seal);

    expect(second.sealed).toBe(0);
    expect(second.value.password).toBe(first.value.password);
  });

  it('不修改传入的对象', () => {
    const input = { password: 'hunter2' };
    sealPlaintext(input, ['password'], seal);
    expect(input.password).toBe('hunter2');
  });

  it('未列出的字段原样保留', () => {
    const { value } = sealPlaintext(
      { password: 'hunter2', host: 'imap.example.com' },
      ['password'],
      seal,
    );
    expect(value.host).toBe('imap.example.com');
  });

  it('封装函数收到的是明文本身', () => {
    const spy = vi.fn(seal);
    sealPlaintext({ password: 'hunter2' }, ['password'], spy);
    expect(spy).toHaveBeenCalledWith('hunter2');
  });

  it('字段缺失时不做任何事', () => {
    const { value, sealed } = sealPlaintext({ host: 'imap.example.com' }, ['password'], seal);
    expect(sealed).toBe(0);
    expect(value).toEqual({ host: 'imap.example.com' });
  });
});
