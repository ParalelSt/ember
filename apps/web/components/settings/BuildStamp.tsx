'use client';

import { useEffect, useState } from 'react';
import { shellAppVersion } from '@/lib/shellVersion';

/** The settings footer's version line: the web build, and inside the desktop
 *  or phone app that app's own version too ("Ember build 0.7.19 (...) · App
 *  0.4.14"), since the two are released separately. A browser shows the web
 *  build alone. */
export function BuildStamp({ build }: { build: string }) {
  const [app, setApp] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void shellAppVersion().then((v) => {
      if (live) setApp(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <span>
      Ember build {build}
      {app ? ` · App ${app}` : null}
    </span>
  );
}
