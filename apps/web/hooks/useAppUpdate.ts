'use client';

import { useEffect, useState } from 'react';
import { IDLE_UPDATE_STATE, subscribeAppUpdate, type AppUpdateState } from '@/lib/appUpdate';

/** The Android app's updater state (lib/appUpdate.ts). `available` turns
 *  true with the first state the app reports, so it stays false everywhere
 *  else (a browser, the desktop and iPhone apps, an older Android app), and
 *  the state then stays idle. */
export function useAppUpdate(): { available: boolean; state: AppUpdateState } {
  const [seen, setSeen] = useState<{ available: boolean; state: AppUpdateState }>({
    available: false,
    state: IDLE_UPDATE_STATE,
  });
  useEffect(() => subscribeAppUpdate((state) => setSeen({ available: true, state })), []);
  return seen;
}
