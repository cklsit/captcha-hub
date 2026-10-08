import type { Envelope } from '../shared/types';

/**
 * Pure de-duplication helpers. Kept free of Electron imports so they are
 * directly unit-testable under plain Node / vitest.
 */

/** Stable identity of a mail: `accountId::folderId::uid`. */
export function envelopeKey(
  envelope: Pick<Envelope, 'accountId' | 'folderId' | 'uid'>,
): string {
  return `${envelope.accountId}::${envelope.folderId}::${envelope.uid}`;
}

export function sortByReceivedDesc<T extends { receivedAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * Merges `incoming` envelopes into `existing`, dropping any duplicates already
 * present (matched by account + folder + uid). Returns the sorted merged list
 * plus the subset that was genuinely new (used for UI highlight + notifications).
 */
export function mergeEnvelopes(
  existing: Envelope[],
  incoming: Envelope[],
): { merged: Envelope[]; added: Envelope[] } {
  const seen = new Set(existing.map(envelopeKey));
  const added: Envelope[] = [];

  for (const envelope of incoming) {
    const key = envelopeKey(envelope);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(envelope);
  }

  return { merged: sortByReceivedDesc([...added, ...existing]), added };
}

/** Trims an envelope list to the `max` most-recent entries. */
export function capEnvelopes(envelopes: Envelope[], max: number): Envelope[] {
  if (envelopes.length <= max) return envelopes;
  return sortByReceivedDesc(envelopes).slice(0, max);
}
