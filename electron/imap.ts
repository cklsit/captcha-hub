import { ImapFlow } from 'imapflow';
import { parseMailSource, extractAttachment, type ParsedMailResult } from './parse-mail';
import type { ImapCredentials } from '../shared/types';

/**
 * Thin IMAP layer.
 *
 * The only place that talks to a mail server: connection testing, folder
 * listing, incremental per-folder fetch, mail operations (seen / move / delete)
 * and on-demand attachment retrieval. Kept free of any Electron import so it
 * stays unit-testable on a headless CI runner.
 */

export interface ImapErrorDetails {
  message?: string;
  responseText?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
}

/** A folder as advertised by the server (before local reconciliation). */
export interface ServerFolder {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string;
}

/** One fetched mail: its UID, server flags and parsed content. */
export interface FetchedMail {
  uid: string;
  seen: boolean;
  parsed: ParsedMailResult;
}

export interface FolderFetchResult {
  uidValidity: number;
  /** Highest UID actually ingested in this run (0 when nothing was new). */
  lastUid: number;
  /** Highest UID present on the server (used to detect "no more new mail"). */
  maxUid: number;
  total: number;
  mails: FetchedMail[];
}

/**
 * Hosts where no password can ever work.
 *
 * Microsoft retired Basic Authentication for Outlook.com / Hotmail / Live /
 * MSN and for Exchange Online. The server is explicit about it — CAPABILITY
 * advertises `LOGINDISABLED` with `AUTH=XOAUTH2` as the only mechanism, and a
 * LOGIN attempt answers `NO Basic authentication is disabled.` Both the web
 * password and app passwords are rejected.
 */
const OAUTH_ONLY_HOST = /(^|\.)(outlook\.com|hotmail\.com|live\.com|msn\.com|office365\.com)$/i;

/** True when the provider only accepts OAuth 2.0, so a password is futile. */
export function isOAuthOnlyHost(host: string): boolean {
  return OAUTH_ONLY_HOST.test(host.trim());
}

const MICROSOFT_OAUTH_HINT =
  'Microsoft 账户无法用密码登录 IMAP：微软已停用基本验证（服务器返回 LOGINDISABLED，只接受 AUTH=XOAUTH2），' +
  '网页密码与应用密码都会被拒绝，只能使用 OAuth 2.0。' +
  '可行做法：在本应用的账户设置里把认证方式改为「Microsoft 账户登录」并完成一次授权。';

/**
 * imapflow surfaces most server-side rejections as the unhelpful
 * `Error: Command failed`; the real reason lives in `responseText` /
 * `serverResponseCode`. Unwrap those and attach an actionable hint for the
 * mistakes users actually make — chiefly using a web login password where the
 * provider requires an app-specific authorisation code.
 *
 * @param host IMAP host of the account being tested or synced. Needed to tell
 *   "your password is wrong" apart from "this provider no longer accepts
 *   passwords at all" — two problems with completely different fixes.
 */
export function describeImapError(error: unknown, host = ''): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & ImapErrorDetails;

  const code = details.serverResponseCode?.trim();
  const responseText = details.responseText?.trim();
  const raw = details.message?.trim() || 'IMAP 操作失败';
  const detail = [code, responseText].filter(Boolean).join(' — ');

  // On an OAuth-only host every LOGIN attempt fails regardless of whether the
  // credentials are correct, so reporting "密码不正确" would send the user
  // chasing a problem they cannot fix.
  const basicAuthBlocked =
    details.authenticationFailed === true ||
    /basic authentication is disabled|LOGINDISABLED|login is disabled/i.test(`${raw} ${detail}`);
  if (isOAuthOnlyHost(host) && basicAuthBlocked) return MICROSOFT_OAUTH_HINT;

  if (details.authenticationFailed || code === 'AUTHENTICATIONFAILED') {
    return '认证失败：邮箱地址或密码不正确。网易 163/126、QQ 等邮箱必须填写「授权码」——需先在邮箱网页端的设置里开启 IMAP 服务并生成授权码，不能使用网页登录密码。';
  }

  if (/unsafe login/i.test(detail)) {
    return `服务器拒绝了本次登录（Unsafe Login）。请确认已在邮箱设置中开启 IMAP 服务。原始信息：${detail}`;
  }

  return detail ? `${raw}（${detail}）` : raw;
}

/**
 * Identity we announce through the RFC 2971 `ID` command. imapflow already
 * sends a default clientInfo before LOGIN; overriding it only replaces the
 * advertised name, which is why this alone does NOT fix Netease (see below).
 */
const CLIENT_INFO = {
  name: 'Mail Hub',
  version: '1.0.0',
  vendor: 'Mail Hub',
};

/** 163 / 126 / yeah.net — the providers that gate SELECT behind the ID command. */
const NETEASE_HOST = /(^|\.)(163\.com|126\.com|yeah\.net)$/i;

/**
 * Netease only allows `SELECT` once the client has announced itself with the
 * `ID` command *in the authenticated state*; otherwise it answers
 * `NO SELECT Unsafe Login. Please contact kefu@188.com for help`.
 *
 * imapflow sends ID before LOGIN and then re-sends it only when the server's
 * pre-auth reply carried fewer than two keys. Netease answers with three, so
 * the re-send never happens and every mailbox operation after login fails —
 * which is exactly why the app reported the opaque `Command failed`.
 *
 * Re-announcing after login closes that gap. `run()` is imapflow's internal
 * command dispatcher and is absent from its public typings, so it is probed
 * defensively and every failure is swallowed.
 */
export async function announceClientId(client: ImapFlow, host: string): Promise<void> {
  if (!NETEASE_HOST.test(host)) return;

  const internal = client as unknown as {
    run?: (command: string, ...args: unknown[]) => Promise<unknown>;
    capabilities?: Map<string, unknown> | Set<string>;
  };

  if (typeof internal.run !== 'function') return;
  if (internal.capabilities && !internal.capabilities.has('ID')) return;

  try {
    await internal.run('ID', CLIENT_INFO);
  } catch {
    /* advisory command — never fail a connection because of it */
  }
}

function createClient(credentials: ImapCredentials): ImapFlow {
  // imapflow switches to XOAUTH2 as soon as an access token is supplied — this
  // is the only mechanism Microsoft still accepts for IMAP.
  const auth =
    credentials.authType === 'oauth2'
      ? { user: credentials.username, accessToken: credentials.accessToken }
      : { user: credentials.username, pass: credentials.password };

  return new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth,
    clientInfo: CLIENT_INFO,
    logger: false,
  });
}

interface MailboxShape {
  exists: number;
  uidValidity: number | bigint;
  uidNext: number;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Verifies that the supplied credentials can connect and open the mailbox. */
export async function testImapConnection(
  credentials: ImapCredentials,
): Promise<{ ok: boolean; message: string }> {
  const client = createClient(credentials);
  try {
    await client.connect();
    await announceClientId(client, credentials.host);
    const mailbox = 'INBOX';
    const lock = await client.getMailboxLock(mailbox);
    try {
      // Reaching this point means auth + mailbox open both succeeded.
    } finally {
      lock.release();
    }
    await client.logout();
    return { ok: true, message: `连接成功，邮箱「${mailbox}」可正常访问。` };
  } catch (error) {
    try {
      await client.close();
    } catch {
      /* ignore secondary failure */
    }
    return { ok: false, message: describeImapError(error, credentials.host) };
  }
}

/** Lists every selectable folder advertised by the server. */
export async function listFolders(credentials: ImapCredentials): Promise<ServerFolder[]> {
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  try {
    const raw = (await client.list()) as unknown as Array<{
      path: string;
      name?: string;
      delimiter?: string;
      specialUse?: string;
      flags?: Set<string> | string[];
    }>;

    return raw
      .filter((entry) => Boolean(entry.path))
      .map((entry) => {
        const flags = entry.flags instanceof Set ? [...entry.flags] : (entry.flags ?? []);
        const specialUse =
          entry.specialUse || flags.find((flag) => flag.startsWith('\\')) || '';
        return {
          path: entry.path,
          name: entry.name || entry.path,
          delimiter: entry.delimiter || '/',
          specialUse,
        };
      });
  } finally {
    await client.logout();
  }
}

/**
 * Fetches mails newer than `sinceUid` from one folder.
 *
 * When the mailbox UIDVALIDITY has changed (folder recreated server-side) the
 * cursor is meaningless, so the fetch restarts from scratch.
 */
export async function fetchFolder(
  credentials: ImapCredentials,
  folderPath: string,
  sinceUid: number,
  limit = 200,
  expectedUidValidity = 0,
): Promise<FolderFetchResult> {
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  const lock = await client.getMailboxLock(folderPath);
  try {
    const box = client.mailbox as unknown as MailboxShape | boolean;
    const mailbox = typeof box === 'object' && box ? box : null;
    const uidValidity = mailbox ? toNumber(mailbox.uidValidity) : 0;
    const maxUid = mailbox ? Math.max(0, toNumber(mailbox.uidNext) - 1) : 0;
    const total = mailbox ? toNumber(mailbox.exists) : 0;

    const reset = expectedUidValidity > 0 && expectedUidValidity !== uidValidity;
    const startUid = (reset ? 0 : sinceUid) + 1;

    const mails: FetchedMail[] = [];
    let lastUid = reset ? 0 : sinceUid;

    if (maxUid >= startUid) {
      const range = `${startUid}:${maxUid}`;
      let count = 0;
      for await (const message of client.fetch(
        range,
        { uid: true, source: true, flags: true },
        { uid: true },
      )) {
        if (!message.source) continue;
        const parsed = await parseMailSource(Buffer.isBuffer(message.source) ? message.source : Buffer.from(message.source));
        const seen = message.flags ? message.flags.has('\\Seen') : false;
        const uid = toNumber(message.uid);
        mails.push({ uid: String(uid), seen, parsed });
        lastUid = Math.max(lastUid, uid);
        count += 1;
        if (limit > 0 && count >= limit) break;
      }
    }

    return { uidValidity, lastUid, maxUid, total, mails };
  } finally {
    lock.release();
    await client.logout();
  }
}

/** Adds or removes the `\Seen` flag on a set of UIDs. */
export async function setSeen(
  credentials: ImapCredentials,
  folderPath: string,
  uids: string[],
  seen: boolean,
): Promise<void> {
  if (uids.length === 0) return;
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  const lock = await client.getMailboxLock(folderPath);
  try {
    const range = uids.join(',');
    if (seen) await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
    else await client.messageFlagsRemove(range, ['\\Seen'], { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

/** Moves a single mail to another folder. */
export async function moveMessage(
  credentials: ImapCredentials,
  folderPath: string,
  uid: string,
  targetPath: string,
): Promise<void> {
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  const lock = await client.getMailboxLock(folderPath);
  try {
    await client.messageMove(String(uid), targetPath, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

/** Deletes a single mail (flags `\Deleted` and expunges). */
export async function deleteMessage(
  credentials: ImapCredentials,
  folderPath: string,
  uid: string,
): Promise<void> {
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  const lock = await client.getMailboxLock(folderPath);
  try {
    await client.messageDelete(String(uid), { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

/** Downloads one attachment (by its parsed index) straight from the folder. */
export async function fetchAttachment(
  credentials: ImapCredentials,
  folderPath: string,
  uid: string,
  partId: string,
): Promise<{ filename: string; content: Buffer } | null> {
  const client = createClient(credentials);
  await client.connect();
  await announceClientId(client, credentials.host);
  const lock = await client.getMailboxLock(folderPath);
  try {
    let source: Buffer | null = null;
    for await (const message of client.fetch(String(uid), { source: true }, { uid: true })) {
      source = message.source ? (Buffer.isBuffer(message.source) ? message.source : Buffer.from(message.source)) : null;
      break;
    }
    if (!source) return null;
    return await extractAttachment(source, partId);
  } finally {
    lock.release();
    await client.logout();
  }
}
