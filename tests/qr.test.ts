import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { bgraToRgba, decodeQrPixels } from '../electron/qr';

/**
 * End-to-end round trip for the 2FA QR path: encode a real QR bitmap, then read
 * it back through the same code the app uses.
 *
 * This matters because both failure modes here are silent — a wrong channel
 * order or a buffer-length mistake does not throw, it simply stops decoding,
 * and the user only sees "没有识别到二维码".
 */

const PAYLOAD = 'otpauth://totp/ACME%20Co:john@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co';

interface Bitmap {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rasterises a QR code into an RGBA buffer, quiet zone included. */
function rasterize(text: string, scale = 6, quietZone = 4): Bitmap {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const side = modules.size + quietZone * 2;
  const width = side * scale;
  const height = width;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mx = Math.floor(x / scale) - quietZone;
      const my = Math.floor(y / scale) - quietZone;
      const inRange = mx >= 0 && my >= 0 && mx < modules.size && my < modules.size;
      const dark = inRange && modules.data[my * modules.size + mx] === 1;
      const value = dark ? 0 : 255;
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }

  return { rgba, width, height };
}

/** Mirrors what Electron's `nativeImage.toBitmap()` hands us. */
function rgbaToBgra(rgba: Uint8ClampedArray): Uint8Array {
  const bgra = new Uint8Array(rgba.length);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2];
    bgra[i + 1] = rgba[i + 1];
    bgra[i + 2] = rgba[i];
    bgra[i + 3] = rgba[i + 3];
  }
  return bgra;
}

describe('decodeQrPixels', () => {
  it('从 RGBA 位图中还原出 otpauth 内容', () => {
    const { rgba, width, height } = rasterize(PAYLOAD);
    expect(decodeQrPixels(rgba, width, height)).toBe(PAYLOAD);
  });

  it('完整走通 Electron 的 BGRA → RGBA 通道交换', () => {
    const { rgba, width, height } = rasterize(PAYLOAD);
    const roundTripped = bgraToRgba(rgbaToBgra(rgba));

    // The swap must be lossless before decoding can possibly work.
    expect(Array.from(roundTripped)).toEqual(Array.from(rgba));
    expect(decodeQrPixels(roundTripped, width, height)).toBe(PAYLOAD);
  });

  it('能读反向（浅色码点）渲染的二维码', () => {
    const { rgba, width, height } = rasterize(PAYLOAD, 6, 4);
    for (let i = 0; i + 3 < rgba.length; i += 4) {
      rgba[i] = 255 - rgba[i];
      rgba[i + 1] = 255 - rgba[i + 1];
      rgba[i + 2] = 255 - rgba[i + 2];
    }
    expect(decodeQrPixels(rgba, width, height)).toBe(PAYLOAD);
  });
});

describe('decodeQrPixels 的防御性检查', () => {
  it('纯白图片返回 null 而不是抛异常', () => {
    const width = 64;
    const height = 64;
    const blank = new Uint8ClampedArray(width * height * 4).fill(255);
    expect(decodeQrPixels(blank, width, height)).toBeNull();
  });

  it('尺寸非法或缓冲区过短时安全返回 null', () => {
    expect(decodeQrPixels(new Uint8ClampedArray(4), 0, 0)).toBeNull();
    expect(decodeQrPixels(new Uint8ClampedArray(16), 10, 10)).toBeNull();
  });
});

describe('bgraToRgba', () => {
  it('只交换 R/B 两个通道，保留 G 与 Alpha', () => {
    const bgra = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
    expect(Array.from(bgraToRgba(bgra))).toEqual([3, 2, 1, 4, 252, 251, 250, 253]);
  });
});
