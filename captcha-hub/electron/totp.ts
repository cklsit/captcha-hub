import { authenticator } from 'otplib';
import { HashAlgorithms } from '@otplib/core';
import type { TotpSecret } from '../shared/types';

/**
 * TOTP (RFC 6238) helper.
 *
 * All code generation happens in the MAIN process only — the renderer never
 * receives a raw secret, it only ever gets the current code and countdown.
 *
 * otplib v12 fixes the generation/validation instant via `options.epoch`
 * (milliseconds since the UNIX epoch). We therefore create an isolated
 * authenticator instance per call and set `epoch` explicitly, which keeps the
 * engine deterministic (and unit-testable with an injected timestamp).
 */

export interface TotpResult {
  code: string;
  /** Seconds remaining until the current code rotates. */
  remaining: number;
  /** Rotation period in seconds. */
  period: number;
  /** Fraction of the period still remaining, in the range (0, 1]. */
  progress: number;
}

/** Maps our persisted algorithm names onto otplib's HashAlgorithms enum. */
function toAlgorithm(value: TotpSecret['algorithm']): HashAlgorithms {
  switch (value) {
    case 'SHA256':
      return HashAlgorithms.SHA256;
    case 'SHA512':
      return HashAlgorithms.SHA512;
    default:
      return HashAlgorithms.SHA1;
  }
}

type AuthenticatorInstance = ReturnType<typeof authenticator.clone>;

/**
 * Builds an isolated authenticator instance pinned to `epochMs` so concurrent
 * sources never mutate shared global options.
 */
function createAuthenticator(secret: TotpSecret, epochMs: number): AuthenticatorInstance {
  const instance = authenticator.clone();
  instance.options = {
    algorithm: toAlgorithm(secret.algorithm),
    digits: secret.digits === 8 ? 8 : 6,
    step: secret.period > 0 ? secret.period : 30,
    epoch: epochMs,
    window: 0,
  };
  return instance;
}

function normalizeSecret(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase();
}

/** Generates the current TOTP code plus countdown metadata. */
export function generateTotp(secret: TotpSecret, nowMs: number = Date.now()): TotpResult {
  const instance = createAuthenticator(secret, nowMs);
  const step = instance.options.step ?? 30;
  const nowSec = Math.floor(nowMs / 1000);
  const code = instance.generate(normalizeSecret(secret.secret));
  const remaining = step - (nowSec % step);
  return {
    code,
    remaining,
    period: step,
    progress: remaining / step,
  };
}

/** Validates a token against a secret at a given time (primarily for tests). */
export function validateTotp(
  secret: TotpSecret,
  token: string,
  nowMs: number = Date.now(),
): boolean {
  const instance = createAuthenticator(secret, nowMs);
  return instance.check(token, normalizeSecret(secret.secret));
}

/** Fills in RFC defaults for a partially specified TOTP config. */
export function withTotpDefaults(partial: Partial<TotpSecret> | null | undefined): TotpSecret {
  return {
    algorithm: partial?.algorithm ?? 'SHA1',
    digits: partial?.digits === 8 ? 8 : 6,
    period: partial?.period && partial.period > 0 ? partial.period : 30,
    secret: partial?.secret ?? '',
    issuer: partial?.issuer ?? '',
    account: partial?.account ?? '',
    note: partial?.note ?? '',
  };
}
