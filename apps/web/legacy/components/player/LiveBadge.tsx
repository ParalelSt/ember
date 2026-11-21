import { cn } from '@/lib/utils';

/** Where the progress bar would be, for a live radio station: it has no
 *  length to show or seek in. The offline badge's pill (components/player/
 *  OfflineBadge) with the ember dot; deliberately plain, so it can be
 *  restyled once a design is picked. */
export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="live-badge"
      aria-label="Live radio"
      className={cn(
        'inline-flex shrink-0 items-center gap-inset rounded-full bg-muted px-cluster py-inset text-xs font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ember" />
      Live
    </span>
  );
}
