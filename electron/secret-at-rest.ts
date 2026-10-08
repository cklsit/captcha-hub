/**
 * Secret-at-rest helpers.
 *
 * Every secret this app persists is supposed to leave `store.ts` wrapped by
 * `crypto.ts`, which tags each ciphertext with a prefix (`enc:safe:` /
 * `enc:aesgcm:`). Anything without that prefix sat on disk in the clear.
 *
 * The bug this module exists to prevent: several store write paths read the
 * whole account array (decrypted), mutated one entry, and wrote the array
 * back re-encrypting only the entry they touched. Every *other* account's
 * password and OAuth tokens were then persisted as plaintext — silently, and
 * only visible by opening the JSON file by hand.
 *
 * Deliberately pure (no Electron, no crypto import): the sealing function is
 * injected by the caller, so this stays unit testable inside the CI's
 * pure-module guard.
 */

/** Prefix every ciphertext produced by `crypto.ts` starts with. */
export const CIPHERTEXT_PREFIX = 'enc:';

/**
 * True when a non-empty value is still stored in the clear.
 *
 * Empty values are *not* plaintext: an unused password field is `''` and must
 * stay that way rather than being sealed into a ciphertext of nothing.
 */
export function isPlaintext(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(CIPHERTEXT_PREFIX);
}

/**
 * Returns a copy of `record` in which every field named in `keys` that is still
 * plaintext has been replaced by `seal(value)`.
 *
 * `sealed` counts the fields that actually changed, so a caller can tell
 * whether a write is needed at all. Already-sealed fields are left untouched —
 * sealing twice would destroy the value, since the ciphertext would be treated
 * as the new plaintext.
 */
export function sealPlaintext<T extends object>(
  record: T,
  keys: string[],
  seal: (value: string) => string,
): { value: T; sealed: number } {
  // Copied through `unknown` because a bare `T extends object` carries no index
  // signature, so it cannot be indexed by the field names we were handed.
  const next = { ...(record as unknown as Record<string, unknown>) };
  let sealed = 0;

  for (const key of keys) {
    const current = next[key];
    if (isPlaintext(current)) {
      next[key] = seal(current as string);
      sealed += 1;
    }
  }

  return { value: next as T, sealed };
}
