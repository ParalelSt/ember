import type { CastPath } from '@/stores/useCastStore';

/** The bits of `window` that decide how (and whether) this page can cast. */
export interface CastEnv {
  shell: 'web' | 'capacitor' | 'tauri';
  /** The Android app's EmberPlayer plugin has the Cast methods (app builds
   *  from before casting do not). */
  androidCast: boolean;
  /** Chrome (or another Chromium browser with Google Cast built in). */
  chrome: boolean;
  /** Safari: AirPlay for media elements. */
  airplay: boolean;
  /** Cast and AirPlay both need a secure page (HTTPS, or localhost). */
  secure: boolean;
}

/** How this page can cast (see useCastStore's CastPath).
 *
 *  - Android app: native Cast in the player service (Media3 CastPlayer), so
 *    the car, the lock screen and the queue keep working. Its WebView has
 *    neither the Cast SDK nor AirPlay.
 *  - Desktop app: nothing. Its webview (WKWebView on macOS, WebView2 on
 *    Windows, WebKitGTK on Linux) has no Google Cast, and the music plays in
 *    the native Rust engine, not in the page.
 *  - Browser: Google Cast in Chrome, AirPlay in Safari, nothing elsewhere. */
export function castPath(env: CastEnv): CastPath {
  if (env.shell === 'capacitor') return env.androidCast ? 'android' : null;
  if (env.shell === 'tauri') return null;
  if (!env.secure) return null;
  if (env.airplay) return 'airplay';
  if (env.chrome) return 'google';
  return null;
}

/** The live environment. */
export function currentCastEnv(shell: CastEnv['shell'], androidCast: boolean): CastEnv {
  const w = typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>);
  return {
    shell,
    androidCast,
    chrome: !!w && typeof w.chrome === 'object' && w.chrome !== null,
    airplay: !!w && 'WebKitPlaybackTargetAvailabilityEvent' in w,
    secure: !!w && w.isSecureContext === true,
  };
}
