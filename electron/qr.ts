import jsQR from 'jsqr';

/**
 * QR decoding kept deliberately free of any Electron import so it stays unit
 * testable: the caller in `ipc.ts` owns the nativeImage / dialog / clipboard
 * plumbing and hands us plain pixels.
 */

/**
 * Electron exposes bitmaps in BGRA order while jsQR expects RGBA, so the two
 * non-alpha channels must be swapped. Getting this wrong never throws — it just
 * silently stops decoding, which is the worst possible failure mode.
 */
export function bgraToRgba(bgra: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return rgba;
}

/** Decodes the first QR code found in an RGBA pixel buffer, if any. */
export function decodeQrPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (width <= 0 || height <= 0) return null;
  if (rgba.length < width * height * 4) return null;

  // `attemptBoth` also matches inverted codes, which some apps render as
  // light-on-dark tiles.
  const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}
