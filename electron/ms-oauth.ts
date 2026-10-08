/**
 * Microsoft OAuth 2.0 primitives: endpoints, scopes, token parsing and refresh.
 *
 * This module is the *pure* half of the Microsoft support — it holds no pending
 * state and performs no flow orchestration. `ms-login.ts` drives the actual
 * sign-in (redirect flow with a device-code fallback) and owns the registry of
 * in-flight logins; `ms-authcode.ts` holds the PKCE/loopback machinery.
 * Splitting them this way keeps each unit testable and avoids an import cycle.
 *
 * Basic Authentication is dead for IMAP — outlook.office365.com advertises
 * `LOGINDISABLED` and answers every LOGIN with `NO Basic authentication is
 * disabled.` An OAuth access token is the only way in.
 *
 * Imports nothing from Electron, so it stays unit testable; the HTTP seams
 * return parsed JSON instead of throwing.
 */

/** IMAP scope for the Outlook resource — valid for both personal and work accounts. */
export const MS_IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All';

/**
 * SMTP scope, needed to *send* through Outlook. Added in v2; accounts that were
 * authorised before this existed must re-consent once before they can send
 * (the receive path keeps working with the old token in the meantime).
 */
export const MS_SMTP_SCOPE = 'https://outlook.office.com/SMTP.Send';

/** `common` serves personal (outlook.com/hotmail) and work/school tenants alike. */
export const MS_DEFAULT_TENANT = 'common';

/**
 * OIDC scopes. Asking for `openid` is what makes Microsoft return an id_token,
 * whose `preferred_username` carries the signed-in address — that is how the
 * form fills the mailbox field for the user instead of asking them to type it.
 * These are standard OIDC scopes and need no extra API permission entry.
 */
export const MS_OIDC_SCOPES = ['openid', 'profile', 'email'];

/** `offline_access` is what makes Microsoft hand back a refresh token. */
export const MS_SCOPES = ['offline_access', ...MS_OIDC_SCOPES, MS_IMAP_SCOPE, MS_SMTP_SCOPE];

/** Normalises a space-delimited `scope` value into a trimmed list. */
export function parseScopes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

/** True when `scopes` contains `wanted` (case-insensitive). */
export function hasScope(scopes: string[], wanted: string): boolean {
  const target = wanted.toLowerCase();
  return scopes.some((scope) => scope.toLowerCase() === target);
}

/** Refresh a little before the token actually dies, to avoid mid-fetch expiry. */
const EXPIRY_SKEW_MS = 120_000;

const MIN_INTERVAL_SEC = 5;

/** Upper bound for device-code polling; also applied when the server says slow_down. */
export const MAX_INTERVAL_SEC = 60;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms at which `accessToken` stops being usable. */
  expiresAt: number;
  /** Scope set Microsoft reports as actually granted. */
  scopes: string[];
  /**
   * The signed-in address, read from the id_token. Empty when the provider did
   * not return one — callers must treat it as a hint, never as a requirement.
   */
  account: string;
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

/**
 * Decodes a JWT payload without verifying its signature.
 *
 * That is deliberate and safe here: the token arrives over TLS straight from
 * Microsoft's token endpoint, and its only use is a *prefill hint* for the
 * mailbox field — the value is shown to the user and can be corrected by hand.
 * Nothing is authorised on the strength of it.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reads the signed-in address out of an id_token.
 *
 * `preferred_username` is checked first because it is always present: for
 * personal accounts it *is* the address, and for work/school accounts it is the
 * UPN, which is normally the address too. The dedicated `email` claim is only
 * emitted when the app registration opts into it, so it is a fallback rather
 * than the primary source.
 */
export function parseIdTokenAccount(idToken: string): string {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return '';
  for (const claim of ['preferred_username', 'email', 'upn', 'unique_name']) {
    const value = asString(payload[claim]).trim();
    if (value.includes('@')) return value;
  }
  return '';
}

export function parseTokenResponse(payload: unknown, now: number = Date.now()): TokenSet | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;

  const accessToken = asString(raw.access_token);
  if (!accessToken) return null;

  // Microsoft normally echoes the granted scope set; when it omits it we assume
  // the request was fulfilled rather than locking the user into a reauth loop.
  const granted = parseScopes(raw.scope);

  return {
    accessToken,
    refreshToken: asString(raw.refresh_token),
    expiresAt: now + asPositiveInt(raw.expires_in, 3600) * 1000,
    scopes: granted.length > 0 ? granted : [...MS_SCOPES],
    account: parseIdTokenAccount(asString(raw.id_token)),
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

  // An Entra code inside the description is more specific than the generic
  // OAuth error name, so it wins. The same `invalid_grant` means "the code
  // expired" in one case and "this account lives in a directory-less tenant"
  // in another, and only the code tells the two apart — which is exactly the
  // confusion this whole module exists to remove.
  const hint = describeMicrosoftAuthError(errorDescription(raw));
  if (hint) return { status: 'error', message: hint };

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
    default: {
      const detail = errorDescription(raw);
      const hint = describeMicrosoftAuthError(detail);
      return {
        status: 'error',
        message: hint ?? `Microsoft 返回错误：${error}（${detail}）`,
      };
    }
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

/* --------------------------------------------------- client id / errors -- */

/**
 * Microsoft's own client IDs, which users paste into the Client ID field by
 * mistake more often than you would think: the value is right there in the
 * Azure portal's own sign-in error page and in the portal's address bar.
 *
 * Signing in with one of these asks Microsoft to authorise *Microsoft's*
 * application, so the consent screen and every subsequent error describe
 * somebody else's app. Catching it before the browser opens is far kinder than
 * letting the user read `AADSTS50020` and guess.
 */
export const KNOWN_FIRST_PARTY_CLIENT_IDS: Record<string, string> = {
  '74658136-14ec-4630-ad9b-26e160ff0fc6': 'Azure 门户（ADIbizaUX）',
  'c44b4083-3bb0-49c1-b47d-974e53cbdf3c': 'Azure 门户',
  '04b07795-8ddb-461a-bbee-02f9e1bf7b46': 'Azure CLI',
  '1950a258-227b-4e31-a9cf-717495945fc2': 'Azure PowerShell',
  'd3590ed6-52b3-4102-aeff-aad2292ab01c': 'Microsoft Office',
  '1fec8e78-bce4-4aaf-ab1b-5451cc387264': 'Microsoft Teams',
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Explains why a Client ID cannot possibly work, or returns null when it looks
 * usable. Only structural problems are rejected — whether the app exists,
 * supports personal accounts and has the right permissions can only be learned
 * from Microsoft.
 */
export function describeClientId(clientId: string): string | null {
  const id = clientId.trim().toLowerCase();
  if (!id) return '请先填写 Application (client) ID。';

  const owner = KNOWN_FIRST_PARTY_CLIENT_IDS[id];
  if (owner) {
    return (
      `这个 ID 属于 Microsoft 自家的应用（${owner}），不是你注册的应用，无法用来登录你自己的邮箱。` +
      '请到 Azure「应用注册」新建一个应用，复制它「概述」页里的「应用程序(客户端) ID」。'
    );
  }

  if (!GUID.test(id)) {
    return (
      'Application (client) ID 应形如 00000000-0000-0000-0000-000000000000。' +
      '注意不要复制成「对象 ID」或「目录(租户) ID」——它们是同一页上的另外两个值。'
    );
  }

  return null;
}

/**
 * Turns the Entra error codes users actually hit into something actionable.
 * The service reports these inside `error_description`, either on the loopback
 * callback or from the token endpoint, so the raw text is the only input here.
 *
 * Returns null when the text carries no code we recognise, leaving the caller
 * free to show Microsoft's own wording.
 */
export function describeMicrosoftAuthError(text: string): string | null {
  if (!text) return null;

  // A personal Microsoft account lives in the "Microsoft Services" tenant,
  // which has no directory — so it can neither host an app registration nor be
  // granted access to one. Nothing the user types into this app can change it.
  if (/AADSTS50020|AADSTS16000|AADSTS160021|AADSTS50058/.test(text)) {
    return (
      '这个 Microsoft 账户被归在了「Microsoft Services」租户下，而该租户没有可用目录，' +
      '因此既不能注册应用、也不能被授权访问应用。这是个人账户（outlook.com / hotmail.com）' +
      '目前的默认行为，与密码是否正确无关。\n' +
      '可行的做法：① 让邮件转发到你已经配好的邮箱（本应用已支持）；' +
      '② 用无痕窗口打开 https://azure.microsoft.com/free/ 注册 Azure 免费账户，' +
      '这会生成一个真实租户并让你成为全局管理员，之后在该租户里注册应用；' +
      '③ 或改用一个工作 / 学校账户。'
    );
  }

  if (/AADSTS700038/.test(text)) {
    return 'Application (client) ID 不是有效的应用标识，请从 Azure「应用注册 → 概述」重新复制。';
  }

  if (/AADSTS7000218|AADSTS7000222|invalid_client/i.test(text)) {
    return (
      '该应用未启用「允许公共客户端流（Allow public client flows）」，或 Client ID 填写有误。' +
      '请在 Azure 应用 →「身份验证」页把它设为「是」并保存。'
    );
  }

  if (/AADSTS65001|AADSTS65004|AADSTS500011|consent_required/i.test(text)) {
    return (
      '该应用缺少所需权限，或你尚未同意授权。请在 Azure 应用的「API 权限」中添加 ' +
      'Office 365 Exchange Online 的 IMAP.AccessAsUser.All 与 SMTP.Send（均为「委托的权限」），' +
      '然后重新登录。'
    );
  }

  if (/AADSTS50011(?![0-9])|AADSTS500113/.test(text)) {
    return (
      '该应用尚未注册重定向地址 http://localhost。请在 Azure 应用 →「身份验证 → 添加平台 → ' +
      '移动和桌面应用程序」中把它加为自定义重定向 URI，然后重新登录。'
    );
  }

  return null;
}

/* ------------------------------------------------------------------- HTTP */

/**
 * POSTs a form body and always resolves with a JSON object. Microsoft's
 * device-code and token endpoints report failures as JSON too, so a parse
 * failure is surfaced as an OAuth-shaped error rather than an exception.
 *
 * Exported as the HTTP seam shared with `ms-login.ts`.
 */
export async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
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
