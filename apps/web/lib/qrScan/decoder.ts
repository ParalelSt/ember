/** Reads a QR code from the camera preview, one frame at a time. Uses the
 *  browser's BarcodeDetector when it reads QR codes (Chrome on Android),
 *  otherwise the vendored jsQR (iOS app, Safari, Firefox), loaded only when
 *  a scan starts. */

/** One frame's answer: the QR's text, or null when none was read. */
export type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

/** The longest side a frame is scaled to before jsQR reads it: enough for a
 *  QR across a third of the frame, cheap enough for a phone every 200 ms. */
export const MAX_FRAME_SIDE = 720;

interface DetectedBarcode {
  rawValue?: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** jsQR over raw RGBA pixels, for one frame (and for tests). */
export async function decodeRgba(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  const { default: jsQR } = await import('@/lib/vendor/jsqr');
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null;
}

/** The frame size to draw a width x height video at, longest side capped. */
export function frameSize(width: number, height: number, max = MAX_FRAME_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

async function barcodeDetector(): Promise<FrameDecoder | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    const detector = new Ctor({ formats: ['qr_code'] });
    return async (video) => {
      if (video.readyState < 2) return null;
      const codes = await detector.detect(video);
      return codes.find((c) => typeof c.rawValue === 'string' && c.rawValue)?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

function canvasDecoder(): FrameDecoder {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const { w, h } = frameSize(video.videoWidth, video.videoHeight);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    return decodeRgba(ctx.getImageData(0, 0, w, h).data, w, h);
  };
}

/** The best decoder this browser has. */
export async function createFrameDecoder(): Promise<FrameDecoder> {
  return (await barcodeDetector()) ?? canvasDecoder();
}
