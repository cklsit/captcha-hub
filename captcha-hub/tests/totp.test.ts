import { describe, expect, it } from 'vitest';
import { generateTotp, validateTotp, withTotpDefaults } from '../electron/totp';
import type { TotpSecret } from '../shared/types';

/** Base32 of the RFC 6238 SHA1 seed (ASCII "12345678901234567890"). */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const rfcConfig: TotpSecret = {
  algorithm: 'SHA1',
  digits: 8,
  period: 30,
  secret: RFC_SECRET,
  issuer: 'RFC',
  account: 'test',
  note: '',
};

describe('generateTotp', () => {
  it('matches the RFC 6238 SHA1 test vector at T=59s', () => {
    const result = generateTotp(rfcConfig, 59_000);
    expect(result.code).toBe('94287082');
    expect(result.period).toBe(30);
    expect(result.remaining).toBe(1);
    expect(result.progress).toBeCloseTo(1 / 30, 5);
  });

  it('produces a stable 6-digit code for a fixed time', () => {
    const config: TotpSecret = {
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: '',
      account: '',
      note: '',
    };
    const first = generateTotp(config, 1_700_000_000_000);
    const second = generateTotp(config, 1_700_000_000_000);
    expect(first.code).toBe(second.code);
    expect(first.code).toHaveLength(6);
    expect(/^\d{6}$/.test(first.code)).toBe(true);
  });

  it('rotates the code across a period boundary', () => {
    const config: TotpSecret = {
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: '',
      account: '',
      note: '',
    };
    const before = generateTotp(config, 30_000).code;
    const after = generateTotp(config, 60_000).code;
    expect(before).not.toBe(after);
  });
});

describe('validateTotp', () => {
  it('accepts the generated code and rejects a wrong one', () => {
    const config: TotpSecret = {
      algorithm: 'SHA256',
      digits: 6,
      period: 30,
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: '',
      account: '',
      note: '',
    };
    const now = 1_700_000_000_000;
    const code = generateTotp(config, now).code;
    expect(validateTotp(config, code, now)).toBe(true);
    expect(validateTotp(config, '000000', now)).toBe(false);
  });
});

describe('withTotpDefaults', () => {
  it('applies RFC defaults', () => {
    expect(withTotpDefaults(null)).toEqual({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: '',
      issuer: '',
      account: '',
      note: '',
    });
  });

  it('preserves provided values', () => {
    const config = withTotpDefaults({ algorithm: 'SHA512', digits: 8, period: 60, secret: 'ABC' });
    expect(config.algorithm).toBe('SHA512');
    expect(config.digits).toBe(8);
    expect(config.period).toBe(60);
    expect(config.secret).toBe('ABC');
  });
});
