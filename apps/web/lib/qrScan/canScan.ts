import { isCarUserAgent } from '@/lib/carUa';
import { detectShell, type Shell } from '@/lib/playback/detectShell';

export interface ScanProbe {
  ua: string;
  shell: Shell;
  /** window.Capacitor.getPlatform() inside the app: 'android' or 'ios'. */
  platform?: string;
  /** navigator.userAgentData?.mobile when the browser has it. */
  uaDataMobile?: boolean;
  /** navigator.maxTouchPoints: iPadOS Safari says "Macintosh" but has touch. */
  maxTouchPoints?: number;
  /** navigator.mediaDevices.getUserMedia exists (a secure page with a camera API). */
  hasGetUserMedia: boolean;
}

/** A phone or tablet user agent (iPhone, iPad, Android, iPadOS posing as a Mac). */
function isHandheld({ ua, uaDataMobile, maxTouchPoints }: ScanProbe): boolean {
  if (uaDataMobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (maxTouchPoints ?? 0) > 1;
}

/** Whether "Scan QR code" makes sense here: the Ember app on a phone or
 *  tablet, or a phone or tablet browser with a camera API. Never the desktop
 *  app, a desktop browser or a car screen. Pure, for tests. */
export function canScanProbe(p: ScanProbe): boolean {
  if (isCarUserAgent(p.ua)) return false;
  if (p.shell === 'tauri') return false;
  // The Android app has Google's code scanner, which needs no camera API in
  // the page; the iOS app scans in the page (WKWebView getUserMedia).
  if (p.shell === 'capacitor') return p.platform === 'android' || p.hasGetUserMedia;
  return isHandheld(p) && p.hasGetUserMedia;
}

type CapWindow = { Capacitor?: { getPlatform?: () => string } };

/** Browser-side check; false during SSR. */
export function canScan(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return canScanProbe({
    ua: nav.userAgent ?? '',
    shell: detectShell(),
    platform: (window as unknown as CapWindow).Capacitor?.getPlatform?.(),
    uaDataMobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints,
    hasGetUserMedia: typeof nav.mediaDevices?.getUserMedia === 'function',
  });
}
