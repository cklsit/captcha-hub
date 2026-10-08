import { randomUUID } from 'node:crypto';
import {
  MAX_INTERVAL_SEC,
  MS_DEFAULT_TENANT,
  MS_SCOPES,
  classifyTokenResponse,
  describeClientId,
  describeMicrosoftAuthError,
  deviceCodeEndpoint,
  parseDeviceCodeResponse,
  postForm,
  tokenEndpoint,
  type TokenSet,
} from './ms-oauth';
import {
  LOOPBACK_TIMEOUT_MS,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthCode,
  probeAuthorizeUrl,
  startLoopbackServer,
  type LoopbackSession,
} from './ms-authcode';
import type {
  MsLoginMode,
  MsLoginPollResult,
  MsLoginStartResult,
  MsLoginStatus,
} from '../shared/types';

/**
 * Orchestrates a Microsoft sign-in. Two grants, one code path for callers.
 *
 * Primary — authorization code + PKCE over a loopback redirect. The user clicks
 * once; the browser opens Microsoft's own sign-in page; Microsoft hands the
 * code back to a short-lived listener on this machine. Nothing is typed into
 * the app and the password never leaves Microsoft.
 *
 * Fallback — device code. Used when the Azure app has no `http://localhost`
 * reply address registered (Microsoft would answer the redirect with an error
 * page), when the local listener cannot bind, or when the browser simply never
 * comes back. Same security properties, but the user retypes a short code.
 *
 * Either way the tokens stay in this process: the renderer only receives a
 * status, an authorize URL and — in device mode — the user code.
 */

/** How long to wait for the browser to return before switching to device code. */
const REDIRECT_GRACE_MS = 45_000;

/** How often the renderer should call back while a redirect is outstanding. */
const REDIRECT_POLL_SEC = 2;

interface PendingLogin {
  mode: MsLoginMode;
  clientId: string;
  tenant: string;
  /** When the login as a whole stops being accepted. */
  expiresAt: number;
  startedAt: number;
  tokens: TokenSet | null;

  /* redirect mode */
  loopback: LoopbackSession | null;
  codeVerifier: string;
  redirectUri: string;
  state: string;

  /* device mode */
  deviceCode: string;
  intervalSec: number;
  userCode: string;
  verificationUri: string;
}

/** Keyed by flow id; lives for the lifetime of the app process only. */
const pendingLogins = new Map<string, PendingLogin>();

/** Tokens for a completed login, or null while it is still pending. */
export function getPendingTokens(flowId: string): TokenSet | null {
  return pendingLogins.get(flowId)?.tokens ?? null;
}

export function cancelLogin(flowId: string): void {
  const entry = pendingLogins.get(flowId);
  if (entry?.loopback) {
    void entry.loopback.close().catch(() => undefined);
  }
  pendingLogins.delete(flowId);
}

/** Test seam — drops every pending login and releases its listener. */
export function clearPendingLogins(): void {
  for (const entry of pendingLogins.values()) {
    if (entry.loopback) void entry.loopback.close().catch(() => undefined);
  }
  pendingLogins.clear();
}

export function pendingLoginCount(): number {
  return pendingLogins.size;
}

/* ------------------------------------------------------------------ start */

function baseEntry(clientId: string, tenant: string): Omit<PendingLogin, 'mode'> {
  return {
    clientId,
    tenant,
    expiresAt: 0,
    startedAt: Date.now(),
    tokens: null,
    loopback: null,
    codeVerifier: '',
    redirectUri: '',
    state: '',
    deviceCode: '',
    intervalSec: 5,
    userCode: '',
    verificationUri: '',
  };
}

/** Starts a device-code login; used as the primary fallback path. */
async function startDeviceLogin(clientId: string, tenant: string): Promise<MsLoginStartResult> {
  try {
    const payload = await postForm(deviceCodeEndpoint(tenant), {
      client_id: clientId,
      scope: MS_SCOPES.join(' '),
    });
    const info = parseDeviceCodeResponse(payload);
    if (!info) {
      const raw = payload as Record<string, unknown> | null;
      const detail = raw ? String(raw.error_description ?? raw.error ?? '') : '';
      const hint = describeMicrosoftAuthError(detail);
      return {
        ok: false,
        message:
          hint ?? (detail ? `无法获取设备码：${detail}` : '无法获取设备码，请检查 Application (client) ID 与网络。'),
      };
    }

    const flowId = randomUUID();
    pendingLogins.set(flowId, {
      ...baseEntry(clientId, tenant),
      mode: 'device',
      expiresAt: Date.now() + info.expiresInSec * 1000,
      deviceCode: info.deviceCode,
      intervalSec: info.intervalSec,
      userCode: info.userCode,
      verificationUri: info.verificationUri,
    });

    return {
      ok: true,
      mode: 'device',
      message: info.message || '请在浏览器中打开页面并输入设备码。',
      flowId,
      userCode: info.userCode,
      verificationUri: info.verificationUri,
      expiresInSec: info.expiresInSec,
      intervalSec: info.intervalSec,
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接 Microsoft 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Starts a sign-in. Prefers the redirect flow and degrades to device code
 * automatically, so an Azure app that has not registered `http://localhost`
 * still works exactly as it did before.
 */
export async function msLoginStart(
  clientId: string,
  tenant: string,
  loginHint = '',
): Promise<MsLoginStartResult> {
  const problem = describeClientId(clientId);
  if (problem) return { ok: false, message: problem };

  const id = clientId.trim();
  const tenantId = (tenant || '').trim() || MS_DEFAULT_TENANT;

  try {
    const loopback = await startLoopbackServer();
    const pkce = createPkcePair();
    const state = randomUUID();
    const authorizeUrl = buildAuthorizeUrl({
      clientId: id,
      tenant: tenantId,
      redirectUri: loopback.redirectUri,
      codeChallenge: pkce.challenge,
      state,
      loginHint,
    });

    const probe = await probeAuthorizeUrl(authorizeUrl);

    if (!probe.usable) {
      // The reply address is not registered, so a browser tab would only show an
      // error. Release the listener and fall back to the device code.
      await loopback.close().catch(() => undefined);
      const fallback = await startDeviceLogin(id, tenantId);
      return { ...fallback, fallbackReason: probe.detail };
    }

    const flowId = randomUUID();
    pendingLogins.set(flowId, {
      ...baseEntry(id, tenantId),
      mode: 'redirect',
      expiresAt: Date.now() + LOOPBACK_TIMEOUT_MS,
      loopback,
      codeVerifier: pkce.verifier,
      redirectUri: loopback.redirectUri,
      state,
      verificationUri: authorizeUrl,
      intervalSec: REDIRECT_POLL_SEC,
    });
    return {
      ok: true,
      mode: 'redirect',
      message: '已打开 Microsoft 登录页，请在浏览器中完成登录。',
      flowId,
      verificationUri: authorizeUrl,
      expiresInSec: Math.round(LOOPBACK_TIMEOUT_MS / 1000),
      intervalSec: REDIRECT_POLL_SEC,
    };
  } catch {
    // No loopback listener available — device code still gets the job done.
    const fallback = await startDeviceLogin(id, tenantId);
    return { ...fallback, fallbackReason: '本机无法启动回调服务，已改用设备码方式。' };
  }
}

/* ------------------------------------------------------------------- poll */

async function switchToDeviceCode(entry: PendingLogin): Promise<MsLoginPollResult | null> {
  const started = await startDeviceLogin(entry.clientId, entry.tenant);
  if (!started.ok || !started.flowId) return null;

  const deviceEntry = pendingLogins.get(started.flowId);
  pendingLogins.delete(started.flowId);
  if (!deviceEntry) return null;

  await entry.loopback?.close().catch(() => undefined);
  entry.loopback = null;
  entry.mode = 'device';
  entry.deviceCode = deviceEntry.deviceCode;
  entry.intervalSec = deviceEntry.intervalSec;
  entry.userCode = deviceEntry.userCode;
  entry.verificationUri = deviceEntry.verificationUri;
  entry.expiresAt = deviceEntry.expiresAt;
  entry.startedAt = Date.now();

  return {
    status: 'pending',
    mode: 'device',
    message: '没有等到浏览器回调，已切换为设备码方式。请在页面中输入下方代码。',
    userCode: entry.userCode,
    verificationUri: entry.verificationUri,
  };
}

async function pollRedirect(flowId: string, entry: PendingLogin): Promise<MsLoginPollResult> {
  const got = entry.loopback?.take() ?? null;

  if (got?.kind === 'error') {
    cancelLogin(flowId);
    const detail = got.description || got.error || '';
    return {
      status: 'error',
      message:
        describeMicrosoftAuthError(detail) ?? `Microsoft 拒绝了本次授权：${detail || '未知原因'}`,
    };
  }

  if (got?.kind === 'code') {
    // CSRF guard: a callback that does not echo our own state is not ours.
    if (got.state !== entry.state) {
      cancelLogin(flowId);
      return { status: 'error', message: '回调校验失败（state 不匹配），已中止本次登录。' };
    }
    try {
      const tokens = await exchangeAuthCode({
        clientId: entry.clientId,
        tenant: entry.tenant,
        code: got.code,
        redirectUri: entry.redirectUri,
        codeVerifier: entry.codeVerifier,
      });
      entry.tokens = tokens;
      await entry.loopback?.close().catch(() => undefined);
      entry.loopback = null;
      return {
        status: 'success',
        mode: 'redirect',
        message: '登录成功，令牌已保存在本机。',
        account: tokens.account,
      };
    } catch (error) {
      cancelLogin(flowId);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Nothing back yet. If the browser is clearly not coming, switch rather than
  // leaving the user watching a spinner.
  if (Date.now() - entry.startedAt > REDIRECT_GRACE_MS) {
    const switched = await switchToDeviceCode(entry);
    if (switched) return switched;
  }

  return { status: 'pending', mode: 'redirect', message: '等待你在浏览器中完成登录…' };
}

async function pollDevice(flowId: string, entry: PendingLogin): Promise<MsLoginPollResult> {
  const carry = {
    mode: 'device' as MsLoginMode,
    userCode: entry.userCode,
    verificationUri: entry.verificationUri,
  };

  try {
    const payload = await postForm(tokenEndpoint(entry.tenant), {
      client_id: entry.clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: entry.deviceCode,
      scope: MS_SCOPES.join(' '),
    });

    const outcome = classifyTokenResponse(payload);
    if (outcome.status === 'success') {
      entry.tokens = outcome.tokens;
      return {
        status: 'success',
        mode: 'device',
        message: '登录成功，令牌已保存在本机。',
        account: outcome.tokens.account,
      };
    }
    if (outcome.status === 'slow_down') {
      entry.intervalSec = Math.min(MAX_INTERVAL_SEC, entry.intervalSec + 5);
    }
    if (outcome.status === 'error') cancelLogin(flowId);

    return { status: outcome.status as MsLoginStatus, ...carry, message: outcome.message };
  } catch (error) {
    // Transient network hiccup: keep the login alive and let the caller retry.
    return {
      status: 'pending',
      ...carry,
      message: `网络波动，重试中：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** One poll. The renderer repeats this until the status is no longer pending. */
export async function msLoginPoll(flowId: string): Promise<MsLoginPollResult> {
  const entry = pendingLogins.get(flowId);
  if (!entry) return { status: 'error', message: '登录会话已失效，请重新发起登录。' };

  if (entry.tokens) {
    return {
      status: 'success',
      mode: entry.mode,
      message: '登录成功，令牌已保存在本机。',
      account: entry.tokens.account,
    };
  }

  if (Date.now() > entry.expiresAt) {
    const wasDevice = entry.mode === 'device';
    cancelLogin(flowId);
    return {
      status: 'error',
      message: wasDevice ? '设备码已过期，请重新发起登录。' : '登录等待超时，请重新发起登录。',
    };
  }

  return entry.mode === 'redirect' ? pollRedirect(flowId, entry) : pollDevice(flowId, entry);
}
