import { nativePlatform } from '@/lib/playback/nativePlatform';

/** "Open Ember when this device starts" (Settings > Devices, Android app
 *  only): kept by the app itself (EmberApp.getBootStart / setBootStart,
 *  BootStart.kt), since it acts at boot with no page open. For a car head
 *  unit that runs Ember: after the device starts, Ember picks up the last
 *  queue, paused, or playing with keepPlaying. Both off by default. */

export interface BootStartSettings {
  enabled: boolean;
  keepPlaying: boolean;
}

interface EmberAppPlugin {
  getBootStart?: () => Promise<Partial<BootStartSettings>>;
  setBootStart?: (next: Partial<BootStartSettings>) => Promise<Partial<BootStartSettings>>;
}
type CapWindow = { Capacitor?: { Plugins?: { EmberApp?: EmberAppPlugin } } };

function plugin(): EmberAppPlugin | null {
  if (nativePlatform() !== 'android') return null;
  return (window as unknown as CapWindow).Capacitor?.Plugins?.EmberApp ?? null;
}

function clean(s: Partial<BootStartSettings> | null | undefined): BootStartSettings {
  return { enabled: s?.enabled === true, keepPlaying: s?.keepPlaying === true };
}

/** True inside the Android app, whatever its version: where the setting
 *  belongs, even when this app is too old to have it. */
export function isAndroidApp(): boolean {
  return nativePlatform() === 'android';
}

/** True when this app can keep the setting (an Android app from before it
 *  cannot). */
export function bootStartSupported(): boolean {
  const p = plugin();
  return typeof p?.getBootStart === 'function' && typeof p?.setBootStart === 'function';
}

/** The setting as the app has it; null where there is none (a browser, the
 *  iPhone or desktop app, an older Android app) or the app did not answer. */
export async function getBootStart(): Promise<BootStartSettings | null> {
  const p = plugin();
  if (typeof p?.getBootStart !== 'function') return null;
  try {
    return clean(await p.getBootStart());
  } catch {
    return null;
  }
}

/** Saves the setting in the app and answers what it now holds. Throws when
 *  the app cannot keep it, so the switch can go back. */
export async function setBootStart(next: BootStartSettings): Promise<BootStartSettings> {
  const p = plugin();
  if (typeof p?.setBootStart !== 'function') throw new Error('This version of the app cannot do that.');
  return clean(await p.setBootStart(next));
}
