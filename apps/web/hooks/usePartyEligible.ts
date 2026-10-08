'use client';

import { useSyncExternalStore } from 'react';
import { isPartyEligible } from '@/lib/playback/partyDevice';

const noSubscribe = () => () => {};

/** Reactive read of lib/playback/partyDevice's isPartyEligible, see there
 *  for what it means. No real subscription: shell and pointer type do not
 *  change mid-session, so this is just an SSR-safe read (false on the server
 *  and first paint, corrected on the client's first commit), the same shape
 *  as EqualizerPanel's `risky` and hooks/useIsDesktop. */
export function usePartyEligible(): boolean {
  return useSyncExternalStore(noSubscribe, isPartyEligible, () => false);
}
