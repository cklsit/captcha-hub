import { describe, expect, it } from 'vitest';
import { generateTotp, validateTotp, withTotpDefaults } from '../electron/totp';
import type { TotpSecret } from '../shared/types';

/**
 * QA-independent TOTP verification against the OFFICIAL RFC 6238 Appendix B
 * test vectors. This is NOT a "generate then validate yourself" loop: each
 * expected value is an externally published constant, so a wrong HMAC / digit
 * truncation / algorithm mapping would be caught.
 *
 * The RFC seeds are ASCII strings; our config field is Base32, so we encode
 * the ASCII bytes to Base32 here (RFC 4648, no padding needed for these).
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 Base32 encoder (no padding). */
function toBase32(ascii: string): string {
  const bytes = Buffer.from(ascii, 'utf8');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function config(
  asciiSecret: string,
  algorithm: TotpSecret['algorithm'],
): TotpSecret {
  return {
    algorithm,
    digits: 8,
    period: 30,
    secret: toBase32(asciiSecret),
    issuer: 'RFC6238',
    account: 'test',
    note: '',
  };
}

describe('QA TOTP — Base32 encoder sanity', () => {
  it('reproduces the well-known Base32 of the SHA1 seed', () => {
    // ASCII "12345678901234567890" -> GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    expect(toBase32('12345678901234567890')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('produces the RFC 4648 Base32 of "Hello!" (sanity of the bit packing)', () => {
    // "Hello!" (6 bytes = 48 bits) -> 10 Base32 chars, zero-padded.
    expect(toBase32('Hello!')).toBe('JBSWY3DPEE');
  });
});

describe('QA TOTP — RFC 6238 Appendix B official vectors', () => {
  const SHA1_SEED = '12345678901234567890';
  const SHA256_SEED = '12345678901234567890123456789012';
  const SHA512_SEED =
    '1234567890123456789012345678901234567890123456789012345678901234';

  const vectors: Array<{
    algo: TotpSecret['algorithm'];
    seed: string;
    t: number;
    expected: string;
  }> = [
    { algo: 'SHA1', seed: SHA1_SEED, t: 59, expected: '94287082' },
    { algo: 'SHA1', seed: SHA1_SEED, t: 1111111109, expected: '07081804' },
    { algo: 'SHA1', seed: SHA1_SEED, t: 1234567890, expected: '89005924' },
    { algo: 'SHA256', seed: SHA256_SEED, t: 59, expected: '46119246' },
    { algo: 'SHA512', seed: SHA512_SEED, t: 59, expected: '90693936' },
  ];

  it.each(vectors)(
    '$algo @ T=$t -> $expected',
    ({ algo, seed, t, expected }) => {
      const result = generateTotp(config(seed, algo), t * 1000);
      expect(result.code).toBe(expected);
      expect(result.code).toHaveLength(8);
      expect(result.period).toBe(30);
    },
  );
});

describe('QA TOTP — countdown / remaining semantics', () => {
  const cfg = config('12345678901234567890', 'SHA1');

  it('remaining = period - (nowSec % period)', () => {
    // T=59s -> 59 % 30 = 29 -> remaining 1
    const r1 = generateTotp(cfg, 59_000);
    expect(r1.remaining).toBe(30 - (59 % 30));
    expect(r1.remaining).toBe(1);
    expect(r1.progress).toBeCloseTo(1 / 30, 6);

    // T=0 -> remaining full period, progress 1
    const r0 = generateTotp(cfg, 0);
    expect(r0.remaining).toBe(30);
    expect(r0.progress).toBeCloseTo(1, 6);

    // T=1111111109 -> 1111111109 % 30 = 29 -> remaining 1
    const r2 = generateTotp(cfg, 1111111109 * 1000);
    expect(r2.remaining).toBe(30 - (1111111109 % 30));
  });
});

describe('QA TOTP — validateTotp window behaviour', () => {
  const cfg = config('12345678901234567890', 'SHA1');
  const nowMs = 1_111_111_109_000;
  const expected = generateTotp(cfg, nowMs).code;

  it('accepts the correct code at the same instant', () => {
    expect(validateTotp(cfg, expected, nowMs)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(validateTotp(cfg, '00000000', nowMs)).toBe(false);
  });

  it('rejects a code from more than one period in the past', () => {
    const twoPeriodsAgo = generateTotp(cfg, nowMs - 2 * 30 * 1000).code;
    expect(validateTotp(cfg, twoPeriodsAgo, nowMs)).toBe(false);
  });

  it('rejects a code from more than one period in the future', () => {
    const twoPeriodsAhead = generateTotp(cfg, nowMs + 2 * 30 * 1000).code;
    expect(validateTotp(cfg, twoPeriodsAhead, nowMs)).toBe(false);
  });
});

describe('QA TOTP — withTotpDefaults', () => {
  it('applies RFC defaults for null/undefined', () => {
    expect(withTotpDefaults(null)).toEqual({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: '',
      issuer: '',
      account: '',
      note: '',
    });
    expect(withTotpDefaults(undefined).algorithm).toBe('SHA1');
  });

  it('coerces an invalid digits value to 6 and a bad period to 30', () => {
    const cfg = withTotpDefaults({ digits: 7 as unknown as 6, period: 0 });
    expect(cfg.digits).toBe(6);
    expect(cfg.period).toBe(30);
  });
});
