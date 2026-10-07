import type { CaptchaMessage } from '../shared/types';

/**
 * Pure de-duplication helpers. Kept free of Electron imports so they are
 * directly unit-testable under plain Node / vitest.
 */

/** Stable identity of a mail within a source: `sourceId::uid`. */
export function messageKey(message: Pick<CaptchaMessage, 'sourceId' | 'uid'>): string {
  return `${message.sourceId}::${message.uid}`;
}

export function sortByReceivedDesc(messages: CaptchaMessage[]): CaptchaMessage[] {
  return [...messages].sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * Merges `incoming` messages into `existing`, dropping any duplicates already
 * present (matched by source + uid). Returns the sorted merged list plus the
 * subset that was genuinely new (useful for UI highlight + notifications).
 */
export function mergeMessages(
  existing: CaptchaMessage[],
  incoming: CaptchaMessage[],
): { merged: CaptchaMessage[]; added: CaptchaMessage[] } {
  const seen = new Set(existing.map(messageKey));
  const added: CaptchaMessage[] = [];

  for (const message of incoming) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(message);
  }

  return { merged: sortByReceivedDesc([...added, ...existing]), added };
}

/** Trims a message list to `max` most-recent entries. */
export function capMessages(messages: CaptchaMessage[], max: number): CaptchaMessage[] {
  if (messages.length <= max) return messages;
  return sortByReceivedDesc(messages).slice(0, max);
}
