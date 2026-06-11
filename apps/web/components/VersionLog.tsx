'use client';

import { useEffect } from 'react';

/** Logs the build version once on boot. Renders nothing. The same stamp
 *  shows in the settings footer — this is for quickly checking which build
 *  a device is actually running from the console. */
export function VersionLog() {
  useEffect(() => {
    console.log(`[ember] build ${process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'}`);
  }, []);
  return null;
}
