'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { loadDeviceInfo, reportDeviceSeen } from '@/lib/versions/device';

/** Lets the server know which versions this device runs: a moment after the
 *  app opens (so it never competes with starting the music) and whenever it
 *  comes back into view, which is how an app left open for days still checks
 *  in. reportDeviceSeen itself decides whether anything is due. Renders
 *  nothing, and failures are silent. */
const START_DELAY_MS = 3000;

export function DeviceVersionReporter() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    void loadDeviceInfo();
    if (!userId) return;
    const check = () => {
      if (document.visibilityState === 'visible') void reportDeviceSeen(userId);
    };
    const timer = setTimeout(check, START_DELAY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [userId]);

  return null;
}
