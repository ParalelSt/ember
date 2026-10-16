import { cn } from '@/lib/utils';

/** Presentational only: the calm, still "New" pill on an unread "What's new"
 *  entry point. No animation. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="new-badge"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-ember px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wider text-ember-foreground',
        className,
      )}
    >
      New
    </span>
  );
}

/** The small unread dot on an icon button (the phone menu button). Pings with
 *  the same reduced-motion-aware animation; the ring in the surface colour
 *  cuts it out of the icon. The parent must be `relative`. */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      data-testid="unread-dot"
      aria-hidden="true"
      className={cn('ember-new-dot absolute h-2 w-2 rounded-full bg-ember ring-2 ring-sidebar', className)}
    />
  );
}
