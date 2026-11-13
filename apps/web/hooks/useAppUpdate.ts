'use client';

import { useEffect, useState } from 'react';
import { IDLE_UPDATE_STATE, appUpdateWaitsForTap, subscribeAppUpdate, type AppUpdateState } from '@/lib/appUpdate';

/** The Android app's updater state (lib/appUpdate.ts). `available` turns
 *  true with the first state the app reports, so it stays false everywhere
 *  else (a browser, the desktop and iPhone apps, an older Android app), and
 *  the state then stays idle. */
export function useAppUpdate(): { available: boolean; state: AppUpdateState; waitsForTap: boolean } {
  const [seen, setSeen] = useState<{ available: boolean; state: AppUpdateState; waitsForTap: boolean }>({
    available: false,
    state: IDLE_UPDATE_STATE,
    waitsForTap: false,
  });
  useEffect(() => subscribeAppUpdate((state) => setSeen({ available: true, state, waitsForTap: appUpdateWaitsForTap() })), []);
  return seen;
}
