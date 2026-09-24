import { cn } from '@/lib/utils';
import type { BadgeStyle } from '@/components/library/options/changelog';

export interface NewBadgeProps {
  variant: BadgeStyle;
  className?: string;
}

// Pill shared by both styles so they differ only in what moves.
const PILL =
  'inline-flex items-center rounded-full bg-ember px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wider text-ember-foreground';

/** Presentational only: the "New" tag on an unread changelog entry point.
 *  'pulse' animates the pill itself; 'dot' keeps the pill still and pulses
 *  a small ember dot beside it. The motion lives in the .ember-new-pulse /
 *  .ember-new-dot classes in globals.css, whose prefers-reduced-motion
 *  block switches it off, so a reduced-motion user sees the same static
 *  pill (and a solid dot) with no JS check here. */
export function NewBadge({ variant, className }: NewBadgeProps) {
  if (variant === 'dot') {
    return (
      <span data-testid="new-badge" data-variant="dot" className={cn('inline-flex shrink-0 items-center gap-1.5', className)}>
        <span data-testid="new-badge-dot" aria-hidden="true" className="ember-new-dot h-1.5 w-1.5 rounded-full bg-ember" />
        <span className={PILL}>New</span>
      </span>
    );
  }
  return (
    <span data-testid="new-badge" data-variant="pulse" className={cn(PILL, 'ember-new-pulse shrink-0', className)}>
      New
    </span>
  );
}

/** The small unread dot on an icon button (the phone menu button, the top
 *  bar sparkle button). Pulses with the same reduced-motion-aware class as
 *  the Dot badge; the ring in the surface colour cuts it out of the icon. */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      data-testid="unread-dot"
      aria-hidden="true"
      className={cn('ember-new-dot absolute h-2 w-2 rounded-full bg-ember ring-2 ring-sidebar', className)}
    />
  );
}
