import { describe, expect, it } from 'vitest';
import { capEnvelopes, envelopeKey, mergeEnvelopes } from '../electron/dedupe';
import type { Envelope } from '../shared/types';

function envelope(id: string, accountId: string, folderId: string, uid: string, receivedAt: number): Envelope {
  return {
    id,
    accountId,
    folderId,
    uid,
    messageId: `<${uid}@example.com>`,
    subject: 's',
    from: 'f@example.com',
    to: '',
    cc: '',
    replyTo: '',
    snippet: 'body',
    receivedAt,
    ingestedAt: receivedAt,
    flags: { seen: false, flagged: false, answered: false, draft: false },
    hasAttachments: false,
    attachments: [],
    highlight: null,
    bodyTruncated: false,
  };
}

describe('envelopeKey', () => {
  it('combines account, folder and uid', () => {
    expect(envelopeKey({ accountId: 'a', folderId: 'INBOX', uid: '42' })).toBe('a::INBOX::42');
  });
});

describe('mergeEnvelopes', () => {
  it('adds only genuinely new envelopes and keeps newest first', () => {
    const existing = [envelope('1', 'a', 'INBOX', '1', 1000), envelope('2', 'a', 'INBOX', '2', 2000)];
    const incoming = [
      envelope('2', 'a', 'INBOX', '2', 2000), // duplicate by account+folder+uid
      envelope('3', 'a', 'INBOX', '3', 3000),
    ];
    const { merged, added } = mergeEnvelopes(existing, incoming);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('3');
    expect(merged.map((e) => e.id)).toEqual(['3', '2', '1']);
  });

  it('treats the same uid in a different folder as distinct', () => {
    const existing = [envelope('1', 'a', 'INBOX', '1', 1000)];
    const incoming = [envelope('9', 'a', 'Sent', '1', 1500)];
    const { added } = mergeEnvelopes(existing, incoming);
    expect(added).toHaveLength(1);
  });

  it('treats the same uid in a different account as distinct', () => {
    const existing = [envelope('1', 'a', 'INBOX', '1', 1000)];
    const incoming = [envelope('9', 'b', 'INBOX', '1', 1500)];
    const { added } = mergeEnvelopes(existing, incoming);
    expect(added).toHaveLength(1);
  });
});

describe('capEnvelopes', () => {
  it('keeps only the newest entries', () => {
    const list = [1, 2, 3, 4, 5].map((n) => envelope(String(n), 'a', 'INBOX', String(n), n * 1000));
    const capped = capEnvelopes(list, 3);
    expect(capped.map((e) => e.id)).toEqual(['5', '4', '3']);
  });
});
