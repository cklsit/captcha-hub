import { describe, expect, it } from 'vitest';
import { parseOtpAuthUri } from '../electron/otpauth';

/**
 * `parseOtpAuthUri` backs the 2FA QR-scan feature. Real enrolment QR codes come
 * from a dozen different apps that each format the Key URI slightly
 * differently, so the cases below mirror what those apps actually emit.
 */

const SECRET = 'JBSWY3DPEHPK3PXP';

describe('parseOtpAuthUri', () => {
  it('解析最典型的 otpauth://totp 二维码', () => {
    expect(
      parseOtpAuthUri(
        `otpauth://totp/ACME%20Co:john@acme.com?secret=${SECRET}&issuer=ACME%20Co`,
      ),
    ).toEqual({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: SECRET,
      issuer: 'ACME Co',
      account: 'john@acme.com',
    });
  });

  it('读取 algorithm / digits / period 参数', () => {
    const draft = parseOtpAuthUri(
      `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`,
    );
    expect(draft).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 60, issuer: 'GitHub' });
  });

  it('algorithm 大小写不敏感', () => {
    expect(parseOtpAuthUri(`otpauth://totp/x?secret=${SECRET}&algorithm=sha512`)?.algorithm).toBe(
      'SHA512',
    );
  });

  it('issuer 参数缺省时回落到标签里的「发行方:账户」', () => {
    expect(parseOtpAuthUri(`otpauth://totp/GitHub:me@x.com?secret=${SECRET}`)).toMatchObject({
      issuer: 'GitHub',
      account: 'me@x.com',
    });
  });

  it('issuer 参数优先于标签', () => {
    expect(
      parseOtpAuthUri(`otpauth://totp/LabelIssuer:me?secret=${SECRET}&issuer=ParamIssuer`),
    ).toMatchObject({ issuer: 'ParamIssuer', account: 'me' });
  });

  it('标签里没有冒号时整段视为账户名', () => {
    expect(parseOtpAuthUri(`otpauth://totp/justanaccount?secret=${SECRET}`)).toMatchObject({
      issuer: '',
      account: 'justanaccount',
    });
  });

  it('宽松处理密钥的大小写、空格与 = 填充', () => {
    const draft = parseOtpAuthUri(`otpauth://totp/x?secret=jbswy3dp ehpk3pxp==`);
    expect(draft?.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('忽略非法/越界的可选参数并回落到默认值', () => {
    const draft = parseOtpAuthUri(
      `otpauth://totp/x?secret=${SECRET}&algorithm=MD5&digits=7&period=0`,
    );
    expect(draft).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('拒绝 HOTP（基于计数器，本应用不支持）', () => {
    expect(parseOtpAuthUri(`otpauth://hotp/x?secret=${SECRET}&counter=1`)).toBeNull();
  });

  it('拒绝缺失或非法的密钥', () => {
    expect(parseOtpAuthUri('otpauth://totp/x?issuer=Y')).toBeNull();
    // Base32 不含 0/1/8/9。
    expect(parseOtpAuthUri('otpauth://totp/x?secret=0189ABCD')).toBeNull();
    // 过短，不可能是有效密钥。
    expect(parseOtpAuthUri('otpauth://totp/x?secret=ABCD')).toBeNull();
  });

  it('拒绝非 otpauth 内容与非法 URL', () => {
    expect(parseOtpAuthUri('https://example.com/?secret=' + SECRET)).toBeNull();
    expect(parseOtpAuthUri('随便一段文字')).toBeNull();
    expect(parseOtpAuthUri('')).toBeNull();
    expect(parseOtpAuthUri('otpauth://')).toBeNull();
  });
});
