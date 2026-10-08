import { isCarUserAgent } from '@/lib/carUa';
import { detectShell } from '@/lib/playback/detectShell';

export interface PhoneProbe {
  ua: string;
  /** navigator.userAgentData?.mobile when the browser has it. */
  uaDataMobile?: boolean;
  /** True inside the Capacitor Android or iOS app. */
  capacitor?: boolean;
}

/** A tablet UA: iPad, or Android without the "Mobile" token. */
function isTabletUa(ua: string): boolean {
  if (/iPad/i.test(ua)) return true;
  return /Android/i.test(ua) && !/Mobile/i.test(ua);
}

/** True on a phone (Ember app or phone browser) or an Android car screen.
 *  False on tablets, desktops, TVs and the desktop app. Pure, for tests. */
export function isPhoneProbe({ ua, uaDataMobile, capacitor }: PhoneProbe): boolean {
  if (isCarUserAgent(ua)) return true;
  if (isTabletUa(ua)) return false;
  if (capacitor) return true;
  if (typeof uaDataMobile === 'boolean') return uaDataMobile;
  return /Mobi|iPhone|iPod/i.test(ua);
}

/** Browser-side check; false during SSR. */
export function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return isPhoneProbe({
    ua: nav.userAgent ?? '',
    uaDataMobile: nav.userAgentData?.mobile,
    capacitor: detectShell() === 'capacitor',
  });
}
