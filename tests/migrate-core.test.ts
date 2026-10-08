import { describe, expect, it } from 'vitest';
import { migrateV1ToV2, type LegacyStore } from '../electron/migrate-core';

/**
 * v1 → v2 conversion is a one-shot data-loss-sensitive path, so it is pinned
 * here against a synthetic legacy store: email sources → accounts, totp sources
 * → entries, phone sources dropped (and counted), and CaptchaMessage → an
 * envelope plus a `bodyTruncated` body file. All data is synthetic (`example.com`).
 */

function legacyStore(): LegacyStore {
  return {
    sources: [
      {
        id: 'email-1',
        kind: 'email',
        name: '我的邮箱',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        lastSyncAt: 2000,
        lastSyncStatus: 'ok',
        lastSyncError: null,
        email: {
          host: 'imap.example.com',
          port: 993,
          secure: true,
          username: 'me@example.com',
          password: 'plain-secret',
          mailbox: 'INBOX',
          authType: 'password',
          clientId: '',
          tenant: 'common',
          refreshToken: '',
          accessToken: '',
          accessTokenExpiresAt: 0,
        },
        phone: null,
        totp: null,
      },
      {
        id: 'phone-1',
        kind: 'phone',
        name: '138****8000',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        lastSyncAt: null,
        lastSyncStatus: 'never',
        lastSyncError: null,
        email: null,
        phone: { phoneNumber: '+8613800138000' },
        totp: null,
      },
      {
        id: 'totp-1',
        kind: 'totp',
        name: 'GitHub 2FA',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        lastSyncAt: null,
        lastSyncStatus: 'never',
        lastSyncError: null,
        email: null,
        phone: null,
        totp: {
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: 'JBSWY3DPEHPK3PXP',
          issuer: 'GitHub',
          account: 'me@example.com',
          note: '',
        },
      },
    ],
    messages: [
      {
        id: 'msg-1',
        sourceId: 'email-1',
        code: '483920',
        confidence: 0.9,
        matchedKeyword: '验证码',
        expiresAtHint: null,
        subject: '登录验证',
        from: 'noreply@example.com',
        summary: '您的验证码是 483920',
        receivedAt: 5000,
        ingestedAt: 5001,
        read: true,
        uid: '101',
      },
      {
        id: 'msg-2',
        sourceId: 'phone-1',
        code: '111111',
        confidence: 0.9,
        matchedKeyword: '验证码',
        expiresAtHint: null,
        subject: '短信转发',
        from: 'forward@example.com',
        summary: '验证码 111111',
        receivedAt: 6000,
        ingestedAt: 6001,
        read: false,
        uid: '202',
      },
    ],
    settings: { theme: 'light', pollIntervalSec: 120, launchOnStartup: true, pinRecent: false },
  };
}

describe('migrateV1ToV2', () => {
  const result = migrateV1ToV2(legacyStore());

  it('把 email 来源升级为 Account，并带上 IMAP 凭据与默认同步文件夹', () => {
    expect(result.accounts).toHaveLength(1);
    const account = result.accounts[0];
    expect(account.id).toBe('email-1');
    expect(account.imap.host).toBe('imap.example.com');
    expect(account.imap.password).toBe('plain-secret');
    expect(account.syncFolders).toEqual(['INBOX']);
    expect(account.smtp).toBeNull();
  });

  it('把 totp 来源升级为 TotpEntry', () => {
    expect(result.totpEntries).toHaveLength(1);
    expect(result.totpEntries[0].totp.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(result.totpEntries[0].totp.issuer).toBe('GitHub');
  });

  it('丢弃 phone 来源并计数', () => {
    expect(result.droppedPhoneCount).toBe(1);
    expect(result.accounts.some((account) => account.id === 'phone-1')).toBe(false);
  });

  it('把 CaptchaMessage 转成 Envelope + 正文文件，并标记 bodyTruncated', () => {
    expect(result.envelopes).toHaveLength(1);
    const envelope = result.envelopes[0];
    expect(envelope.accountId).toBe('email-1');
    expect(envelope.folderId).toBe('INBOX');
    expect(envelope.uid).toBe('101');
    expect(envelope.flags.seen).toBe(true);
    expect(envelope.highlight?.code).toBe('483920');
    expect(envelope.bodyTruncated).toBe(true);

    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0].body.text).toBe('您的验证码是 483920');
    expect(result.bodies[0].uid).toBe('101');
  });

  it('归属到被丢弃 phone 来源的邮件一并跳过', () => {
    expect(result.envelopes.some((envelope) => envelope.uid === '202')).toBe(false);
    expect(result.migratedMessageCount).toBe(1);
  });

  it('合并旧设置并填充新字段默认值', () => {
    expect(result.settings.theme).toBe('light');
    expect(result.settings.pollIntervalSec).toBe(120);
    expect(result.settings.launchOnStartup).toBe(true);
    expect(result.settings.bodyRenderMode).toBe('html');
    expect(result.settings.migratedFromV1).toBe(false);
  });

  it('容忍空的 / 损坏的输入，不抛异常', () => {
    const empty = migrateV1ToV2(null);
    expect(empty.accounts).toEqual([]);
    expect(empty.envelopes).toEqual([]);
    expect(empty.droppedPhoneCount).toBe(0);
    const partial = migrateV1ToV2({ sources: undefined, messages: undefined });
    expect(partial.accounts).toEqual([]);
  });
});
