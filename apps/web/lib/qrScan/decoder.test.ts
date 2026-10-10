import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeQr } from '@/lib/qr';
import { createFrameDecoder, decodeRgba, frameSize } from './decoder';

/** Our own encoder (lib/qr.ts, what the sign-in page shows) drawn to RGBA
 *  pixels, `scale` px per module, with the 4-module quiet zone. */
function render(text: string, scale = 4, opts: { invert?: boolean } = {}) {
  const qr = encodeQr(text);
  const side = (qr.size + 8) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.floor(y / scale) - 4;
      const c = Math.floor(x / scale) - 4;
      const dark = r >= 0 && c >= 0 && r < qr.size && c < qr.size && qr.modules[r][c];
      const v = dark !== !!opts.invert ? 0 : 255;
      const i = (y * side + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, side };
}

const LINK = 'https://ember.example.com/link/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

describe('decodeRgba (vendored jsQR)', () => {
  it('reads an Ember sign-in link drawn by our own encoder', async () => {
    const { data, side } = render(LINK);
    expect(await decodeRgba(data, side, side)).toBe(LINK);
  });

  it('reads a short code', async () => {
    const { data, side } = render('ABCD-EFGH', 3);
    expect(await decodeRgba(data, side, side)).toBe('ABCD-EFGH');
  });

  it('reads a light-on-dark (inverted) code', async () => {
    const { data, side } = render(LINK, 4, { invert: true });
    expect(await decodeRgba(data, side, side)).toBe(LINK);
  });

  it('a blank frame is null', async () => {
    const side = 120;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    expect(await decodeRgba(data, side, side)).toBeNull();
  });

  it('options do not leak from one call to the next (upstream bug, fixed in the copy)', async () => {
    const { data, side } = render(LINK, 4, { invert: true });
    const { default: jsQR } = await import('@/lib/vendor/jsqr');
    expect(jsQR(data, side, side, { inversionAttempts: 'dontInvert' })).toBeNull();
    expect(jsQR(data, side, side)?.data).toBe(LINK);
  });
});

describe('frameSize', () => {
  it('caps the longest side and keeps the aspect', () => {
    expect(frameSize(1920, 1080)).toEqual({ w: 720, h: 405 });
    expect(frameSize(1080, 1920)).toEqual({ w: 405, h: 720 });
  });
  it('never scales up', () => expect(frameSize(640, 480)).toEqual({ w: 640, h: 480 }));
});

describe('createFrameDecoder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses BarcodeDetector when it reads QR codes', async () => {
    const detect = vi.fn(async () => [{ rawValue: LINK }]);
    class FakeDetector {
      static getSupportedFormats = async () => ['qr_code', 'ean_13'];
      constructor(public opts: { formats: string[] }) {
        expect(opts.formats).toEqual(['qr_code']);
      }
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', FakeDetector);
    const decode = await createFrameDecoder();
    const video = { readyState: 4 } as unknown as HTMLVideoElement;
    expect(await decode(video)).toBe(LINK);
    expect(detect).toHaveBeenCalledWith(video);
  });

  it('a video that is not playing yet reads nothing', async () => {
    class FakeDetector {
      static getSupportedFormats = async () => ['qr_code'];
      detect = vi.fn(async () => [{ rawValue: LINK }]);
    }
    vi.stubGlobal('BarcodeDetector', FakeDetector);
    const decode = await createFrameDecoder();
    expect(await decode({ readyState: 0 } as unknown as HTMLVideoElement)).toBeNull();
  });

  it('falls back to the canvas reader when BarcodeDetector has no QR format', async () => {
    const detect = vi.fn();
    class FakeDetector {
      static getSupportedFormats = async () => ['ean_13'];
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', FakeDetector);
    const decode = await createFrameDecoder();
    expect(await decode({ readyState: 0, videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement)).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });
});
