'use client';

import { useSyncExternalStore } from 'react';
import { isPartyEligible } from '@/lib/playback/partyDevice';
import { subscribeDesktopPlugins } from '@/lib/desktopPlugins';

/** Recheck eligibility when the viewport crosses the phone breakpoint. */
export function usePartyEligible(): boolean {
  return useSyncExternalStore(subscribeDesktopPlugins, isPartyEligible, () => false);
}
