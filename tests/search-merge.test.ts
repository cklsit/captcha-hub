import { describe, expect, it } from 'vitest';
import { mergeSearchResults } from '../src/search-merge';
import type { Envelope } from '../shared/types';

/** Real behaviour assertions for the two-phase (metadata + body) search merge. */

function envelope(id: string, receivedAt: number): Envelope {
  return {
    id,
    accountId: 'acct-1',
    folderId: 'INBOX',
    uid: id,
    messageId: `<${id}@example.com>`,
    subject: id,
    from: 'f@example.com',
    to: '',
    cc: '',
    replyTo: '',
    snippet: '',
    receivedAt,
    ingestedAt: receivedAt,
    flags: { seen: false, flagged: false, answered: false, draft: false },
    hasAttachments: false,
    attachments: [],
    highlight: null,
    bodyTruncated: false,
  };
}

const ids = (list: Envelope[]): string[] => list.map((item) => item.id);

describe('mergeSearchResults', () => {
  it('主题与正文双命中只出 1 行，且不计入 bodyMatchIds', () => {
    const meta = [envelope('e1', 10)];
    const result = mergeSearchResults(meta, ['e1'], [envelope('e1', 10)], 500);
    expect(ids(result.envelopes)).toEqual(['e1']);
    expect([...result.bodyMatchIds]).toEqual([]);
  });

  it('仅正文命中的才进 bodyMatchIds', () => {
    const result = mergeSearchResults([], ['e2'], [envelope('e2', 20)], 500);
    expect(ids(result.envelopes)).toEqual(['e2']);
    expect([...result.bodyMatchIds]).toEqual(['e2']);
  });

  it('仅元数据命中的不进 bodyMatchIds', () => {
    const result = mergeSearchResults([envelope('e3', 30)], [], [envelope('e3', 30)], 500);
    expect(ids(result.envelopes)).toEqual(['e3']);
    expect([...result.bodyMatchIds]).toEqual([]);
  });

  it('limit 真正生效：正文命中被截断到上限', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'].map((id, i) => envelope(id, i));
    const result = mergeSearchResults([], ['a', 'b', 'c', 'd', 'e'], candidates, 2);
    expect(result.envelopes).toHaveLength(2);
    expect(result.bodyMatchIds.size).toBe(2);
  });

  it('命中已不在当前视图内的邮件被剔除', () => {
    // The scanner found e-in and an id outside the current account/folder view.
    const result = mergeSearchResults([], ['e-in', 'e-out'], [envelope('e-in', 5)], 500);
    expect(ids(result.envelopes)).toEqual(['e-in']);
    expect([...result.bodyMatchIds]).toEqual(['e-in']);
  });

  it('元数据命中与正文命中合并后按时间倒序', () => {
    const meta = [envelope('m1', 100)];
    const candidates = [envelope('b1', 300), envelope('b2', 200), envelope('m1', 100)];
    const result = mergeSearchResults(meta, ['b1', 'b2'], candidates, 500);
    expect(ids(result.envelopes)).toEqual(['b1', 'b2', 'm1']);
    expect([...result.bodyMatchIds].sort()).toEqual(['b1', 'b2']);
  });

  it('limit=0 时不追加任何正文命中', () => {
    const result = mergeSearchResults([envelope('m1', 1)], ['b1'], [envelope('b1', 2)], 0);
    expect(ids(result.envelopes)).toEqual(['m1']);
    expect(result.bodyMatchIds.size).toBe(0);
  });
});
