import { detectShell } from '@/lib/playback/detectShell';

/** Asks the phone app to write the WebView's cookies to disk now
 *  (EmberApp.flushCookies, CookieFlush.kt). Chromium otherwise writes them
 *  about 30 s after a change, and an app killed sooner (an ANR in the car, a
 *  swipe from recents) came back signed out. Called on every session change.
 *
 *  True when the app flushed; false in a browser, in an app from before the
 *  method, or when the call failed. Never throws. */

interface EmberAppPlugin {
  flushCookies?: () => Promise<unknown>;
}
type CapWindow = { Capacitor?: { Plugins?: { EmberApp?: EmberAppPlugin } } };

export async function flushNativeCookies(): Promise<boolean> {
  if (typeof window === 'undefined' || detectShell() !== 'capacitor') return false;
  const plugin = (window as unknown as CapWindow).Capacitor?.Plugins?.EmberApp;
  if (typeof plugin?.flushCookies !== 'function') return false;
  try {
    await plugin.flushCookies();
    return true;
  } catch {
    return false;
  }
}
