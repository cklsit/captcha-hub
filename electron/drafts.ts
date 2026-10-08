import { getStore } from './mail-service';
import type { ComposePayload, Draft } from '../shared/types';

/**
 * Draft storage + reply/forward prefill.
 *
 * Drafts live in the pure storage core; reply / forward only build the
 * pre-filled compose payload (recipient, subject, quoted body) for the renderer
 * to show in the compose window. Nothing is written back to the server's Drafts
 * folder — drafts are intentionally local-only in this release.
 */

/** Saves (or updates) a draft and returns the stored record. */
export function saveDraft(payload: ComposePayload): Draft {
  const core = getStore();
  return core.saveDraft({
    id: payload.draftId,
    accountId: payload.accountId,
    mode: payload.mode,
    inReplyTo: payload.inReplyTo,
    to: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    bodyText: payload.bodyText,
    bodyHtml: payload.bodyHtml,
    attachments: payload.attachments,
  });
}

export function listDrafts(accountId?: string): Draft[] {
  return getStore().listDrafts(accountId);
}

export function removeDraft(id: string): void {
  getStore().deleteDraft(id);
}

function quoteBody(bodyText: string, from: string, receivedAt: number): string {
  const when = new Date(receivedAt).toLocaleString('zh-CN');
  const quoted = bodyText
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `\n\n\n—— 原始邮件 ——\n发件人：${from}\n时间：${when}\n\n${quoted}`;
}

/** Builds the compose prefill for replying to a mail. */
export function buildReplyPrefill(messageId: string): ComposePayload | null {
  const core = getStore();
  const envelope = core.getEnvelope(messageId);
  if (!envelope) return null;
  const body = core.readBody(envelope.accountId, envelope.folderId, envelope.uid);

  return {
    accountId: envelope.accountId,
    to: envelope.replyTo || envelope.from,
    cc: '',
    subject: /^re:/i.test(envelope.subject) ? envelope.subject : `Re: ${envelope.subject}`,
    bodyText: quoteBody(body?.text ?? '', envelope.from, envelope.receivedAt),
    bodyHtml: '',
    attachments: [],
    inReplyTo: envelope.messageId || envelope.uid,
    mode: 'reply',
  };
}

/** Builds the compose prefill for forwarding a mail. */
export function buildForwardPrefill(messageId: string): ComposePayload | null {
  const core = getStore();
  const envelope = core.getEnvelope(messageId);
  if (!envelope) return null;
  const body = core.readBody(envelope.accountId, envelope.folderId, envelope.uid);

  return {
    accountId: envelope.accountId,
    to: '',
    cc: '',
    subject: /^fwd?:/i.test(envelope.subject) ? envelope.subject : `Fwd: ${envelope.subject}`,
    bodyText: quoteBody(body?.text ?? '', envelope.from, envelope.receivedAt),
    bodyHtml: '',
    attachments: [],
    inReplyTo: envelope.messageId || envelope.uid,
    mode: 'forward',
  };
}
