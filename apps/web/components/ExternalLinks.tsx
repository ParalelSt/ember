'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { routeNewTabLinks, type OpenOutcome } from '@/lib/openExternal';

/** Tell the listener what happened to a link that could not simply open. */
export function announceOpen(outcome: OpenOutcome): void {
  if (outcome === 'copied') toast('Copied the link: paste it into your browser. Update the desktop app to open links directly.');
  else if (outcome === 'failed') toast.error('That link could not be opened.');
}

/** Desktop app only: new-tab links anywhere in Ember open in the system
 *  browser (lib/openExternal.ts). Renders nothing. */
export function ExternalLinks() {
  useEffect(() => routeNewTabLinks((o) => announceOpen(o)), []);
  return null;
}
