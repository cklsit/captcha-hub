import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { AttachmentMeta } from '../shared/types';

/**
 * Pure mail parsing built on `mailparser`.
 *
 * No Electron / no Node IPC here — given a raw RFC 2822 source it returns a flat
 * structure the rest of the app can consume, which keeps it directly unit
 * testable (see `tests/parse-mail.test.ts`).
 */

export interface ParsedMailResult {
  subject: string;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  messageId: string;
  /** Epoch ms (falls back to `Date.now()` when the header is missing). */
  date: number;
  text: string;
  /** Raw HTML as received ('' when the mail has no HTML part). */
  html: string;
  attachments: AttachmentMeta[];
}

/** Renders a parsed address header into `Name <addr>, Other <addr2>`. */
export function addressToText(address: AddressObject | AddressObject[] | undefined): string {
  if (!address) return '';
  const list: AddressObject[] = Array.isArray(address) ? address : [address];
  const parts: string[] = [];
  for (const entry of list) {
    const values = entry.value ?? [];
    for (const item of values) {
      const name = item.name?.trim();
      const email = (item.address ?? '').trim();
      if (name && email) parts.push(`${name} <${email}>`);
      else if (email) parts.push(email);
      else if (name) parts.push(name);
    }
  }
  return parts.join(', ');
}

/**
 * Very small HTML → text downgrade used when a mail has no `text/plain` part.
 * Intentionally regex-based (no DOM): it only needs to feed the snippet and the
 * plain-text reading mode, never to render anything.
 */
export function htmlToText(html: string | Buffer | false | undefined): string {
  if (!html) return '';
  const raw = typeof html === 'string' ? html : html.toString('utf8');
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Builds a ~`maxLength` char single-line snippet from body text. */
export function buildSnippet(text: string, maxLength = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}…`;
}

function toAttachmentMeta(parsed: ParsedMail): AttachmentMeta[] {
  const list = parsed.attachments ?? [];
  return list.map((attachment, index) => ({
    partId: String(index),
    filename: attachment.filename?.trim() || `附件-${index + 1}`,
    contentType: attachment.contentType || 'application/octet-stream',
    size: typeof attachment.size === 'number' ? attachment.size : (attachment.content?.length ?? 0),
    inline: Boolean(attachment.related) || Boolean(attachment.cid),
  }));
}

/** Parses a raw RFC 2822 mail source into the shape the app works with. */
export async function parseMailSource(source: Buffer | string): Promise<ParsedMailResult> {
  const parsed: ParsedMail = await simpleParser(source);
  const html = parsed.html === false ? '' : (parsed.html ?? '');
  const text = (parsed.text ?? '').trim() || htmlToText(html);

  return {
    subject: (parsed.subject ?? '').trim(),
    from: addressToText(parsed.from),
    to: addressToText(parsed.to),
    cc: addressToText(parsed.cc),
    replyTo: addressToText(parsed.replyTo),
    messageId: (parsed.messageId ?? '').trim(),
    date: parsed.date ? parsed.date.getTime() : Date.now(),
    text,
    html,
    attachments: toAttachmentMeta(parsed),
  };
}

/** Reads one attachment's bytes back out of a raw source by its index. */
export async function extractAttachment(
  source: Buffer | string,
  partId: string,
): Promise<{ filename: string; content: Buffer } | null> {
  const parsed = await simpleParser(source);
  const index = Number.parseInt(partId, 10);
  const attachment = parsed.attachments?.[index];
  if (!attachment || !attachment.content) return null;
  return {
    filename: attachment.filename?.trim() || `附件-${index + 1}`,
    content: attachment.content as Buffer,
  };
}
