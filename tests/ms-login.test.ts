import { afterEach, describe, expect, it } from 'vitest';
import {
  cancelLogin,
  clearPendingLogins,
  getPendingTokens,
  msLoginPoll,
  msLoginStart,
  pendingLoginCount,
} from '../electron/ms-login';

/**
 * `ms-login.ts` orchestrates the two grants. Only the paths that do not touch
 * the network are asserted here — the browser round-trip and the device-code
 * exchange both need a real Microsoft tenant, which CI does not have. The
 * pieces that decide their behaviour are covered in `ms-authcode.test.ts` and
 * `ms-oauth.test.ts`.
 */

afterEach(() => {
  clearPendingLogins();
});

describe('msLoginStart 的入口校验', () => {
  it('未填 client ID 时立即失败，不做任何网络请求', async () => {
    const result = await msLoginStart('', 'common');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('client) ID');
  });

  it('纯空白的 client ID 同样被拒', async () => {
    expect((await msLoginStart('   ', 'common')).ok).toBe(false);
  });

  it('失败时不会留下悬挂的登录会话', async () => {
    await msLoginStart('', 'common');
    expect(pendingLoginCount()).toBe(0);
  });
});

describe('登录会话注册表', () => {
  it('未知 flowId 查不到令牌', () => {
    expect(getPendingTokens('nope')).toBeNull();
  });

  it('未知 flowId 轮询返回可读错误且不发网络请求', async () => {
    const result = await msLoginPoll('nope');
    expect(result.status).toBe('error');
    expect(result.message).toContain('重新发起');
  });

  it('取消不存在的会话是安全的空操作', () => {
    expect(() => cancelLogin('nope')).not.toThrow();
    expect(pendingLoginCount()).toBe(0);
  });

  it('清空是幂等的', () => {
    clearPendingLogins();
    clearPendingLogins();
    expect(pendingLoginCount()).toBe(0);
  });
});
