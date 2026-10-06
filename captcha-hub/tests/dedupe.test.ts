import { describe, expect, it } from 'vitest';
import { capMessages, mergeMessages, messageKey } from '../electron/dedupe';
import type { CaptchaMessage } from '../shared/types';

function message(id: string, sourceId: string, uid: string, receivedAt: number): CaptchaMessage {
  return {
    id,
    sourceId,
    sourceKind: 'email',
    sourceName: 'src',
    code: id,
    confidence: 0.9,
    matchedKeyword: '验证码',
    expiresAtHint: null,
    subject: 's',
    from: 'f',
    summary: 'body',
    receivedAt,
    ingestedAt: receivedAt,
    read: false,
    uid,
  };
}

describe('messageKey', () => {
  it('combines source and uid', () => {
    expect(messageKey({ sourceId: 'a', uid: '42' })).toBe('a::42');
  });
});

describe('mergeMessages', () => {
  it('adds only genuinely new messages and keeps newest first', () => {
    const existing = [message('1', 'a', '1', 1000), message('2', 'a', '2', 2000)];
    const incoming = [
      message('2', 'a', '2', 2000), // duplicate by source+uid
      message('3', 'a', '3', 3000),
    ];
    const { merged, added } = mergeMessages(existing, incoming);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('3');
    expect(merged.map((m) => m.id)).toEqual(['3', '2', '1']);
  });

  it('treats the same uid from different sources as distinct', () => {
    const existing = [message('1', 'a', '1', 1000)];
    const incoming = [message('9', 'b', '1', 1500)];
    const { added } = mergeMessages(existing, incoming);
    expect(added).toHaveLength(1);
  });
});

describe('capMessages', () => {
  it('keeps only the newest entries', () => {
    const list = [1, 2, 3, 4, 5].map((n) => message(String(n), 'a', String(n), n * 1000));
    const capped = capMessages(list, 3);
    expect(capped.map((m) => m.id)).toEqual(['5', '4', '3']);
  });
});
