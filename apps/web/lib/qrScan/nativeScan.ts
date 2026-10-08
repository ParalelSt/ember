/** The Android app's own QR scanner (EmberAppPlugin.scanQr, Google's code
 *  scanner: its own camera screen, no camera permission). The page falls
 *  back to its own scanner (QrScanner) whenever this says unavailable: the
 *  iOS app, a browser, an APK from before scanQr, or a phone without Google
 *  Play services. */

export type NativeScan =
  | { status: 'scanned'; value: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

interface ScanAnswer {
  status?: unknown;
  value?: unknown;
}

type CapWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: { EmberApp?: { scanQr?: () => Promise<ScanAnswer> } };
  };
};

/** Maps the plugin's answer. Anything unexpected reads as unavailable, so
 *  the page scanner takes over rather than nothing happening. */
export function readNativeAnswer(answer: unknown): NativeScan {
  const a = (answer && typeof answer === 'object' ? answer : {}) as ScanAnswer;
  if (a.status === 'scanned' && typeof a.value === 'string') return { status: 'scanned', value: a.value };
  if (a.status === 'cancelled') return { status: 'cancelled' };
  return { status: 'unavailable' };
}

let inFlight: Promise<NativeScan> | null = null;

/** One scan at a time: a second call while the scanner is up (React's
 *  development double effect) shares the first one's answer. */
export function nativeScanQr(win: unknown = typeof window === 'undefined' ? undefined : window): Promise<NativeScan> {
  if (!inFlight) {
    inFlight = scanOnce(win).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function scanOnce(win: unknown): Promise<NativeScan> {
  const cap = (win as CapWindow | undefined)?.Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return { status: 'unavailable' };
  const scanQr = cap.Plugins?.EmberApp?.scanQr;
  if (typeof scanQr !== 'function') return { status: 'unavailable' };
  try {
    // Called on the plugin object: Capacitor's proxy needs its own `this`.
    return readNativeAnswer(await cap.Plugins!.EmberApp!.scanQr!());
  } catch {
    // An older APK answers UNIMPLEMENTED; anything else is the same to us.
    return { status: 'unavailable' };
  }
}
