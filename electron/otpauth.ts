import type { TotpAlgorithm, TotpScanDraft } from '../shared/types';

/**
 * Parser for the Key URI Format shared by Google Authenticator, Authy, 1Password
 * and every other authenticator that renders a 2FA enrolment QR code:
 *
 *   otpauth://totp/ACME%20Co:john@acme.com
 *     ?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30
 *
 * Only `totp` is accepted — counter based `hotp` URIs are rejected because this
 * app has no counter to advance.
 */

const ALGORITHMS: Record<string, TotpAlgorithm> = {
  SHA1: 'SHA1',
  SHA256: 'SHA256',
  SHA512: 'SHA512',
};

/** Base32 alphabet (RFC 4648) with optional trailing padding. */
const BASE32 = /^[A-Z2-7]+=*$/;

const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA1';
const DEFAULT_DIGITS: 6 | 8 = 6;
const DEFAULT_PERIOD = 30;
const MIN_SECRET_LENGTH = 8;

function normalizeAlgorithm(raw: string | null): TotpAlgorithm {
  return ALGORITHMS[(raw ?? '').trim().toUpperCase()] ?? DEFAULT_ALGORITHM;
}

function normalizeDigits(raw: string | null): 6 | 8 {
  return (raw ?? '').trim() === '8' ? 8 : DEFAULT_DIGITS;
}

function normalizePeriod(raw: string | null): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PERIOD;
}

/**
 * Authenticator apps emit secrets with inconsistent spacing and casing and
 * sometimes padding; normalise before validating so a valid code is never
 * rejected purely because of formatting.
 */
function normalizeSecret(raw: string | null): string | null {
  const secret = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!BASE32.test(secret)) return null;
  const unpadded = secret.replace(/=+$/, '');
  return unpadded.length >= MIN_SECRET_LENGTH ? unpadded : null;
}

/** Splits the `Issuer:Account` label carried in the URI path. */
function splitLabel(label: string): { issuer: string; account: string } {
  const separator = label.indexOf(':');
  if (separator === -1) return { issuer: '', account: label.trim() };
  return {
    issuer: label.slice(0, separator).trim(),
    account: label.slice(separator + 1).trim(),
  };
}

/**
 * Parses an `otpauth://` URI into a form-ready draft.
 * Returns null when the input is not a usable TOTP enrolment URI.
 */
export function parseOtpAuthUri(uri: string): TotpScanDraft | null {
  const trimmed = uri.trim();
  if (!/^otpauth:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.host.toLowerCase() !== 'totp') return null;

  const secret = normalizeSecret(url.searchParams.get('secret'));
  if (!secret) return null;

  let label: string;
  try {
    label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    // Malformed percent-encoding: fall back to the raw label rather than fail.
    label = url.pathname.replace(/^\/+/, '');
  }

  const fromLabel = splitLabel(label);
  const issuerParam = url.searchParams.get('issuer');
  const issuer = (issuerParam ?? '').trim() || fromLabel.issuer;

  return {
    algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
    digits: normalizeDigits(url.searchParams.get('digits')),
    period: normalizePeriod(url.searchParams.get('period')),
    secret,
    issuer,
    account: fromLabel.account,
  };
}
