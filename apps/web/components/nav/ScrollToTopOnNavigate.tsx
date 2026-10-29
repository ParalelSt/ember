'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { usePathname } from 'next/navigation';

/** Jumps the app's scroller (the (app) layout's overflow container, not the
 *  window) back to the top whenever the route changes. The pathname carries
 *  the dynamic id too, so /playlist/a to /playlist/b resets as well. Back and
 *  forward reset as well: the app has no scroll restoration of its own. */
export function ScrollToTopOnNavigate({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useLayoutEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, scrollRef]);
  return null;
}
