import { getVersion } from '@tauri-apps/api/app';
import { detectShell } from '@/lib/playback/detectShell';

/** The version of the app shell around the page: the desktop app's (its
 *  tauri.conf.json, through Tauri's app API) or the phone app's (Android's
 *  versionName, iOS's CFBundleShortVersionString, through the EmberApp
 *  plugin). The web build has its own stamp (NEXT_PUBLIC_APP_VERSION); this
 *  is the other half of "which version am I running", since the shells are
 *  released separately.
 *
 *  Null in a browser, and in any shell that cannot say: a phone app from
 *  before the EmberApp plugin, a desktop app whose permissions refuse the
 *  call. Never throws. */

interface EmberAppPlugin {
  info(): Promise<{ version?: unknown }>;
}
type CapWindow = { Capacitor?: { Plugins?: { EmberApp?: EmberAppPlugin } } };

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 40);
  return s || null;
}

export async function shellAppVersion(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    switch (detectShell()) {
      case 'tauri':
        return clean(await getVersion());
      case 'capacitor': {
        const plugin = (window as unknown as CapWindow).Capacitor?.Plugins?.EmberApp;
        if (typeof plugin?.info !== 'function') return null;
        const info = await plugin.info();
        return clean(info?.version);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
