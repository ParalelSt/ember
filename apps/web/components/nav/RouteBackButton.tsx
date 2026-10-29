'use client';

import { usePathname } from 'next/navigation';
import { BackButton } from '@/components/ui/back-button';
import { backRouteFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

/** The shared back button on a sub page (lib/nav's backRouteFor decides
 *  which pages): `topbar` is the desktop top bar's, left of the search box;
 *  `page` is the phone's, at the top left of the page above its header,
 *  skipped where the page draws its own. */
export function RouteBackButton({ placement, className }: { placement: 'topbar' | 'page'; className?: string }) {
  const route = backRouteFor(usePathname());
  if (!route || (placement === 'page' && !route.phone)) return null;
  return (
    <BackButton
      fallbackHref={route.fallbackHref}
      className={cn(placement === 'page' && 'mb-block', className)}
    />
  );
}
