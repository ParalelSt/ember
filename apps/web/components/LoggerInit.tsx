'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { logger } from '@/lib/logger/client';

/** Client-only mount that boots the logger and feeds it route-change
 *  breadcrumbs. Renders nothing. Idempotent — multiple mounts share the
 *  underlying logger singleton. */
export function LoggerInit() {
  useEffect(() => {
    logger.boot();
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    if (pathname) logger.breadcrumb('route', pathname);
  }, [pathname]);

  return null;
}
