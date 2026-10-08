import type { CodeHighlight, Envelope, ExtractedCode, MessageFlags } from '../shared/types';
import { buildSnippet, type ParsedMailResult } from './parse-mail';

/**
 * Pure helpers for the sync pipeline.
 *
 * `ingest.ts` itself needs the store and the event bus (and therefore Electron),
 * so the per-mail shaping — the part with all the interesting behaviour — is
 * lifted here where it can be asserted directly without a server or an Electron
 * binary.
 *
 * Key v2 behaviour: **every** fetched mail becomes an envelope. The extraction
 * result is merely *attached* as highlight metadata; it never gates ingestion
 * and there is no "only after account creation" baseline filter any more.
 */

export interface EnvelopeInput {
  accountId: string;
  folderId: string;
  uid: string;
  parsed: ParsedMailResult;
  highlight: CodeHighlight | null;
  seen: boolean;
  /** Injectable for deterministic tests; defaults to `Date.now()`. */
  now?: number;
}

/** Converts a raw extraction result into nullable highlight metadata. */
export function buildHighlight(extracted: ExtractedCode | null | undefined): CodeHighlight | null {
  if (!extracted) return null;
  return {
    code: extracted.code,
    confidence: extracted.confidence,
    matchedKeyword: extracted.matchedKeyword,
    expiresAtHint: extracted.expiresAtHint,
  };
}

/** Shapes one fetched mail into an index envelope (unconditionally). */
export function buildEnvelope(input: EnvelopeInput): Envelope {
  const { parsed } = input;
  const now = input.now ?? Date.now();
  const flags: MessageFlags = {
    seen: input.seen,
    flagged: false,
    answered: false,
    draft: false,
  };

  return {
    id: `${input.accountId}::${input.folderId}::${input.uid}`,
    accountId: input.accountId,
    folderId: input.folderId,
    uid: input.uid,
    messageId: parsed.messageId || input.uid,
    subject: parsed.subject || '(无主题)',
    from: parsed.from || '(未知发件人)',
    to: parsed.to,
    cc: parsed.cc,
    replyTo: parsed.replyTo,
    snippet: buildSnippet(parsed.text),
    receivedAt: parsed.date || now,
    ingestedAt: now,
    flags,
    hasAttachments: parsed.attachments.length > 0,
    attachments: parsed.attachments,
    highlight: input.highlight,
    bodyTruncated: false,
  };
}

/** Convenience for the SyncService: is there any new mail vs the cursor? */
export function hasNewMail(result: { lastUid: number; maxUid: number }): boolean {
  return result.maxUid > result.lastUid;
}
