import { randomUUID } from 'node:crypto';
import type { MsLoginPollResult, MsLoginStartResult, MsLoginStatus } from '../shared/types';

/**
 * Microsoft OAuth 2.0 device-code flow.
 *
 * Basic Authentication is dead for IMAP — outlook.office365.com advertises
 * `LOGINDISABLED` and answers every LOGIN with `NO Basic authentication is
 * disabled.` An OAuth access token is the only way in, and the device-code
 * grant is the right fit for a desktop app: no redirect URI, no embedded
 * browser, no local web server. The user opens a Microsoft page, types a short
 * code, and we poll for the token.
 *
 * Data flow, deliberately:
 *   renderer  ──start/poll──▶  main process  ──HTTPS──▶  Microsoft
 *   renderer      ◀──user code + status only──┘
 *
 * Tokens NEVER cross the IPC bridge. They stay in this module's pending-login
 * registry until `store.ts` persists them (encrypted) onto the source.
 *
 * This module intentionally imports nothing from Electron so it stays unit
 * testable; the HTTP seams return parsed JSON instead of throwing.
 */

/** IMAP scope for the Outlook resource — valid for both personal and work accounts. */
export const MS_IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All';

/** `common` serves personal (outlook.com/hotmail) and work/school tenants alike. */
export const MS_DEFAULT_TENANT = 'common';

/** `offline_access` is what makes Microsoft hand back a refresh token. */
export const MS_SCOPES = ['offline_access', MS_IMAP_SCOPE];

/** Refresh a little before the token actually dies, to avoid mid-fetch expiry. */
const EXPIRY_SKEW_MS = 120_000;

const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 60;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms at which `accessToken` stops being usable. */
  expiresAt: number;
}

/* ------------------------------------------------------------ pure helpers */

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

/** Builds the authority base URL, tolerating blank / padded tenant values. */
export function msAuthority(tenant: string): string {
  const clean = (tenant || '').trim().replace(/^\/+|\/+$/g, '');
  return `https://login.microsoftonline.com/${clean || MS_DEFAULT_TENANT}/oauth2/v2.0`;
}

export function deviceCodeEndpoint(tenant: string): string {
  return `${msAuthority(tenant)}/devicecode`;
}

export function tokenEndpoint(tenant: string): string {
  return `${msAuthority(tenant)}/token`;
}

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  intervalSec: number;
  message: string;
}

export function parseDeviceCodeResponse(payload: unknown): DeviceCodeInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;

  const deviceCode = asString(raw.device_code);
  const userCode = asString(raw.user_code);
  const verificationUri = asString(raw.verification_uri) || asString(raw.verification_url);
  if (!deviceCode || !userCode || !verificationUri) return null;

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresInSec: asPositiveInt(raw.expires_in, 900),
    intervalSec: Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, asPositiveInt(raw.interval, 5))),
    message: asString(raw.message),
  };
}

export function parseTokenResponse(payload: unknown, now: number = Date.now()): TokenSet | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;

  const accessToken = asString(raw.access_token);
  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken: asString(raw.refresh_token),
    expiresAt: now + asPositiveInt(raw.expires_in, 3600) * 1000,
  };
}

export type PollOutcome =
  | { status: 'pending'; message: string }
  | { status: 'slow_down'; message: string }
  | { status: 'success'; tokens: TokenSet }
  | { status: 'error'; message: string };

function errorDescription(raw: Record<string, unknown>): string {
  return asString(raw.error_description) || asString(raw.error) || '无描述';
}

/**
 * Turns a token-endpoint response into a poll outcome. Success and failure
 * both arrive as HTTP 200 with a JSON body, so the `error` field — not the
 * status code — is what distinguishes them.
 */
export function classifyTokenResponse(payload: unknown, now: number = Date.now()): PollOutcome {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', message: 'Microsoft 返回了无法解析的响应，请重试。' };
  }
  const raw = payload as Record<string, unknown>;
  const error = asString(raw.error);

  if (!error) {
    const tokens = parseTokenResponse(raw, now);
    return tokens
      ? { status: 'success', tokens }
      : { status: 'error', message: 'Microsoft 未返回访问令牌，请重试。' };
  }

  switch (error) {
    case 'authorization_pending':
      return { status: 'pending', message: '等待你在浏览器中完成授权…' };
    case 'slow_down':
      return { status: 'slow_down', message: '轮询过快，已自动放慢。' };
    case 'expired_token':
      return { status: 'error', message: '设备码已过期，请重新发起登录。' };
    case 'authorization_declined':
      return { status: 'error', message: '你在 Microsoft 页面取消了授权。' };
    case 'bad_verification_code':
      return { status: 'error', message: '设备码无效，请重新发起登录。' };
    case 'invalid_client':
      return {
        status: 'error',
        message:
          'Application (client) ID 不正确，或该应用未启用「允许公共客户端流（Allow public client flows）」。',
      };
    case 'invalid_grant':
      return { status: 'error', message: '授权已失效或被撤销，请重新发起登录。' };
    default:
      return { status: 'error', message: `Microsoft 返回错误：${error}（${errorDescription(raw)}）` };
  }
}

/** Whether a cached access token can still be used, with a safety margin. */
export function isAccessTokenFresh(
  expiresAt: number,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return expiresAt > now + skewMs;
}

/* -------------------------------------------------------- pending registry */

interface PendingLogin {
  clientId: string;
  tenant: string;
  deviceCode: string;
  intervalSec: number;
  /** When the *device code* (not the token) stops being accepted. */
  expiresAt: number;
  tokens: TokenSet | null;
}

/** Keyed by flow id; lives for the lifetime of the app process only. */
const pendingLogins = new Map<string, PendingLogin>();

/** Tokens for a completed login, or null while it is still pending. */
export function getPendingTokens(flowId: string): TokenSet | null {
  return pendingLogins.get(flowId)?.tokens ?? null;
}

export function cancelLogin(flowId: string): void {
  pendingLogins.delete(flowId);
}

/** Test seam — drops every pending login. */
export function clearPendingLogins(): void {
  pendingLogins.clear();
}

export function pendingLoginCount(): number {
  return pendingLogins.size;
}

/* ------------------------------------------------------------------- HTTP */

/**
 * POSTs a form body and always resolves with a JSON object. Microsoft's
 * device-code and token endpoints report failures as JSON too, so a parse
 * failure is surfaced as an OAuth-shaped error rather than an exception.
 */
async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: 'unexpected_response', error_description: text.slice(0, 200) };
  }
}

/** Step 1: ask Microsoft for a device code and remember the pending login. */
export async function requestDeviceCode(
  clientId: string,
  tenant: string,
): Promise<MsLoginStartResult> {
  const id = clientId.trim();
  if (!id) return { ok: false, message: '请先填写 Application (client) ID。' };

  try {
    const payload = await postForm(deviceCodeEndpoint(tenant), {
      client_id: id,
      scope: MS_SCOPES.join(' '),
    });
    const info = parseDeviceCodeResponse(payload);
    if (!info) {
      const raw = payload as Record<string, unknown> | null;
      const detail = raw ? errorDescription(raw) : '';
      return {
        ok: false,
        message: detail
          ? `无法获取设备码：${detail}`
          : '无法获取设备码，请检查 Application (client) ID 与网络。',
      };
    }

    const flowId = randomUUID();
    pendingLogins.set(flowId, {
      clientId: id,
      tenant: (tenant || '').trim() || MS_DEFAULT_TENANT,
      deviceCode: info.deviceCode,
      intervalSec: info.intervalSec,
      expiresAt: Date.now() + info.expiresInSec * 1000,
      tokens: null,
    });

    return {
      ok: true,
      message: info.message || '请在浏览器中完成 Microsoft 登录。',
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

/** Step 2: one poll. The renderer repeats this until the status is not pending. */
export async function pollLogin(flowId: string): Promise<MsLoginPollResult> {
  const entry = pendingLogins.get(flowId);
  if (!entry) return { status: 'error', message: '登录会话已失效，请重新发起登录。' };
  if (entry.tokens) return { status: 'success', message: '登录成功，令牌已保存在本机。' };

  if (Date.now() > entry.expiresAt) {
    pendingLogins.delete(flowId);
    return { status: 'error', message: '设备码已过期，请重新发起登录。' };
  }

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
      return { status: 'success', message: '登录成功，令牌已保存在本机。' };
    }
    if (outcome.status === 'slow_down') {
      entry.intervalSec = Math.min(MAX_INTERVAL_SEC, entry.intervalSec + 5);
    }
    if (outcome.status === 'error') pendingLogins.delete(flowId);

    return { status: outcome.status as MsLoginStatus, message: outcome.message };
  } catch (error) {
    // Transient network hiccup: keep the login alive and let the caller retry.
    return {
      status: 'pending',
      message: `网络波动，重试中：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Exchanges a refresh token for a fresh access token.
 * Throws with a user-readable message when Microsoft refuses.
 */
export async function refreshAccessToken(
  clientId: string,
  tenant: string,
  refreshToken: string,
): Promise<TokenSet> {
  const payload = await postForm(tokenEndpoint(tenant), {
    client_id: clientId.trim(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MS_SCOPES.join(' '),
  });

  const tokens = parseTokenResponse(payload);
  if (!tokens) {
    const raw = payload as Record<string, unknown> | null;
    throw new Error(raw ? errorDescription(raw) : '刷新 Microsoft 令牌失败');
  }

  // Microsoft usually returns a rotated refresh token, but keep the old one
  // when it does not — otherwise the source would lose its ability to refresh.
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
  return tokens;
}
