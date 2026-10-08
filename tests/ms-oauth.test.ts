import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelLogin,
  classifyTokenResponse,
  clearPendingLogins,
  deviceCodeEndpoint,
  getPendingTokens,
  hasScope,
  isAccessTokenFresh,
  MS_DEFAULT_TENANT,
  MS_IMAP_SCOPE,
  MS_SCOPES,
  MS_SMTP_SCOPE,
  msAuthority,
  parseDeviceCodeResponse,
  parseScopes,
  parseTokenResponse,
  pendingLoginCount,
  pollLogin,
  tokenEndpoint,
} from '../electron/ms-oauth';

/**
 * The Microsoft device-code flow is the only way into an Outlook mailbox now
 * that IMAP Basic Authentication is gone, so its pure pieces are pinned here.
 * Network calls are deliberately not exercised — CI has no Microsoft tenant —
 * but everything that decides "what do these bytes mean" is.
 */

describe('msAuthority', () => {
  it('拼出 v2.0 授权端点', () => {
    expect(msAuthority('common')).toBe('https://login.microsoftonline.com/common/oauth2/v2.0');
  });

  it('租户为空时回落到 common', () => {
    for (const tenant of ['', '   ', '/']) {
      expect(msAuthority(tenant), JSON.stringify(tenant)).toContain(`/${MS_DEFAULT_TENANT}/`);
    }
  });

  it('容忍首尾空白与多余的斜杠', () => {
    expect(msAuthority('  /consumers/  ')).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0',
    );
  });

  it('endpoint 由 authority 派生', () => {
    expect(deviceCodeEndpoint('consumers')).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    );
    expect(tokenEndpoint('consumers')).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    );
  });
});

describe('parseDeviceCodeResponse', () => {
  const valid = {
    device_code: 'DC',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://microsoft.com/devicelogin',
    expires_in: 900,
    interval: 5,
    message: '请访问…',
  };

  it('解析标准响应', () => {
    expect(parseDeviceCodeResponse(valid)).toEqual({
      deviceCode: 'DC',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresInSec: 900,
      intervalSec: 5,
      message: '请访问…',
    });
  });

  it('兼容老字段 verification_url', () => {
    const { verification_uri: _drop, ...rest } = valid;
    expect(parseDeviceCodeResponse({ ...rest, verification_url: 'https://x.test' })?.verificationUri)
      .toBe('https://x.test');
  });

  it('把轮询间隔夹在 5–60 秒', () => {
    expect(parseDeviceCodeResponse({ ...valid, interval: 1 })?.intervalSec).toBe(5);
    expect(parseDeviceCodeResponse({ ...valid, interval: 600 })?.intervalSec).toBe(60);
  });

  it('缺失关键字段时返回 null', () => {
    expect(parseDeviceCodeResponse(null)).toBeNull();
    expect(parseDeviceCodeResponse('nope')).toBeNull();
    expect(parseDeviceCodeResponse({ ...valid, device_code: undefined })).toBeNull();
    expect(parseDeviceCodeResponse({ ...valid, user_code: undefined })).toBeNull();
    expect(parseDeviceCodeResponse({ ...valid, verification_uri: undefined })).toBeNull();
  });
});

describe('parseTokenResponse', () => {
  it('按 expires_in 计算绝对过期时间', () => {
    const now = 1_700_000_000_000;
    const parsed = parseTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'offline_access ' + MS_IMAP_SCOPE },
      now,
    );
    expect(parsed?.accessToken).toBe('AT');
    expect(parsed?.refreshToken).toBe('RT');
    expect(parsed?.expiresAt).toBe(now + 3_600_000);
    expect(parsed?.scopes).toEqual(['offline_access', MS_IMAP_SCOPE]);
  });

  it('服务器未回传 scope 时回落到申请集合（避免永久要求重授权）', () => {
    const parsed = parseTokenResponse({ access_token: 'AT' }, 0);
    expect(parsed?.scopes).toEqual([...MS_SCOPES]);
  });

  it('缺少 access_token 时返回 null', () => {
    expect(parseTokenResponse({ refresh_token: 'RT' })).toBeNull();
    expect(parseTokenResponse(undefined)).toBeNull();
  });

  it('expires_in 缺失或非法时回落到 1 小时', () => {
    const now = 0;
    expect(parseTokenResponse({ access_token: 'AT' }, now)?.expiresAt).toBe(3_600_000);
    expect(parseTokenResponse({ access_token: 'AT', expires_in: 'x' }, now)?.expiresAt).toBe(3_600_000);
  });
});

describe('parseScopes / hasScope', () => {
  it('拆分空格分隔的 scope', () => {
    expect(parseScopes('a b  c')).toEqual(['a', 'b', 'c']);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it('大小写不敏感地判断是否包含某个 scope', () => {
    expect(hasScope([MS_IMAP_SCOPE], MS_IMAP_SCOPE.toUpperCase())).toBe(true);
    expect(hasScope([MS_IMAP_SCOPE], MS_SMTP_SCOPE)).toBe(false);
  });
});

describe('classifyTokenResponse', () => {
  it('没有 error 字段且带 access_token 即为成功', () => {
    const outcome = classifyTokenResponse({ access_token: 'AT', refresh_token: 'RT' });
    expect(outcome.status).toBe('success');
  });

  it('authorization_pending 视为继续等待', () => {
    expect(classifyTokenResponse({ error: 'authorization_pending' }).status).toBe('pending');
  });

  it('slow_down 单独区分，便于放慢轮询', () => {
    expect(classifyTokenResponse({ error: 'slow_down' }).status).toBe('slow_down');
  });

  it('终态错误各自给出可读说明', () => {
    const cases: Array<[string, string]> = [
      ['expired_token', '过期'],
      ['authorization_declined', '取消'],
      ['bad_verification_code', '无效'],
      ['invalid_client', 'client'],
      ['invalid_grant', '失效'],
    ];
    for (const [error, fragment] of cases) {
      const outcome = classifyTokenResponse({ error });
      expect(outcome.status, error).toBe('error');
      expect(outcome.status === 'error' ? outcome.message : '', error).toContain(fragment);
    }
  });

  it('未知错误也带上原文，便于排查', () => {
    const outcome = classifyTokenResponse({ error: 'weird_error', error_description: '详情' });
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' ? outcome.message : '').toContain('weird_error');
  });

  it('响应不可解析时报错而不是抛出', () => {
    expect(classifyTokenResponse(null).status).toBe('error');
    expect(classifyTokenResponse('html').status).toBe('error');
  });
});

describe('isAccessTokenFresh', () => {
  const now = 1_000_000;

  it('留出安全余量，避免取信即将过期的令牌', () => {
    expect(isAccessTokenFresh(now + 60_000, now)).toBe(false);
    expect(isAccessTokenFresh(now + 120_001, now)).toBe(true);
  });

  it('从未获取过令牌（0）一律视为不新鲜', () => {
    expect(isAccessTokenFresh(0, now)).toBe(false);
  });
});

describe('待处理登录注册表', () => {
  beforeEach(() => {
    clearPendingLogins();
  });

  it('未知 flowId 查不到令牌，且不抛异常', () => {
    expect(getPendingTokens('nope')).toBeNull();
  });

  it('取消会移除会话', () => {
    cancelLogin('nope');
    expect(pendingLoginCount()).toBe(0);
  });

  it('pollLogin 对未知 flowId 直接返回错误，不发起网络请求', async () => {
    const result = await pollLogin('does-not-exist');
    expect(result.status).toBe('error');
    expect(result.message).toContain('重新发起');
  });
});

describe('请求的权限范围', () => {
  it('同时申请 IMAP 访问与 offline_access（否则拿不到刷新令牌）', () => {
    expect(MS_IMAP_SCOPE).toBe('https://outlook.office.com/IMAP.AccessAsUser.All');
  });

  it('v2 起额外申请 SMTP.Send 以便发信', () => {
    expect(MS_SMTP_SCOPE).toBe('https://outlook.office.com/SMTP.Send');
    expect(MS_SCOPES).toContain(MS_IMAP_SCOPE);
    expect(MS_SCOPES).toContain(MS_SMTP_SCOPE);
    expect(MS_SCOPES).toContain('offline_access');
  });
});
