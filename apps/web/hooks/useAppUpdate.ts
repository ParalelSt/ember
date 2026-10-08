'use client';

import { useEffect, useState } from 'react';
import {
  IDLE_UPDATE_STATE,
  appUpdateAvailable,
  subscribeAppUpdate,
  type AppUpdateState,
} from '@/lib/appUpdate';

/** The Android app's updater state (lib/appUpdate.ts). `available` is false
 *  everywhere else (a browser, the desktop and iPhone apps, an older Android
 *  app), and the state then stays idle. */
export function useAppUpdate(): { available: boolean; state: AppUpdateState } {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<AppUpdateState>(IDLE_UPDATE_STATE);
  useEffect(() => {
    if (!appUpdateAvailable()) return;
    setAvailable(true);
    return subscribeAppUpdate(setState);
  }, []);
  return { available, state };
}
