/** Which OS the Capacitor app runs on. detectShell() only says "capacitor";
 *  the iPhone app has none of the Android app's native plugins (no Media3
 *  player, offline pins or speech), so a few places need to tell them apart.
 *  Kept out of detectShell.ts on purpose: many tests mock that module whole. */

type CapWindow = {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
};

/** 'ios' or 'android' inside the native app; null in a browser, the desktop
 *  app and during SSR. */
export function nativePlatform(): 'ios' | 'android' | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as CapWindow).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const p = cap.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}

/** True inside the iPhone (iOS) app. */
export function isIosApp(): boolean {
  return nativePlatform() === 'ios';
}
