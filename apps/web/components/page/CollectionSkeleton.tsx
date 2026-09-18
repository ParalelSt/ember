import { Skeleton } from '@/components/ui/skeleton';
import {
  HEADER_CLASSES,
  HEADER_VARIANTS,
  type CollectionHeaderVariant,
} from '@/components/page/CollectionHeader';
import { cn } from '@/lib/utils';

export interface CollectionSkeletonProps {
  variant?: CollectionHeaderVariant;
  /** How many track rows to sketch: kept small; this is a placeholder for
   *  the blank route-load transition, not a guess at the real list length. */
  rows?: number;
}

/** Presentational, no data: a muted stand-in for a collection page's header
 *  (cover, eyebrow, title, meta, action bar) and its first few track rows.
 *  The header geometry comes from CollectionHeader's own HEADER_CLASSES and
 *  the page stack matches CollectionPage (`gap-stack`), so the skeleton
 *  cannot drift from the page it stands in for. Used by the route-level
 *  loading.tsx files so a slow connection shows this instead of a blank
 *  screen while the route's chunk and payload arrive: the page's own
 *  "Loading…" text still covers the fetch that happens after it mounts. */
export function CollectionSkeleton({ variant = 'collection', rows = 5 }: CollectionSkeletonProps) {
  const v = HEADER_VARIANTS[variant];
  return (
    <div className="flex flex-col gap-stack">
      <div className={HEADER_CLASSES.root} data-testid="skeleton-header">
        <Skeleton className={cn('shrink-0', v.cover, v.radius)} />
        <div className="min-w-0 w-full max-w-sm">
          <Skeleton className="h-3 w-16" />
          <Skeleton className={cn('h-8 w-2/3', HEADER_CLASSES.title)} />
          <Skeleton className={cn('h-3 w-1/3', HEADER_CLASSES.meta)} />
          <div className={cn('flex items-center gap-cluster', HEADER_CLASSES.actions)}>
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="size-12 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-art-sm rounded-md shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
