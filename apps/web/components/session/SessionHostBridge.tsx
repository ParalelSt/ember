'use client';

import { useSessionHost } from '@/hooks/useSessionHost';

/** App-shell mount for the carlist host role: guest skips, new songs and the
 *  playing position keep flowing on every page, not just the session page. */
export function SessionHostBridge() {
  useSessionHost();
  return null;
}
