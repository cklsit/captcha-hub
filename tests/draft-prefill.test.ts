import { describe, expect, it } from 'vitest';
import { draftToComposePayload } from '../src/compose-prefill';
import type { Draft } from '../shared/types';

/**
 * The drafts box reuses `ComposeWindow` by round-tripping a saved `Draft` back
 * into a `ComposePayload`. This locks the field mapping so续写 keeps the same
 * draft id (update, not duplicate) and every authored field survives.
 */

const draft: Draft = {
  id: 'draft-1',
  accountId: 'acct-1',
  mode: 'forward',
  inReplyTo: '<m1@example.com>',
  to: 'a@example.com',
  cc: 'b@example.com',
  subject: 'Fwd: hi',
  bodyText: 'quoted',
  bodyHtml: '<p>quoted</p>',
  attachments: ['C:\\docs\\file.pdf'],
  updatedAt: 1234,
};

describe('draftToComposePayload', () => {
  it('carries every authored field and keeps the draft id for 续写', () => {
    const payload = draftToComposePayload(draft);
    expect(payload).toEqual({
      accountId: 'acct-1',
      to: 'a@example.com',
      cc: 'b@example.com',
      subject: 'Fwd: hi',
      bodyText: 'quoted',
      bodyHtml: '<p>quoted</p>',
      attachments: ['C:\\docs\\file.pdf'],
      inReplyTo: '<m1@example.com>',
      mode: 'forward',
      draftId: 'draft-1',
    });
  });

  it('does not alias the draft attachment array', () => {
    const payload = draftToComposePayload(draft);
    payload.attachments.push('extra');
    expect(draft.attachments).toEqual(['C:\\docs\\file.pdf']);
  });
});
