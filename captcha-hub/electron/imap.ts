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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

function createClient(credentials: EmailCredentials): ImapFlow {
  return new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: {
      user: credentials.username,
      pass: credentials.password,
    },
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
    return { ok: false, message: errorMessage(error) };
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
