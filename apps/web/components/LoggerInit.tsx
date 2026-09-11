'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger/client';

/** Client-only mount that boots the logger. Renders nothing. Idempotent ,
 *  multiple mounts share the underlying logger singleton. Route-change
 *  breadcrumbs are recorded by the logger itself (boot() wraps
 *  history.pushState / popstate) rather than from a pathname effect here,
 *  so there is exactly one source of 'route' breadcrumbs. */
export function LoggerInit() {
  useEffect(() => {
    logger.boot();
  }, []);

  return null;
}
