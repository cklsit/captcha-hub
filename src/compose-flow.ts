import type { ComposePayload, Draft, SendResult } from '../shared/types';

/**
 * Side-effect orchestration for the compose window, extracted so the "after a
 * draft is saved, the drafts box must refresh" behaviour can be asserted with
 * fakes instead of only grepping the component source.
 */

export interface SaveDraftFlowDeps {
  saveDraft: (payload: ComposePayload) => Promise<Draft>;
  /** Invoked after a successful save so the caller can reload the drafts box. */
  onDraftSaved: (draft: Draft) => void;
}

export interface SendFlowDeps {
  send: (payload: ComposePayload) => Promise<SendResult>;
  /** Invoked only when the send succeeded. */
  onSent: () => void;
}

/** Saves a draft and, on success, notifies the caller. */
export async function runSaveDraft(payload: ComposePayload, deps: SaveDraftFlowDeps): Promise<Draft> {
  const draft = await deps.saveDraft(payload);
  deps.onDraftSaved(draft);
  return draft;
}

/** Sends a mail and, on success only, notifies the caller. */
export async function runSend(payload: ComposePayload, deps: SendFlowDeps): Promise<SendResult> {
  const result = await deps.send(payload);
  if (result.ok) deps.onSent();
  return result;
}
