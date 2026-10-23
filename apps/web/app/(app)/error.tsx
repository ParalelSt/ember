'use client';

import { useEffect } from 'react';
import { CrashFallback } from '@/components/AppErrorBoundary';
import { logger } from '@/lib/logger/client';

/** A crash in a page, caught under the app shell's layout (Next's
 *  route-level boundary): the sidebar, the player bar and the menu stay,
 *  only the page shows the app's crash fallback. Its button retries the
 *  page (Next re-fetches and re-renders it), and moving to another page
 *  clears the error by itself. The root AppErrorBoundary is still there
 *  for a crash in the shell. */
export default function AppSegmentError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Next 16's retry (re-fetch and re-render); `reset` only re-renders. */
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    logger.error('react', error.message || 'render error', { digest: error.digest }, error);
  }, [error]);

  return <CrashFallback onReload={() => (unstable_retry ?? reset)()} />;
}
