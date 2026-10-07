import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import os from 'node:os';

/**
 * Two-tier secret encryption.
 *
 * 1. Preferred: Electron `safeStorage` (OS keychain / DPAPI backed).
 * 2. Fallback: AES-256-GCM with a key derived from a machine fingerprint. This
 *    keeps secrets encrypted-at-rest even when the OS keychain is unavailable
 *    (e.g. some Linux CI environments), while never writing plaintext to disk.
 *
 * Every ciphertext is prefixed so that both reading strategies stay compatible
 * and legacy plaintext values still decrypt gracefully.
 */

const SAFE_PREFIX = 'enc:safe:';
const AES_PREFIX = 'enc:aesgcm:';

/** Derives a stable 32-byte key from machine characteristics. */
function deriveMachineKey(): Buffer {
  const seed = [
    os.hostname(),
    safeUserName(),
    process.platform,
    process.arch,
    app.getName(),
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest();
}

function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

/** Returns true when the OS-level secure storage backend is usable. */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Encrypts a UTF-8 string, returning a self-describing ciphertext token. */
export function encryptString(plain: string): string {
  if (isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plain);
    return SAFE_PREFIX + encrypted.toString('base64');
  }

  const iv = crypto.randomBytes(12);
  const key = deriveMachineKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return AES_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypts a token produced by {@link encryptString}. Never throws: on failure
 * it returns an empty string so a corrupted record cannot crash the app.
 */
export function decryptString(payload: string): string {
  if (!payload) return '';
  try {
    if (payload.startsWith(SAFE_PREFIX)) {
      const buf = Buffer.from(payload.slice(SAFE_PREFIX.length), 'base64');
      return safeStorage.decryptString(buf);
    }
    if (payload.startsWith(AES_PREFIX)) {
      const raw = Buffer.from(payload.slice(AES_PREFIX.length), 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const data = raw.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', deriveMachineKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    // Legacy / plaintext value (e.g. imported backup that was not encrypted).
    return payload;
  } catch {
    return '';
  }
}
