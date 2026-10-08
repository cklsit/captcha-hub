import type { ComposePayload, Draft } from '../shared/types';

/**
 * Rebuilds an editable compose payload from a saved draft.
 *
 * Pure and dependency-free so the renderer's "草稿箱 → 续写" path can be unit
 * tested without a DOM. Carrying `draftId` back through means the next
 * `compose.saveDraft` updates the same record instead of creating a duplicate,
 * and `compose.send` clears it once the mail actually goes out.
 */
export function draftToComposePayload(draft: Draft): ComposePayload {
  return {
    accountId: draft.accountId,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    bodyText: draft.bodyText,
    bodyHtml: draft.bodyHtml,
    attachments: [...draft.attachments],
    inReplyTo: draft.inReplyTo,
    mode: draft.mode,
    draftId: draft.id,
  };
}
