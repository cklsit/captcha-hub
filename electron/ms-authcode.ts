import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  msAuthority,
  MS_SCOPES,
  parseTokenResponse,
  tokenEndpoint,
  type TokenSet,
} from './ms-oauth';

/**
 * Authorization-code flow with PKCE, completed over a loopback redirect.
 *
 * This is the flow that gives a genuine one-click sign-in: the app opens the
 * user's default browser on Microsoft's own page, they sign in with their
 * account, and Microsoft bounces the authorization code straight back to a
 * short-lived listener on 127.0.0.1. No code to copy, no password anywhere near
 * the app.
 *
 * It requires `http://localhost` (or a custom scheme) to be registered on the
 * Azure app under "Mobile and desktop applications" — Microsoft refuses any
 * unregistered reply address with `AADSTS50011`/`AADSTS500113`. `ms-oauth.ts`
 * keeps the device-code grant as a fallback for apps that have not added it,
 * and `probeAuthorizeUrl` lets the caller find that out *before* opening a
 * browser tab that would only show an error.
 *
 * Like `ms-oauth.ts` this module imports nothing from Electron — `node:http`
 * and `node:crypto` only — so every decision it makes is unit testable.
 */

/** Seconds the listener waits for the browser to come back before giving up. */
export const LOOPBACK_TIMEOUT_MS = 180_000;

/* --------------------------------------------------------------- PKCE ---- */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 base64url — no padding, `-`/`_` instead of `+`/`/`. */
export function base64UrlEncode(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkcePair(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/* ---------------------------------------------------------- authorize ---- */

export interface AuthorizeParams {
  clientId: string;
  tenant: string;
  redirectUri: string;
  codeChallenge: string;
  /** CSRF guard — echoed back by Microsoft and compared on the way in. */
  state: string;
  /** Optional address to pre-select on the sign-in page. */
  loginHint?: string;
}

export function buildAuthorizeUrl(params: AuthorizeParams): string {
  const url = new URL(`${msAuthority(params.tenant)}/authorize`);
  // client_id first: some intermediaries are picky about ordering.
  url.searchParams.set('client_id', params.clientId.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', MS_SCOPES.join(' '));
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', 'select_account');
  if (params.loginHint && params.loginHint.trim()) {
    url.searchParams.set('login_hint', params.loginHint.trim());
  }
  return url.toString();
}

/** The loopback reply address Microsoft accepts for public clients. */
export function buildRedirectUri(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export interface CallbackParams {
  code: string;
  state: string;
  error: string;
  errorDescription: string;
}

/** Reads the OAuth parameters Microsoft appends to the redirect. Pure. */
export function readCallbackParams(target: string): CallbackParams {
  let params: URLSearchParams;
  try {
    // Tolerate a bare query string as well as a full URL.
    params = new URL(target, 'http://localhost').searchParams;
  } catch {
    return { code: '', state: '', error: 'invalid_callback', errorDescription: '' };
  }
  return {
    code: params.get('code')?.trim() ?? '',
    state: params.get('state')?.trim() ?? '',
    error: params.get('error')?.trim() ?? '',
    errorDescription: params.get('error_description')?.trim() ?? '',
  };
}

/* ----------------------------------------------------------- loopback ---- */

export type LoopbackResult =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; error: string; description: string };

export interface LoopbackSession {
  redirectUri: string;
  port: number;
  /** The callback once it arrives, or null while still waiting. */
  take(): LoopbackResult | null;
  close(): Promise<void>;
}

/** Only the machine itself may talk to our callback port. */
function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function callbackPage(title: string, detail: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1115;color:#e6e6e6;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{text-align:center;max-width:520px;padding:32px}
h1{font-size:20px;margin:0 0 12px}p{color:#9aa0a6;line-height:1.6;margin:0}
</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

/**
 * Starts the loopback listener on an OS-assigned port.
 *
 * The socket binds to every interface because browsers may resolve `localhost`
 * to either `::1` or `127.0.0.1`; non-loopback peers are rejected outright, and
 * the caller closes the server as soon as the code arrives (or on timeout), so
 * the window is short and narrow.
 */
export function startLoopbackServer(): Promise<LoopbackSession> {
  return new Promise((resolve, reject) => {
    let result: LoopbackResult | null = null;
    const server: Server = createServer((req, res) => {
      if (!isLoopback(req.socket.remoteAddress)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }

      const params = readCallbackParams(req.url ?? '');
      if (params.error) {
        result = { kind: 'error', error: params.error, description: params.errorDescription };
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackPage('授权未完成', '你可以关闭此页面并返回邮件中心重试。'));
        return;
      }
      if (!params.code) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }

      result = { kind: 'code', code: params.code, state: params.state };
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage('登录成功', '可以关闭此页面并返回邮件中心，授权已完成。'));
    });

    server.on('error', (error: Error) => reject(error));
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法启动本地回调服务。'));
        return;
      }
      resolve({
        redirectUri: buildRedirectUri('localhost', address.port),
        port: address.port,
        take: () => result,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            // A keep-alive socket would otherwise hold the port until it times out.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/* -------------------------------------------------------------- probe ---- */

export interface ProbeResult {
  /** True when Microsoft appears willing to send the code to `redirectUri`. */
  usable: boolean;
  /** Human-readable reason when `usable` is false. */
  detail: string;
}

/**
 * Signatures that only appear on a dedicated "reply address" error page.
 *
 * Kept deliberately narrow, and here is the evidence for why: a live request
 * to the real authorize endpoint returns **HTTP 200 with the ordinary sign-in
 * page**, and that page's bundled scripts already contain unrelated AADSTS
 * strings (an observed response carried `AADSTS501491`). A broader rule of
 * "any AADSTS code means the request was refused" was implemented, tested
 * against the live endpoint, and **removed** — it would have blocked sign-ins
 * that would otherwise have worked, which is far worse than the alternative.
 *
 * By contrast none of the strings below appear in the normal page, so matching
 * them is a reliable signal that the reply address itself was rejected.
 */
const REDIRECT_ERROR = /AADSTS500113|AADSTS50011(?![0-9])|reply address is not registered/i;

/**
 * Asks Microsoft about the authorize request *without* following the redirect,
 * so an unregistered reply address is discovered before a browser tab is opened
 * on an error page.
 *
 * Optimistic by design. The two mistakes are not symmetric: wrongly reporting
 * "refused" blocks a sign-in that would have succeeded, while wrongly reporting
 * "usable" merely costs one fallback later. So anything short of a definite
 * reply-address error leaves the flow on its way.
 */
export async function probeAuthorizeUrl(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    // A redirect (or a served login page) means the parameters were accepted.
    if (response.status >= 300 && response.status < 400) return { usable: true, detail: '' };
    if (response.status >= 400) return { usable: true, detail: '' };

    const body = await response.text();
    if (!REDIRECT_ERROR.test(body)) return { usable: true, detail: '' };

    return {
      usable: false,
      detail: '该 Azure 应用尚未注册重定向地址 http://localhost，Microsoft 拒绝了本机的回调地址。',
    };
  } catch {
    return { usable: true, detail: '' };
  }
}

/* ----------------------------------------------------------- exchange ---- */

export interface ExchangeParams {
  clientId: string;
  tenant: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/**
 * Redeems the authorization code. Throws with a user-readable message when
 * Microsoft refuses, mirroring `refreshAccessToken`.
 */
export async function exchangeAuthCode(params: ExchangeParams): Promise<TokenSet> {
  const response = await fetch(tokenEndpoint(params.tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId.trim(),
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
      scope: MS_SCOPES.join(' '),
    }).toString(),
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Microsoft 返回了无法解析的响应：${text.slice(0, 160)}`);
  }

  const tokens = parseTokenResponse(payload);
  if (!tokens) {
    const raw = payload as Record<string, unknown>;
    const detail =
      (typeof raw.error_description === 'string' && raw.error_description) ||
      (typeof raw.error === 'string' && raw.error) ||
      '换取令牌失败';
    throw new Error(detail);
  }
  return tokens;
}
