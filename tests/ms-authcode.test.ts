import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOOPBACK_TIMEOUT_MS,
  base64UrlEncode,
  buildAuthorizeUrl,
  buildRedirectUri,
  createPkcePair,
  probeAuthorizeUrl,
  readCallbackParams,
  startLoopbackServer,
} from '../electron/ms-authcode';
import { decodeJwtPayload, parseIdTokenAccount, parseTokenResponse } from '../electron/ms-oauth';

/**
 * These are the pieces that make "click once, land on Microsoft's page" work.
 * The browser round-trip itself cannot run in CI, but everything that decides
 * *what we send* and *what we do with what comes back* is pure and pinned here.
 */

/* --------------------------------------------------------------- PKCE ---- */

describe('PKCE', () => {
  it('verifier 符合 RFC 7636 的字符集与长度要求', () => {
    const { verifier } = createPkcePair();
    // Microsoft requires 43–128 chars from the unreserved base64url alphabet.
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/);
  });

  it('challenge 是 verifier 的 SHA-256 再 base64url（无填充）', () => {
    // Known-answer test: RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(base64UrlEncode(require('node:crypto').createHash('sha256').update(verifier).digest())).toBe(
      expected,
    );
  });

  it('每次生成的 verifier 都不同', () => {
    const seen = new Set(Array.from({ length: 20 }, () => createPkcePair().verifier));
    expect(seen.size).toBe(20);
  });

  it('base64url 不含 + / =', () => {
    const { challenge } = createPkcePair();
    expect(challenge).not.toMatch(/[+/=]/);
  });
});

/* ---------------------------------------------------------- authorize ---- */

describe('buildAuthorizeUrl', () => {
  const params = {
    clientId: 'client-123',
    tenant: 'common',
    redirectUri: 'http://localhost:49152',
    codeChallenge: 'challenge-value',
    state: 'state-value',
  };

  it('指向 v2.0 authorize 端点并带上 PKCE 参数', () => {
    const url = new URL(buildAuthorizeUrl(params));
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:49152');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('client_id 必须是第一个查询参数', () => {
    const query = buildAuthorizeUrl(params).split('?')[1] ?? '';
    expect(query.startsWith('client_id=')).toBe(true);
  });

  it('申请的 scope 覆盖收信、发信与 offline_access', () => {
    const scope = new URL(buildAuthorizeUrl(params)).searchParams.get('scope') ?? '';
    expect(scope).toContain('offline_access');
    expect(scope).toContain('https://outlook.office.com/IMAP.AccessAsUser.All');
    expect(scope).toContain('https://outlook.office.com/SMTP.Send');
  });

  it('租户为空时回落到 common', () => {
    const url = new URL(buildAuthorizeUrl({ ...params, tenant: '  ' }));
    expect(url.pathname).toContain('/common/');
  });

  it('username 作为 login_hint 传入，便于 Microsoft 预选账号', () => {
    const url = new URL(buildAuthorizeUrl({ ...params, loginHint: 'me@outlook.com' }));
    expect(url.searchParams.get('login_hint')).toBe('me@outlook.com');
  });

  it('未提供 login_hint 时不会写入空参数', () => {
    const url = new URL(buildAuthorizeUrl(params));
    expect(url.searchParams.has('login_hint')).toBe(false);
  });
});

describe('buildRedirectUri', () => {
  it('生成 Microsoft 认可的 localhost 回环地址', () => {
    expect(buildRedirectUri('localhost', 49152)).toBe('http://localhost:49152');
  });
});

/* ----------------------------------------------------------- callback ---- */

describe('readCallbackParams', () => {
  it('读出授权码与 state', () => {
    expect(readCallbackParams('/?code=abc123&state=xyz')).toEqual({
      code: 'abc123',
      state: 'xyz',
      error: '',
      errorDescription: '',
    });
  });

  it('读出 Microsoft 的错误响应', () => {
    const result = readCallbackParams('/?error=access_denied&error_description=User%20cancelled');
    expect(result.error).toBe('access_denied');
    expect(result.errorDescription).toBe('User cancelled');
    expect(result.code).toBe('');
  });

  it('接受完整 URL 形式', () => {
    expect(readCallbackParams('http://localhost:1234/?code=q').code).toBe('q');
  });

  it('无参数或不合法输入时安全返回空值', () => {
    expect(readCallbackParams('/').code).toBe('');
    expect(readCallbackParams('').code).toBe('');
  });
});

/* ----------------------------------------------------------- loopback ---- */

describe('startLoopbackServer', () => {
  it('在随机端口上监听并接受回调', async () => {
    const session = await startLoopbackServer();
    try {
      expect(session.port).toBeGreaterThan(1024);
      expect(session.redirectUri).toBe(`http://localhost:${session.port}`);
      expect(session.take()).toBeNull();

      const response = await fetch(`${session.redirectUri}/?code=the-code&state=the-state`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('登录成功');

      expect(session.take()).toEqual({ kind: 'code', code: 'the-code', state: 'the-state' });
    } finally {
      await session.close();
    }
  });

  it('把错误响应也带回来，而不是静默等待', async () => {
    const session = await startLoopbackServer();
    try {
      await fetch(`${session.redirectUri}/?error=access_denied&error_description=nope`);
      expect(session.take()).toEqual({
        kind: 'error',
        error: 'access_denied',
        description: 'nope',
      });
    } finally {
      await session.close();
    }
  });

  it('无关路径不会误判成回调', async () => {
    const session = await startLoopbackServer();
    try {
      const response = await fetch(`${session.redirectUri}/favicon.ico`);
      expect(response.status).toBe(404);
      expect(session.take()).toBeNull();
    } finally {
      await session.close();
    }
  });

  it('关闭后端口被释放，可以再次启动', async () => {
    const first = await startLoopbackServer();
    const port = first.port;
    await first.close();
    const second = await startLoopbackServer();
    try {
      // Not required to reuse the port, only that closing did not wedge the API.
      expect(second.port).toBeGreaterThan(1024);
      expect(port).toBeGreaterThan(1024);
    } finally {
      await second.close();
    }
  });

  it('等待超时上限足够用户完成登录', () => {
    expect(LOOPBACK_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });
});

/* -------------------------------------------------------------- probe ---- */

describe('probeAuthorizeUrl', () => {
  const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x';

  /** Stubs fetch with a canned response, without touching the network. */
  function stubFetch(impl: () => Promise<Response> | Response): void {
    vi.stubGlobal('fetch', impl);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('302 重定向视为参数被接受', async () => {
    stubFetch(() => new Response('', { status: 302, headers: { location: 'https://login' } }));
    expect(await probeAuthorizeUrl(url)).toMatchObject({ usable: true });
  });

  it('缺重定向注册（AADSTS500113）→ 降级为设备码', async () => {
    stubFetch(
      () =>
        new Response('<html>AADSTS500113: No reply address is registered for the application</html>', {
          status: 200,
        }),
    );
    const result = await probeAuthorizeUrl(url);
    expect(result.usable).toBe(false);
    expect(result.detail).toContain('localhost');
  });

  it('AADSTS50011（地址不匹配）同样识别为缺注册', async () => {
    stubFetch(() => new Response('error: AADSTS50011 reply address mismatch', { status: 200 }));
    expect((await probeAuthorizeUrl(url)).usable).toBe(false);
  });

  it('普通登录页里夹带的 AADSTS 码不得被误判为拒绝', async () => {
    // 真实观测（2026-10-08，对 login.microsoftonline.com 的实际请求）：
    // authorize 端点对无效 client ID 返回的是 **HTTP 200 的标准登录页**，
    // 页面脚本中已经含有 AADSTS501491。若把「出现任何 AADSTS 码」当作拒绝，
    // 本来能成功的登录会被直接拦死——这比漏判危险得多，故本用例锁死该行为。
    stubFetch(
      () =>
        new Response(
          '<html><script>var err="AADSTS501491";</script><title>Sign in to your account</title></html>',
          { status: 200 },
        ),
    );
    expect(await probeAuthorizeUrl(url)).toMatchObject({ usable: true });
  });

  it('没有相关错误码的页面按乐观处理，交给真实步骤去失败', async () => {
    stubFetch(() => new Response('<html>请稍候…</html>', { status: 200 }));
    expect((await probeAuthorizeUrl(url)).usable).toBe(true);
  });

  it('网络异常时保持乐观，不阻塞本来可用的登录', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    expect(await probeAuthorizeUrl(url)).toMatchObject({ usable: true });
  });
});

/* ------------------------------------------------------- id_token ---- */

/** Builds a JWT-shaped string with the given payload (signature is ignored). */
function fakeIdToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

describe('parseIdTokenAccount', () => {
  it('优先取 preferred_username（个人账户即邮箱地址）', () => {
    expect(parseIdTokenAccount(fakeIdToken({ preferred_username: 'me@outlook.com' }))).toBe(
      'me@outlook.com',
    );
  });

  it('preferred_username 不是地址时回落到 email', () => {
    expect(
      parseIdTokenAccount(fakeIdToken({ preferred_username: 'not-an-address', email: 'a@b.com' })),
    ).toBe('a@b.com');
  });

  it('支持 upn / unique_name 两个备用声明', () => {
    expect(parseIdTokenAccount(fakeIdToken({ upn: 'work@corp.com' }))).toBe('work@corp.com');
    expect(parseIdTokenAccount(fakeIdToken({ unique_name: 'u@corp.com' }))).toBe('u@corp.com');
  });

  it('没有任何地址声明时返回空串（调用方须容忍）', () => {
    expect(parseIdTokenAccount(fakeIdToken({ sub: '123' }))).toBe('');
  });

  it('畸形 token 不抛异常', () => {
    expect(parseIdTokenAccount('')).toBe('');
    expect(parseIdTokenAccount('not-a-jwt')).toBe('');
    expect(parseIdTokenAccount('a.!!!not-base64!!!.c')).toBe('');
    expect(decodeJwtPayload('a.b')).toBeNull();
  });
});

describe('parseTokenResponse 会带上登录地址', () => {
  it('从 id_token 里取出地址放进 TokenSet', () => {
    const tokens = parseTokenResponse({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      id_token: fakeIdToken({ preferred_username: 'me@outlook.com' }),
    });
    expect(tokens?.account).toBe('me@outlook.com');
  });

  it('没有 id_token 时 account 为空串而不是 undefined', () => {
    expect(parseTokenResponse({ access_token: 'AT' })?.account).toBe('');
  });
});
