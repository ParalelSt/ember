import { isPhone } from '@/lib/isPhone';
import { detectShell } from '@/lib/playback/detectShell';

export const PHONE_PLUGIN_QUERY = '(max-width: 767px)';

/** Device eligibility is separate from account preferences, which sync across devices. */
export function canUseDesktopPlugins(): boolean {
  if (typeof window === 'undefined') return false;
  if (detectShell() === 'capacitor' || isPhone()) return false;
  return !(window.matchMedia?.(PHONE_PLUGIN_QUERY).matches ?? window.innerWidth < 768);
}

export function subscribeDesktopPlugins(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia?.(PHONE_PLUGIN_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
