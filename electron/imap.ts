import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import type { EmailCredentials } from '../shared/types';

/**
 * Thin IMAP layer.
 *
 * The desktop has no cellular radio, so SMS codes arrive here through an email
 * forwarding channel; this module is the only place that talks to a mail server.
 */

export interface RawMail {
  uid: string;
  subject: string;
  from: string;
  text: string;
  date: Date;
}

interface ImapErrorDetails {
  message?: string;
  responseText?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
}

/**
 * imapflow surfaces most server-side rejections as the unhelpful
 * `Error: Command failed`; the real reason lives in `responseText` /
 * `serverResponseCode`. Unwrap those and attach an actionable hint for the
 * mistakes users actually make — chiefly using a web login password where the
 * provider requires an app-specific authorisation code.
 */
export function describeImapError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & ImapErrorDetails;

  const code = details.serverResponseCode?.trim();
  const responseText = details.responseText?.trim();
  const raw = details.message?.trim() || 'IMAP 操作失败';

  if (details.authenticationFailed || code === 'AUTHENTICATIONFAILED') {
    return '认证失败：邮箱地址或密码不正确。网易 163/126、QQ 等邮箱必须填写「授权码」——需先在邮箱网页端的设置里开启 IMAP 服务并生成授权码，不能使用网页登录密码。';
  }

  const detail = [code, responseText].filter(Boolean).join(' — ');

  if (/unsafe login/i.test(detail)) {
    return `服务器拒绝了本次登录（Unsafe Login）。请确认已在邮箱设置中开启 IMAP 服务。原始信息：${detail}`;
  }

  return detail ? `${raw}（${detail}）` : raw;
}

function addressToText(address: ParsedMail['from']): string {
  if (!address) return '';
  const list: AddressObject[] = Array.isArray(address) ? address : [address];
  const entry = list[0]?.value?.[0];
  if (!entry) return '';
  const name = entry.name?.trim();
  const email = entry.address;
  if (name && email) return `${name} <${email}>`;
  return email ?? name ?? '';
}

function htmlToText(html: string | Buffer | undefined): string {
  if (!html) return '';
  const raw = typeof html === 'string' ? html : html.toString('utf8');
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identity we announce through the RFC 2971 `ID` command. imapflow already
 * sends a default clientInfo before LOGIN; overriding it only replaces the
 * advertised name, which is why this alone does NOT fix Netease (see below).
 */
const CLIENT_INFO = {
  name: 'Captcha Hub',
  version: '1.0.0',
  vendor: 'Captcha Hub',
};

/** 163 / 126 / yeah.net — the providers that gate SELECT behind the ID command. */
const NETEASE_HOST = /(^|\.)(163\.com|126\.com|yeah\.net)$/i;

/**
 * Netease only allows `SELECT` once the client has announced itself with the
 * `ID` command *in the authenticated state*; otherwise it answers
 * `NO SELECT Unsafe Login. Please contact kefu@188.com for help`.
 *
 * imapflow sends ID before LOGIN and then re-sends it only when the server's
 * pre-auth reply carried fewer than two keys (`startSession()` checks
 * `Object.keys(idRequested).length < 2`). Netease answers with three
 * (`name`, `vendor`, `transid`), so the re-send never happens and every
 * mailbox operation after login fails — which is exactly why the app reported
 * the opaque `Command failed`.
 *
 * Re-announcing after login closes that gap. `run()` is imapflow's internal
 * command dispatcher and is absent from its public typings, so it is probed
 * defensively and every failure is swallowed: for every other provider the ID
 * command is purely advisory and must never break the connection.
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

function createClient(credentials: EmailCredentials): ImapFlow {
  return new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: {
      user: credentials.username,
      pass: credentials.password,
    },
    clientInfo: CLIENT_INFO,
    // ImapFlow's logger is intentionally disabled to keep the console clean.
    logger: false,
  });
}

/** Verifies that the supplied credentials can connect and open the mailbox. */
export async function testImapConnection(
  credentials: EmailCredentials,
): Promise<{ ok: boolean; message: string }> {
  const client = createClient(credentials);
  try {
    await client.connect();
    await announceClientId(client, credentials.host);
    const mailbox = credentials.mailbox || 'INBOX';
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
    return { ok: false, message: describeImapError(error) };
  }
}

/**
 * Fetches the newest `limit` messages from the configured mailbox.
 * De-duplication is handled by the caller (source + UID).
 */
export async function fetchRecentMails(
  credentials: EmailCredentials,
  limit = 30,
): Promise<RawMail[]> {
  const client = createClient(credentials);
  const mails: RawMail[] = [];
  await client.connect();
  await announceClientId(client, credentials.host);
  const mailbox = credentials.mailbox || 'INBOX';
  const lock = await client.getMailboxLock(mailbox);
  try {
    const box = client.mailbox;
    const exists = typeof box === 'object' && box ? box.exists : 0;
    if (exists > 0) {
      const start = Math.max(1, exists - limit + 1);
      for await (const message of client.fetch(`${start}:*`, { uid: true, source: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const text = parsed.text?.trim() || htmlToText(parsed.html as string | Buffer | undefined);
        mails.push({
          uid: String(message.uid),
          subject: parsed.subject?.trim() ?? '',
          from: addressToText(parsed.from),
          text,
          date: parsed.date ?? new Date(),
        });
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return mails;
}
