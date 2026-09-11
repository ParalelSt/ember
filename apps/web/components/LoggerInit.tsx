'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger/client';
import { subscribeNativeLog } from '@/lib/nativeLog';

/** Client-only mount that boots the logger. Renders nothing. Idempotent:
 *  multiple mounts share the underlying logger singleton. Route-change
 *  breadcrumbs are recorded by the logger itself (boot() wraps
 *  history.pushState / popstate) rather than from a pathname effect here,
 *  so there is exactly one source of 'route' breadcrumbs. */
export function LoggerInit() {
  useEffect(() => {
    logger.boot();
    // Android only: forwards the native plugin's `nativeLog` events (download
    // and service failures) into the same buffer, and drains whatever the
    // plugin buffered before this page loaded.
    subscribeNativeLog();
  }, []);

  return null;
}
