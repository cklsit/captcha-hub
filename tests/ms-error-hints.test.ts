import { describe, expect, it } from 'vitest';
import {
  classifyTokenResponse,
  describeClientId,
  describeMicrosoftAuthError,
  KNOWN_FIRST_PARTY_CLIENT_IDS,
} from '../electron/ms-oauth';

/**
 * Two guards live here.
 *
 * `describeClientId` exists because the Azure portal puts its *own* application
 * ID in front of the user constantly — it is in the portal's address bar and in
 * the body of the very sign-in error people hit while trying to register an
 * app. Pasting it into this app's Client ID field then produces the consent
 * screen for Microsoft's app rather than the user's, which is as confusing as
 * it gets.
 *
 * `describeMicrosoftAuthError` exists because the code that matters most,
 * AADSTS50020, is caused by a policy the user cannot change from inside this
 * app: a personal Microsoft account lives in the directory-less "Microsoft
 * Services" tenant, so it can neither register an app nor be granted one.
 * Saying so plainly — together with the two paths that do work — is the whole
 * point.
 */

describe('describeClientId', () => {
  it('空值提示先填写', () => {
    expect(describeClientId('')).toContain('请先填写');
    expect(describeClientId('   ')).toContain('请先填写');
  });

  it('识别 Azure 门户自己的应用 ID（ADIbizaUX）', () => {
    const message = describeClientId('74658136-14ec-4630-ad9b-26e160ff0fc6');
    expect(message).toContain('Microsoft 自家的应用');
    expect(message).toContain('Azure 门户');
  });

  it('其他微软一方应用同样被拦下', () => {
    for (const [id, name] of Object.entries(KNOWN_FIRST_PARTY_CLIENT_IDS)) {
      expect(describeClientId(id)).toContain(name);
    }
  });

  it('大小写与空格不影响判定', () => {
    expect(describeClientId('  74658136-14EC-4630-AD9B-26E160FF0FC6 ')).toContain('Azure 门户');
  });

  it('不是 GUID 时提示别复制成对象 ID / 租户 ID', () => {
    const message = describeClientId('abc-123');
    expect(message).toContain('形如');
    expect(message).toContain('对象 ID');
  });

  it('形如 GUID 的自建应用放行', () => {
    expect(describeClientId('11111111-2222-3333-4444-555555555555')).toBeNull();
  });
});

describe('describeMicrosoftAuthError', () => {
  it('AADSTS50020 说明「Microsoft Services 租户」并给出可行路径', () => {
    const real =
      "AADSTS50020: User account 'someone@outlook.com' from identity provider 'live.com' does not " +
      "exist in tenant 'Microsoft Services' and cannot access the application " +
      "'74658136-14ec-4630-ad9b-26e160ff0fc6'(ADIbizaUX) in that tenant.";
    const message = describeMicrosoftAuthError(real);

    expect(message).toContain('Microsoft Services');
    expect(message).toContain('azure.microsoft.com/free');
    expect(message).toContain('转发');
    // The user must not be sent chasing a password problem that does not exist.
    expect(message).toContain('与密码是否正确无关');
  });

  it('AADSTS16000 / 160021 / 50058 归为同一类问题', () => {
    for (const code of ['AADSTS16000', 'AADSTS160021', 'AADSTS50058']) {
      expect(describeMicrosoftAuthError(`${code}: something went wrong`)).toContain(
        'Microsoft Services',
      );
    }
  });

  it('AADSTS700038 指向 Client ID 复制错误', () => {
    expect(describeMicrosoftAuthError('AADSTS700038: not a valid application identifier')).toContain(
      '不是有效的应用标识',
    );
  });

  it('invalid_client 指向公共客户端流开关', () => {
    expect(describeMicrosoftAuthError('invalid_client: AADSTS7000218')).toContain('公共客户端流');
  });

  it('权限缺失指向 IMAP / SMTP 权限', () => {
    expect(describeMicrosoftAuthError('AADSTS65001: consent required')).toContain(
      'IMAP.AccessAsUser.All',
    );
  });

  it('未注册回调地址时提示加 http://localhost', () => {
    expect(describeMicrosoftAuthError('AADSTS50011: reply url mismatch')).toContain('localhost');
    expect(describeMicrosoftAuthError('AADSTS500113: no reply address')).toContain('localhost');
  });

  it('AADSTS500113 不会被 50011 分支提前截断而漏判', () => {
    expect(describeMicrosoftAuthError('AADSTS500113')).not.toBeNull();
  });

  it('无法归类的错误返回 null，交给调用方展示原文', () => {
    expect(describeMicrosoftAuthError('AADSTS501491: something unrelated')).toBeNull();
    expect(describeMicrosoftAuthError('')).toBeNull();
  });
});

describe('classifyTokenResponse 接入错误翻译', () => {
  it('设备码路径的 AADSTS50020 也给出可读说明', () => {
    const outcome = classifyTokenResponse({
      error: 'invalid_grant',
      error_description:
        "AADSTS50020: User account from identity provider 'live.com' does not exist in tenant " +
        "'Microsoft Services'.",
    });

    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.message).toContain('Microsoft Services');
  });

  it('普通未识别错误仍保留原文', () => {
    const outcome = classifyTokenResponse({
      error: 'some_new_error',
      error_description: 'something we have not seen',
    });

    expect(outcome.status === 'error' && outcome.message).toContain('some_new_error');
    expect(outcome.status === 'error' && outcome.message).toContain('something we have not seen');
  });
});
