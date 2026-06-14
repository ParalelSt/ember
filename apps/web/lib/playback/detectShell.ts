export type Shell = 'web' | 'capacitor' | 'tauri';

/** Runtime detection of the host shell. Returns 'web' during SSR and in a
 *  plain browser. Capacitor injects window.Capacitor; Tauri injects
 *  window.__TAURI__ / __TAURI_INTERNALS__. */
export function detectShell(): Shell {
  if (typeof window === 'undefined') return 'web';
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __emberNative?: unknown;
  };
  if (w.Capacitor?.isNativePlatform?.()) return 'capacitor';
  if (w.__TAURI__ || w.__TAURI_INTERNALS__) return 'tauri';
  return 'web';
}
