'use client';

import { useSessionHost } from '@/hooks/useSessionHost';

/** App-shell mount for the carlist host role: guest skips, new songs and the
 *  playing row keep flowing on every page, not just the carlist page. */
export function SessionHostBridge() {
  useSessionHost();
  return null;
}
