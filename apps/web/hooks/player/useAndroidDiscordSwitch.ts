'use client';

import { useEffect } from 'react';
import { setAndroidDiscordSharing } from '@/lib/androidDiscord';
import { usePrivacyStore } from '@/stores/usePrivacyStore';

/** The Android app keeps the Discord switch on disk for when no page is
 *  open; its player service publishes the card itself. Only the account's
 *  real answer goes there: until it loads the store says "off" whatever the
 *  account says, and a failed load (no connection) knows nothing new, so
 *  neither may overwrite it. A no-op outside the Android app. */
export function useAndroidDiscordSwitch(): void {
  const shareDiscord = usePrivacyStore((st) => st.shareDiscord);
  const privacyLoaded = usePrivacyStore((st) => st.loaded);
  useEffect(() => {
    if (privacyLoaded) setAndroidDiscordSharing(shareDiscord);
  }, [privacyLoaded, shareDiscord]);
}
