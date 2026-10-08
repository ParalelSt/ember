/** The label the approving phone shows for the device asking to sign in
 *  (plan 2c): "Ember on Android Automotive", "Ember desktop on macOS",
 *  "Chrome on Windows". Built only from fixed words picked by matching the
 *  User-Agent, never from the text a client sent, so a request cannot put
 *  "your bank" or a fake instruction on the approve card. */

export type QrShell = 'web' | 'capacitor' | 'tauri';

/** The shell hint, allowlisted. Anything else is 'web'. */
export function shellOf(hint: unknown): QrShell {
  return hint === 'capacitor' || hint === 'tauri' ? hint : 'web';
}

function osOf(ua: string): string | null {
  if (/\bAutomotive\b|\bEmberCar\b/.test(ua)) return 'Android Automotive';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return 'macOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\bOPR\//.test(ua)) return 'Opera';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox';
  if (/\b(Chrome|CriOS)\//.test(ua)) return 'Chrome';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) return 'Safari';
  return null;
}

export function deviceLabel(userAgent: string | null | undefined, shellHint: unknown): string {
  // A UA is a few hundred characters; anything past that is not a browser.
  const ua = String(userAgent ?? '').slice(0, 1024);
  const os = osOf(ua) ?? osOf(String(userAgent ?? '').slice(-256));
  const shell = shellOf(shellHint);
  let label: string;
  if (shell === 'capacitor') label = `Ember on ${os ?? 'a phone'}`;
  else if (shell === 'tauri') label = `Ember desktop on ${os ?? 'a computer'}`;
  else {
    const browser = browserOf(ua);
    if (browser) label = os ? `${browser} on ${os}` : browser;
    else label = os ? `A browser on ${os}` : 'A browser';
  }
  return label.slice(0, 80);
}
