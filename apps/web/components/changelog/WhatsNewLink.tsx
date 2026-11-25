'use client';

import Link from 'next/link';
import { SparklesIcon } from '@/components/icons';
import { ACTIVE_MD } from '@/components/nav/NavLinks';
import { cn } from '@/lib/utils';
import { pendingNavClick, pendingNavHandlers, usePendingNav } from '@/lib/pendingNav';
import { NewBadge } from '@/components/changelog/NewBadge';

export const WHATS_NEW_HREF = '/whats-new';

export interface WhatsNewLinkProps {
  showNew: boolean;
  activePath: string;
  onNavigate?: () => void;
}

/** Presentational only: the "What's new" row in the sidebar and drawer nav.
 *  Classes match NavLinks so it reads as one more nav row, with the pulsing
 *  New tag pushed to its right edge while something is unread. */
export function WhatsNewLink({ showNew, activePath, onNavigate }: WhatsNewLinkProps) {
  const pending = usePendingNav(activePath);
  const isActive = pending ? pending === WHATS_NEW_HREF : activePath.startsWith(WHATS_NEW_HREF);
  return (
    <Link
      href={WHATS_NEW_HREF}
      {...pendingNavHandlers(WHATS_NEW_HREF, activePath)}
      onClick={(e) => {
        pendingNavClick(e, WHATS_NEW_HREF, activePath);
        onNavigate?.();
      }}
      data-testid="whats-new-link"
      data-nav="What's new"
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
        isActive
          ? ACTIVE_MD
          : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
      )}
    >
      <SparklesIcon className={cn('h-4 w-4', isActive && 'text-ember')} />
      <span className="flex-1">What&apos;s new</span>
      {showNew && <NewBadge />}
    </Link>
  );
}
