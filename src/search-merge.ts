import type { Envelope } from '../shared/types';

/**
 * Merges the two search stages into the final view.
 *
 * Search is deliberately two-phase: `meta` comes from the in-memory envelope
 * index (instant), and `bodyHitIds` comes from the on-demand body scanner.
 * Keeping the merge as a pure function makes the subtle rules — de-duplication,
 * which rows are "body-only", the result cap, and dropping ids that fell out of
 * the current view — testable without a DOM.
 */

export interface MergedSearch {
  /** Metadata hits ∪ body-only hits, de-duplicated, newest first. */
  envelopes: Envelope[];
  /**
   * Ids that are ONLY present because of a body-text hit — i.e. rows the
   * metadata pass did not already surface. Rows present in `meta` never appear
   * here even if their body also matched.
   */
  bodyMatchIds: Set<string>;
}

/**
 * @param meta        Metadata-index hits (already scoped/sorted by the caller).
 * @param bodyHitIds  Envelope ids returned by the on-demand body scanner.
 * @param candidates  Envelopes inside the CURRENT account/folder view — the
 *                     allow-list that keeps out-of-view body hits from leaking
 *                     into the list.
 * @param limit       Maximum number of body-only rows to append.
 */
export function mergeSearchResults(
  meta: Envelope[],
  bodyHitIds: string[],
  candidates: Envelope[],
  limit: number,
): MergedSearch {
  const metaIds = new Set(meta.map((envelope) => envelope.id));
  const hitIds = new Set(bodyHitIds);
  const cap = limit > 0 ? limit : 0;

  const extras: Envelope[] = [];
  const taken = new Set<string>();
  for (const candidate of candidates) {
    if (extras.length >= cap) break;
    if (!hitIds.has(candidate.id)) continue;
    if (metaIds.has(candidate.id)) continue;
    if (taken.has(candidate.id)) continue;
    taken.add(candidate.id);
    extras.push(candidate);
  }

  const byId = new Map<string, Envelope>();
  for (const envelope of [...meta, ...extras]) byId.set(envelope.id, envelope);
  const envelopes = [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt);

  return { envelopes, bodyMatchIds: new Set(extras.map((envelope) => envelope.id)) };
}
